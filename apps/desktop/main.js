'use strict'

const { app, BrowserWindow, Menu, shell, dialog, globalShortcut, ipcMain } = require('electron')
const { spawn, execSync } = require('child_process')
const path = require('path')
const http = require('http')
const fs = require('fs')
const os = require('os')

const IS_DEV   = !app.isPackaged
const API_PORT = 4001
const WEB_PORT = 3001

if (process.platform === 'win32') {
  app.setAppUserModelId('com.galaxydigital.cashier')
}

// ─── ASCII-safe userData path ──────────────────────────────────────────────────
// app.getPath('userData') would include the productName which contains Arabic.
// Prisma's SQLite driver cannot handle non-ASCII characters in file paths on
// Windows, so we force a plain ASCII path before anything else runs.
if (!IS_DEV) {
  app.setPath('userData', path.join(app.getPath('appData'), 'CASR'))
}

let mainWindow  = null
let splashWindow = null
const children  = []
/** Deep-link path inside the web app, e.g. /sales/new from --sales */
let pendingRoute = '/'

function parseLaunchRoute(argv) {
  const args = argv.slice(1)
  for (const a of args) {
    if (a === '--sales' || a === '--new-sale' || a === '--new-invoice') return '/sales/new'
    if (a.startsWith('--route=')) {
      const p = a.slice('--route='.length).trim()
      if (p.startsWith('/') && !p.startsWith('//')) return p.split('?')[0]
    }
  }
  return '/'
}

function navigateMainWindow(routePath) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const pathPart = routePath && routePath.startsWith('/') ? routePath : '/'
  const url = `http://localhost:${WEB_PORT}${pathPart === '/' ? '' : pathPart}`
  log(`[ui] navigate → ${url}`)
  mainWindow.loadURL(url).catch((e) => log(`[ui] navigate error: ${e.message}`))
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

// Single instance: second launch focuses existing window and navigates only.
// Must exit BEFORE whenReady — app.quit() alone can still race into startup/spawn.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.exit(0)
}

app.on('second-instance', (_event, argv) => {
  const route = parseLaunchRoute(argv)
  pendingRoute = route
  log(`[app] second-instance → navigate ${route} (no API respawn)`)
  if (mainWindow && !mainWindow.isDestroyed()) {
    navigateMainWindow(route)
  } else {
    // Primary still starting: remember route for createMainWindow
    log(`[app] second-instance queued route=${route} (main window not ready)`)
  }
})

// ─── Logging ──────────────────────────────────────────────────────────────────

const LOG_DIR  = path.join(os.homedir(), 'CASR-Logs')
const LOG_FILE = path.join(LOG_DIR, 'app.log')
const LOG_OLD  = path.join(LOG_DIR, 'app.log.old')

function initLogger() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true })
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 5 * 1024 * 1024) {
      fs.renameSync(LOG_FILE, LOG_OLD)
    }
  } catch {}
}

function log(msg) {
  const ts   = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const line = `[${ts}] ${msg}\n`
  process.stdout.write(line)
  try { fs.appendFileSync(LOG_FILE, line) } catch {}
}

// Logs all key paths and their existence — call after resourcesPath is known.
function logStartInfo(res) {
  log('[info] ── startup diagnostic ─────────────────────────────')
  log(`[info] app.isPackaged       : ${app.isPackaged}`)
  log(`[info] app version          : ${app.getVersion()}`)
  log(`[info] resourcesPath        : ${res}`)
  log(`[info] userData             : ${app.getPath('userData')}`)
  log(`[info] log file             : ${LOG_FILE}`)

  const check = (label, p) =>
    log(`[info] ${label.padEnd(22)}: ${fs.existsSync(p) ? 'EXISTS' : 'MISSING'} — ${p}`)

  check('node.exe',            path.join(res, 'node', 'node.exe'))
  check('api/server.js',       path.join(res, 'api', 'server.js'))
  check('web/apps/web/srv.js', path.join(res, 'web', 'apps', 'web', 'server.js'))
  check('seed.db',             path.join(res, 'seed.db'))
  check('.prisma/client',      path.join(res, 'api', 'node_modules', '.prisma', 'client'))
  check('query_engine.node',   path.join(res, 'api', 'node_modules', '.prisma', 'client',
                                          'query_engine-windows.dll.node'))
  log('[info] ─────────────────────────────────────────────────────')
}

