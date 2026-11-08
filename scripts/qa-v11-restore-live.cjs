/**
 * Backup → mutate live DB → Restore → verify API sees restored data WITHOUT restart
 * + SQLite integrity_check on the live file.
 *
 *   node scripts/qa-v11-restore-live.cjs
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawn, execSync } = require('child_process')
const os = require('os')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'docs', 'QA-V11-RESTORE-LIVE.json')
const API_DIR = path.join(ROOT, 'apps', 'desktop', 'staging', 'api')
const NODE = path.join(ROOT, 'apps', 'desktop', 'staging', 'node', 'node.exe')
const ENGINE = path.join(
  API_DIR,
  'node_modules',
  '.prisma',
  'client',
  'query_engine-windows.dll.node',
)
const API = 'http://127.0.0.1:4001'

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitHealth(sec = 60) {
  for (let i = 0; i < sec; i++) {
    try {
      const r = await fetch(`${API}/health`)
      if (r.ok) return true
    } catch {
      /* */
    }
    await sleep(500)
  }
  return false
}

function killPort(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' })
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes('LISTENING')) continue
      const pid = line.trim().split(/\s+/).pop()
      if (/^\d+$/.test(pid)) {
        try {
          execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'ignore' })
        } catch {
          /* */
        }
      }
    }
  } catch {
    /* */
  }
}

function integrityCheck(dbFile) {
  const script = path.join(os.tmpdir(), `casr-integrity-${Date.now()}.cjs`)
  fs.writeFileSync(
    script,
    `
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
p.$queryRawUnsafe('PRAGMA integrity_check')
  .then(async (r) => {
    const v = r?.[0]?.integrity_check ?? r?.[0]?.integrity_check ?? Object.values(r?.[0] || {})[0];
    console.log(String(v));
    await p.$disconnect();
    if (String(v) !== 'ok') process.exit(3);
  })
  .catch(async (e) => { console.error(e.message || e); process.exit(2); });
`,
  )
  const r = require('child_process').spawnSync(NODE, [script], {
    cwd: path.dirname(dbFile),
    env: {
      ...process.env,
      DATABASE_URL: 'file:./' + path.basename(dbFile),
      PRISMA_QUERY_ENGINE_LIBRARY: ENGINE,
      NODE_PATH: path.join(API_DIR, 'node_modules'),
    },
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true,
  })
  try {
    fs.unlinkSync(script)
  } catch {
    /* */
  }
  const out = ((r.stdout || '') + (r.stderr || '')).trim()
  return { ok: r.status === 0 && out.includes('ok'), out }
}