// Validates the SQLite file by reading its 16-byte magic header.
function validateSqliteFile(filePath) {
  try {
    const buf = Buffer.alloc(16)
    const fd  = fs.openSync(filePath, 'r')
    fs.readSync(fd, buf, 0, 16, 0)
    fs.closeSync(fd)
    const magic = buf.toString('utf8', 0, 15)
    if (magic === 'SQLite format 3') {
      const sizeKB = Math.round(fs.statSync(filePath).size / 1024)
      log(`[db] SQLite magic OK — ${sizeKB} KB — ${filePath}`)
      return true
    }
    log(`[db] WARN: file exists but SQLite magic header missing — ${filePath}`)
    return false
  } catch (e) {
    log(`[db] ERROR reading file: ${e.message}`)
    return false
  }
}

initLogger()
log(`[app] ── CASR starting ──────────────────────────────────`)

// ─── Port helpers ──────────────────────────────────────────────────────────────

function isPortListening(port) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: '/' }, (res) => {
      res.resume(); resolve(true)
    })
    req.on('error', () => resolve(false))
    req.end()
  })
}

function waitForPort(port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const attempt  = () => {
      const req = http.get({ hostname: '127.0.0.1', port, path: '/' }, (res) => {
        res.resume(); resolve()
      })
      req.on('error', () => {
        if (Date.now() >= deadline) {
          reject(new Error(`Port :${port} did not respond within ${timeoutMs / 1000}s — check ${LOG_FILE}`))
        } else {
          setTimeout(attempt, 600)
        }
      })
      req.end()
    }
    attempt()
  })
}

// Polls /api/health — retries up to maxRetries times with delayMs between each.
// Both connection errors AND non-200 responses are treated as retriable.
async function waitForApiHealth(maxRetries = 5, delayMs = 2000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const ok = await new Promise((resolve) => {
      const req = http.get(
        { hostname: '127.0.0.1', port: API_PORT, path: '/api/health' },
        (res) => {
          let body = ''
          res.on('data', (d) => { body += d })
          res.on('end', () => {
            log(`[api] health attempt ${attempt}/${maxRetries}: HTTP ${res.statusCode} — ${body.slice(0, 80)}`)
            resolve(res.statusCode === 200)
          })
        }
      )
      req.on('error', (e) => {
        log(`[api] health attempt ${attempt}/${maxRetries}: ${e.message}`)
        resolve(false)
      })
      req.end()
    })

    if (ok) return

    if (attempt < maxRetries) {
      log(`[api] retrying in ${delayMs / 1000}s...`)
      await new Promise(r => setTimeout(r, delayMs))
    }
  }
  throw new Error(`API did not return 200 after ${maxRetries} attempts — check ${LOG_FILE}`)
}

// Kill any process LISTENING on the given port (production stale-process cleanup).
function killStalePort(port) {
  try {
    const out = execSync('netstat -ano', { encoding: 'utf8', timeout: 5000 })
    const re  = new RegExp(`\\s+[\\d.]+:${port}\\s+[\\d.:*]+\\s+LISTENING\\s+(\\d+)`, 'i')
    const seen = new Set()
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(re)
      if (!m) continue
      const pid = m[1]
      if (seen.has(pid) || pid === String(process.pid)) continue
      seen.add(pid)
      try {
        execSync(`taskkill /PID ${pid} /F`, { timeout: 5000 })
        log(`[port] Killed stale PID ${pid} on :${port}`)
      } catch (e) {
        log(`[port] Could not kill PID ${pid}: ${e.message}`)
      }
    }
  } catch { /* port not in use or netstat unavailable */ }
}

// ─── Process management ────────────────────────────────────────────────────────