async function main() {
  killPort(4001)
  await sleep(500)

  const dataDir = path.join(os.tmpdir(), `casr-restore-${Date.now()}`)
  const backupsDir = path.join(dataDir, 'backups')
  fs.mkdirSync(backupsDir, { recursive: true })
  // Prefer a known-good live DB (schema+admin) over raw seed for restore QA
  const docsDb = path.join(os.homedir(), 'Documents', 'CASR', 'data', 'cashier.db')
  const seed = path.join(ROOT, 'apps', 'desktop', 'assets', 'seed.db')
  const dbFile = path.join(dataDir, 'cashier.db')
  const srcDb = fs.existsSync(docsDb) ? docsDb : seed
  fs.copyFileSync(srcDb, dbFile)
  console.log(`using source DB: ${srcDb}`)

  // Junction access (Prisma ignores cwd for file:./ — use absolute space-free URL)
  const juncParent = path.join(process.env.ProgramData || 'C:\\ProgramData', 'GalaxyCashier')
  const junc = path.join(juncParent, 'restore-qa-live')
  fs.mkdirSync(juncParent, { recursive: true })
  try {
    if (fs.existsSync(junc)) execSync(`cmd /c rmdir "${junc}"`, { stdio: 'ignore' })
  } catch {
    /* */
  }
  execSync(`cmd /c mklink /J "${junc}" "${dataDir}"`, { stdio: 'ignore' })
  const dbUrl = 'file:' + junc.replace(/\\/g, '/') + '/cashier.db'

  const child = spawn(NODE, ['server.js'], {
    cwd: API_DIR,
    env: {
      ...process.env,
      DATABASE_URL: dbUrl,
      PRISMA_QUERY_ENGINE_LIBRARY: ENGINE,
      PORT: '4001',
      JWT_SECRET: 'restore-test-secret-key-32chars!!',
      JWT_REFRESH_SECRET: 'restore-test-refresh-secret-key!',
      COOKIE_SECURE: 'false',
      DESKTOP_MODE: '1',
      CASR_DATA_DIR: dataDir,
      CASR_DOCUMENTS_DIR: dataDir,
      CASR_BACKUP_DIR: backupsDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let apiLog = ''
  child.stdout.on('data', (d) => {
    apiLog += d.toString()
  })
  child.stderr.on('data', (d) => {
    apiLog += d.toString()
  })

  const healthy = await waitHealth(40)
  check('API health with cwd-relative DB', healthy, apiLog.slice(-200))
  if (!healthy) {
    try {
      child.kill()
    } catch {
      /* */
    }
    finish()
    return
  }

  // ensureSqliteSchema is async after listen — retry login until schema ready
  let token = null
  let loginStatus = 0
  for (let i = 0; i < 30; i++) {
    const login = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    })
    loginStatus = login.status
    const loginBody = await login.json().catch(() => ({}))
    token = loginBody?.data?.accessToken || null
    if (token) break
    await sleep(500)
  }
  check('login', !!token, String(loginStatus))
  if (!token) {
    child.kill()
    finish()
    return
  }

  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  // Snapshot a known setting
  const beforeSet = await fetch(`${API}/api/settings`, { headers: auth })
  const beforeJson = await beforeSet.json()
  const beforeTax = String(beforeJson?.data?.tax_rate ?? '')
  check('read settings before backup', beforeSet.ok, `tax_rate=${beforeTax}`)

  // Create backup via API
  const bak = await fetch(`${API}/api/backup`, { method: 'POST', headers: auth })
  const bakJson = await bak.json().catch(() => ({}))
  check('create backup', bak.ok, JSON.stringify(bakJson).slice(0, 180))
  const fileName = bakJson?.data?.name || bakJson?.data?.fileName || bakJson?.data?.filename || null

  // List backups if name missing
  let restoreName = fileName
  if (!restoreName) {
    const list = await fetch(`${API}/api/backup`, { headers: auth })
    const listJson = await list.json().catch(() => ({}))
    const files = listJson?.data || []
    restoreName = files[0]?.name || files[0]?.fileName
    check('list backups for name', !!restoreName, JSON.stringify(files).slice(0, 200))
  } else {
    check('backup fileName present', true, restoreName)
  }

  // Mutate live data AFTER backup
  const marker = '99'
  const put = await fetch(`${API}/api/settings`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ tax_rate: marker }),
  })
  check('mutate tax_rate after backup', put.ok || put.status === 200, String(put.status))
  const mid = await fetch(`${API}/api/settings`, { headers: auth })
  const midJson = await mid.json()
  const midTax = String(midJson?.data?.tax_rate ?? '')
  check('mutated value visible', midTax === marker, String(midTax))

  // Restore (must reconnect Prisma in-process)
  const restore = await fetch(`${API}/api/backup/restore`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ fileName: restoreName }),
  })
  const restoreJson = await restore.json().catch(() => ({}))
  check(
    'restore API ok',
    restore.ok && (restoreJson?.data?.reconnected === true || restoreJson?.success === true),
    JSON.stringify(restoreJson).slice(0, 240),
  )

  // Immediate read WITHOUT restart
  const after = await fetch(`${API}/api/settings`, { headers: auth })
  const afterJson = await after.json().catch(() => ({}))
  const afterTax = String(afterJson?.data?.tax_rate ?? '')
  check(
    'post-restore tax_rate restored (no process restart)',
    after.ok && afterTax !== marker,
    `after=${afterTax} marker=${marker} before=${beforeTax}`,
  )

  // integrity_check on live file
  try {
    child.kill()
  } catch {
    /* */
  }
  await sleep(500)
  killPort(4001)
  const integ = integrityCheck(dbFile)
  check('PRAGMA integrity_check == ok', integ.ok, integ.out)

  try {
    if (fs.existsSync(junc)) execSync(`cmd /c rmdir "${junc}"`, { stdio: 'ignore' })
  } catch {
    /* */
  }
  try {
    fs.rmSync(dataDir, { recursive: true, force: true })
  } catch {
    /* */
  }
  finish({ restoreName, beforeTax, midTax, afterTax, dbUrl })
}

function finish(extra = {}) {
  const passed = results.filter((r) => r.ok).length
  const payload = { at: new Date().toISOString(), ...extra, passed, total: results.length, results }
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2))
  console.log(`done ${passed}/${results.length} → ${OUT}`)
  if (passed !== results.length) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  killPort(4001)
  process.exit(1)
})