function spawnServer(cmd, args, cwd, env = {}) {
  const label    = path.basename(cwd)
  const useShell = !path.isAbsolute(cmd) && process.platform === 'win32'
  const proc     = spawn(cmd, args, {
    cwd,
    shell: useShell,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  proc.stdout?.on('data', (d) => log(`[${label}] ${d.toString().trimEnd()}`))
  proc.stderr?.on('data', (d) => log(`[${label}:ERR] ${d.toString().trimEnd()}`))
  proc.on('error',  (err)          => log(`[${label}] spawn error: ${err.message}`))
  proc.on('exit',   (code, signal) => log(`[${label}] exited code=${code} signal=${signal}`))
  children.push(proc)
  return proc
}

function killAll() {
  for (const proc of children) {
    try { proc.kill('SIGTERM') } catch {}
  }
}

// ─── Database initialisation (production) ─────────────────────────────────────
// Live DB lives under Documents\CASR\data (survives reinstall / AppData wipe).
// Backups are written by the API to Documents\CASR-Backups (separate folder).

function initDatabase(res) {
  // Canonical live DB — same path for Setup and Portable (never under asar / install dir).
  const dataDir = path.join(os.homedir(), 'Documents', 'CASR', 'data')
  const dbFile = path.join(dataDir, 'cashier.db')
  const marker = path.join(dataDir, '.appdata-migrated')
  const legacyAppDataDb = path.join(app.getPath('userData'), 'cashier.db')
  const legacyImsDb = path.join(app.getPath('appData'), 'IMS-Pro', 'cashier.db')

  log(`[db] live data dir  : ${dataDir}`)
  log(`[db] database path  : ${dbFile}`)
  log(`[db] backups folder : ${path.join(os.homedir(), 'Documents', 'CASR-Backups')}`)
  log(`[db] canonical source: Documents\\CASR\\data (Setup + Portable share this)`)

  fs.mkdirSync(dataDir, { recursive: true })

  // One-time AppData → Documents migration only (marker prevents stale re-copy).
  if (!fs.existsSync(dbFile)) {
    if (fs.existsSync(marker)) {
      log(`[db] Documents DB missing but AppData migration already done once — will use seed (not AppData again)`)
    } else {
      const sources = [legacyAppDataDb, legacyImsDb].filter((p) => p && fs.existsSync(p))
      for (const src of sources) {
        try {
          fs.copyFileSync(src, dbFile)
          fs.writeFileSync(
            marker,
            JSON.stringify({
              at: new Date().toISOString(),
              source: src,
              dest: dbFile,
              note: 'One-time AppData → Documents migration. Will not repeat.',
            }, null, 2),
            'utf8',
          )
          log(`[db] ONE-TIME migrate AppData → Documents: ${src} → ${dbFile}`)
          break
        } catch (e) {
          log(`[db] Migration from AppData failed (${src}): ${e.message}`)
        }
      }
    }
  } else {
    log(`[db] Using existing Documents DB (no AppData migrate)`)
  }

  if (!fs.existsSync(dbFile)) {
    const seedDb = path.join(res, 'seed.db')
    log(`[db] First run — seed.db: ${seedDb}  exists=${fs.existsSync(seedDb)}`)

    if (!fs.existsSync(seedDb)) {
      throw new Error(
        `seed.db not found in resources.\nExpected: ${seedDb}\n` +
        `Check that the build included assets/seed.db in extraResources.`
      )
    }

    fs.copyFileSync(seedDb, dbFile)
    log(`[db] Copied seed.db → ${dbFile}`)
  }

  // Validate the DB is a real SQLite file (not zero-byte or corrupted)
  if (!validateSqliteFile(dbFile)) {
    // Prefer restore hint: do not overwrite with empty seed if legacy exists
    log(`[db] Database appears corrupt — attempting recovery from seed.db`)
    const seedDb = path.join(res, 'seed.db')
    if (fs.existsSync(seedDb)) {
      const broken = dbFile + '.corrupt-' + Date.now()
      try { fs.renameSync(dbFile, broken) } catch {}
      fs.copyFileSync(seedDb, dbFile)
      log(`[db] Recovery copy done (broken file kept as ${broken})`)
      if (!validateSqliteFile(dbFile)) {
        throw new Error(`Database recovery failed. seed.db itself may be corrupt: ${seedDb}`)
      }
    } else {
      throw new Error(`Database is invalid and seed.db not found for recovery: ${dbFile}`)
    }
  }

  try {
    fs.accessSync(dbFile, fs.constants.R_OK | fs.constants.W_OK)
  } catch (e) {
    throw new Error(`Database not readable/writable: ${dbFile}\n${e.message}`)
  }

  return 'file:' + dbFile.replace(/\\/g, '/')
}

// ─── Server startup ────────────────────────────────────────────────────────────

async function startServers() {
  if (IS_DEV) {
    const root      = path.resolve(__dirname, '..', '..')
    const devDbFile = path.resolve(root, 'data', 'cashier.db')
    const devDbUrl  = 'file:' + devDbFile.replace(/\\/g, '/')

    const apiRunning = await isPortListening(API_PORT)
    const webRunning = await isPortListening(WEB_PORT)

    if (!apiRunning) {
      spawnServer('npm', ['run', 'dev'], path.join(root, 'apps', 'api'), {
        DATABASE_URL: devDbUrl,
      })
    } else {
      log(`[app] API already on :${API_PORT}`)
    }
    if (!webRunning) {
      spawnServer('npm', ['run', 'dev'], path.join(root, 'apps', 'web'), {
        NEXT_PUBLIC_API_URL: `http://localhost:${API_PORT}`,
      })
    } else {
      log(`[app] Web already on :${WEB_PORT}`)
    }
    return
  }

  // ── Production ──────────────────────────────────────────────────────────────
  const res          = process.resourcesPath
  const apiDir       = path.join(res, 'api')
  const webDir       = path.join(res, 'web')
  // In a monorepo Next.js standalone, server.js lives at apps/web/server.js
  const webServerDir = path.join(webDir, 'apps', 'web')
  const nodeExe      = path.join(res, 'node', 'node.exe')
  const prismaEngineLib = path.join(
    apiDir, 'node_modules', '.prisma', 'client', 'query_engine-windows.dll.node'
  )

  logStartInfo(res)

  // Hard checks before any spawn attempt
  if (!fs.existsSync(nodeExe))
    throw new Error(`Bundled node.exe not found:\n${nodeExe}`)
  if (!fs.existsSync(path.join(apiDir, 'server.js')))
    throw new Error(`api/server.js not found:\n${apiDir}`)
  if (!fs.existsSync(path.join(webServerDir, 'server.js')))
    throw new Error(`web/apps/web/server.js not found:\n${webServerDir}`)
  if (!fs.existsSync(prismaEngineLib))
    log(`[warn] Prisma engine .node file missing — API may crash:\n${prismaEngineLib}`)

  // Kill stale processes then re-check ports
  log(`[app] Clearing stale processes on :${API_PORT} and :${WEB_PORT}`)
  killStalePort(API_PORT)
  killStalePort(WEB_PORT)
  await new Promise((r) => setTimeout(r, 400))

  const apiRunning = await isPortListening(API_PORT)
  const webRunning = await isPortListening(WEB_PORT)
  log(`[app] Port check after cleanup — api=${apiRunning}  web=${webRunning}`)

  const dbUrl = initDatabase(res)
  log(`[app] DATABASE_URL: ${dbUrl}`)

  // Automatic backups: API scheduler (see autoBackup.scheduler.ts)

  // Resolve or generate JWT for this installation (not hardcoded)
  const jwtFile = path.join(app.getPath('userData'), 'jwt.env')
  fs.mkdirSync(app.getPath('userData'), { recursive: true })
  let finalJwt = process.env.JWT_SECRET || ''
  if (!finalJwt && fs.existsSync(jwtFile)) {
    finalJwt = fs.readFileSync(jwtFile, 'utf8').trim()
  }
  if (!finalJwt) {
    finalJwt = require('crypto').randomBytes(32).toString('hex')
    try { fs.writeFileSync(jwtFile, finalJwt, 'utf8') } catch {}
  }
  const finalRefresh = process.env.JWT_REFRESH_SECRET || (finalJwt + '-refresh')

  if (!apiRunning) {
    log(`[app] Spawning API: ${nodeExe} server.js in ${apiDir}`)
    spawnServer(nodeExe, ['server.js'], apiDir, {
      DATABASE_URL:                dbUrl,
      PRISMA_QUERY_ENGINE_LIBRARY: prismaEngineLib,
      JWT_SECRET:                  finalJwt,
      JWT_REFRESH_SECRET:          finalRefresh,
      PORT:                        String(API_PORT),
      NODE_ENV:                    'production',
      // UI may load via localhost or 127.0.0.1 — allow both for CORS
      CORS_ORIGIN:                 `http://localhost:${WEB_PORT},http://127.0.0.1:${WEB_PORT}`,
      // Local HTTP desktop — refresh cookie must not require HTTPS
      COOKIE_SECURE:               'false',
      DESKTOP_MODE:                '1',
    })
  } else {
    log(`[app] API already on :${API_PORT}`)
  }

  if (!webRunning) {
    log(`[app] Spawning Web: ${nodeExe} server.js in ${webServerDir}`)
    spawnServer(nodeExe, ['server.js'], webServerDir, {
      PORT:                String(WEB_PORT),
      HOSTNAME:            '127.0.0.1',
      NODE_ENV:            'production',
      NEXT_PUBLIC_API_URL: `http://localhost:${API_PORT}`,
    })
  } else {
    log(`[app] Web already on :${WEB_PORT}`)
  }
}

// ─── Windows ────────────────────────────────────────────────────────────────────

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 440, height: 300,
    frame: false, resizable: false, center: true,
    alwaysOnTop: true, backgroundColor: '#1e40af',
    webPreferences: { contextIsolation: true },
  })
  splashWindow.loadFile(path.join(__dirname, 'splash.html'))
}

function destroySplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    try { splashWindow.setAlwaysOnTop(false) } catch {}
    splashWindow.close()
    splashWindow = null
  }
}

async function createMainWindow(initialRoute) {
  mainWindow = new BrowserWindow({
    width: 1280, height: 820, minWidth: 960, minHeight: 600,
    title: 'Galaxy Cashier — جالاكسي كاشير', show: false, backgroundColor: '#f9fafb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, webSecurity: true,
    },
  })

  Menu.setApplicationMenu(null)

  let revealed = false
  const revealMain = () => {
    if (revealed || !mainWindow || mainWindow.isDestroyed()) return
    revealed = true
    destroySplash()
    if (!mainWindow.isVisible()) mainWindow.show()
    mainWindow.focus()
    if (IS_DEV) mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  mainWindow.once('ready-to-show', revealMain)
  mainWindow.webContents.once('did-finish-load', () => {
    // ready-to-show can fire before we attach listeners if loadURL resolves quickly
    setImmediate(revealMain)
  })

  // DevTools only in development
  if (IS_DEV) {
    globalShortcut.register('CommandOrControl+Shift+I', () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.toggleDevTools()
    })
  }

  // Use localhost (not 127.0.0.1) so Origin matches CORS + same-site cookies with API on localhost:4001
  const route = initialRoute || pendingRoute || '/'
  const loadUrl = route === '/'
    ? `http://localhost:${WEB_PORT}`
    : `http://localhost:${WEB_PORT}${route}`
  log(`[ui] loadURL ${loadUrl}`)
  try {
    await mainWindow.loadURL(loadUrl)
  } catch (e) {
    log(`[ui] loadURL error: ${e.message}`)
  }
  if (!mainWindow.webContents.isLoading()) revealMain()

  const splashFallback = setTimeout(() => {
    log('[ui] splash fallback — forcing main window visible')
    revealMain()
  }, 15_000)
  mainWindow.once('show', () => clearTimeout(splashFallback))

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const isLocal =
      url.startsWith(`http://127.0.0.1:${WEB_PORT}`) ||
      url.startsWith(`http://localhost:${WEB_PORT}`)
    if (isLocal) return { action: 'allow' }
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    globalShortcut.unregisterAll()
    mainWindow = null
  })
}

// ─── App lifecycle (primary instance only) ─────────────────────────────────────

if (gotLock) {
  app.whenReady().then(async () => {
    pendingRoute = parseLaunchRoute(process.argv)
    log(`[app] launch route: ${pendingRoute}`)
    createSplash()

    try {
      await startServers()

      // Wait for port TCP handshake first (fast)
      await Promise.all([
        waitForPort(API_PORT, 60_000),
        waitForPort(WEB_PORT, 120_000),
      ])

      // Then confirm the API is actually serving requests (5 retries × 2s)
      await waitForApiHealth(5, 2000)

      await createMainWindow(pendingRoute)
    } catch (err) {
      log(`[app] FATAL: ${err.message}`)
      if (err.stack) log(err.stack)
      destroySplash()
      dialog.showErrorBox(
        'Galaxy Cashier — خطأ في التشغيل',
        `${err.message}\n\nملف السجل (للدعم الفني):\n${LOG_FILE}`,
      )
      app.quit()
    }
  })

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createMainWindow()
  })
}

ipcMain.handle('select-backup-folder', async () => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow
  const result = await dialog.showOpenDialog(win || undefined, {
    title: 'اختر مجلد النسخ الاحتياطي',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || !result.filePaths?.[0]) return null
  return result.filePaths[0]
})

function readExitBackupConfig() {
  const cfgPath = path.join(os.homedir(), 'Documents', 'CASR', 'data', 'backup-config.json')
  const fallbackDir = path.join(os.homedir(), 'Documents', 'CASR-Backups')
  try {
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
    return {
      directory: (raw.directory && String(raw.directory).trim()) || fallbackDir,
      secondaryDirectory:
        raw.secondaryDirectory && String(raw.secondaryDirectory).trim()
          ? String(raw.secondaryDirectory).trim()
          : null,
      onExit: raw.onExit !== false,
    }
  } catch {
    return { directory: fallbackDir, secondaryDirectory: null, onExit: true }
  }
}

/** Sync copy with a hard wall-clock budget so a missing/slow USB never hangs quit. */
function copyWithBudget(src, dest, budgetMs = 2500) {
  const start = Date.now()
  fs.copyFileSync(src, dest)
  if (Date.now() - start > budgetMs) {
    throw new Error(`exit backup exceeded ${budgetMs}ms`)
  }
}

function tryCopyExitBackup(dbFile, directory, fileName) {
  if (!directory) return null
  try {
    const root = path.parse(directory).root
    if (root && !fs.existsSync(root)) return null
    fs.mkdirSync(directory, { recursive: true })
    const dest = path.join(directory, fileName)
    copyWithBudget(dbFile, dest, 2500)
    return dest
  } catch (e) {
    log(`[backup] Exit copy skipped/failed (${directory}): ${e.message}`)
    return null
  }
}

function performExitBackup() {
  const cfg = readExitBackupConfig()
  if (!cfg.onExit) {
    log('[backup] Exit backup skipped (disabled in settings)')
    return
  }
  const dbFile = path.join(os.homedir(), 'Documents', 'CASR', 'data', 'cashier.db')
  if (!fs.existsSync(dbFile)) {
    log('[backup] Exit backup skipped — no live DB')
    return
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const fileName = `cashier-exit-${stamp}.db`
  const primary = tryCopyExitBackup(dbFile, cfg.directory, fileName)
  if (primary) log(`[backup] Exit backup saved: ${primary}`)
  const secondary = tryCopyExitBackup(dbFile, cfg.secondaryDirectory, fileName)
  if (secondary) log(`[backup] Exit secondary backup saved: ${secondary}`)
}

let isQuitting = false

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (e) => {
  if (isQuitting) return
  // Never block quit on backup: run best-effort copy then always proceed.
  e.preventDefault()
  isQuitting = true
  const hardDeadline = setTimeout(() => {
    log('[backup] Exit backup deadline — forcing quit')
    try {
      killAll()
    } finally {
      app.exit(0)
    }
  }, 4000)
  try {
    performExitBackup()
  } catch (err) {
    log(`[backup] Exit backup error (ignored): ${err && err.message}`)
  } finally {
    clearTimeout(hardDeadline)
    killAll()
    app.quit()
  }
})

app.on('will-quit', () => {
  killAll()
})
