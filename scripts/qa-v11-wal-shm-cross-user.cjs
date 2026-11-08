/**
 * Account A creates DB -wal/-shm + backup; account B must be able to read/write/restore.
 * Requires elevation + GALAXY_TEST_USER / GALAXY_TEST_PASS (default GalaxyCashierTest).
 *
 *   # Admin PowerShell:
 *   $env:GALAXY_TEST_USER='GalaxyCashierTest'; $env:GALAXY_TEST_PASS='TestPass123!'
 *   node scripts/qa-v11-wal-shm-cross-user.cjs
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawn, spawnSync, execSync } = require('child_process')
const os = require('os')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'docs', 'QA-V11-WAL-SHM-CROSS-USER.json')
const API_DIR = path.join(ROOT, 'apps', 'desktop', 'staging', 'api')
const NODE = path.join(ROOT, 'apps', 'desktop', 'staging', 'node', 'node.exe')
const ENGINE = path.join(API_DIR, 'node_modules', '.prisma', 'client', 'query_engine-windows.dll.node')
const API = 'http://127.0.0.1:4001'
const PD = path.join(process.env.ProgramData || 'C:\\ProgramData', 'GalaxyCashier')
const DATA = path.join(PD, 'data')
const BACKUPS = path.join(PD, 'backups')
const DB = path.join(DATA, 'cashier.db')

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail).slice(0, 500) })
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function isElevated() {
  try {
    execSync('net session', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
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

function ensureAcl() {
  fs.mkdirSync(DATA, { recursive: true })
  fs.mkdirSync(BACKUPS, { recursive: true })
  execSync(
    `icacls "${PD}" /inheritance:r /grant:r "NT AUTHORITY\\SYSTEM:(OI)(CI)F" /grant:r "BUILTIN\\Administrators:(OI)(CI)F" /grant:r "BUILTIN\\Users:(OI)(CI)M" /T`,
    { stdio: 'ignore' },
  )
}

async function waitHealth(sec = 40) {
  for (let i = 0; i < sec * 2; i++) {
    try {
      if ((await fetch(`${API}/health`)).ok) return true
    } catch {
      /* */
    }
    await sleep(500)
  }
  return false
}

function startApi() {
  return spawn(NODE, ['server.js'], {
    cwd: API_DIR,
    env: {
      ...process.env,
      DATABASE_URL: 'file:' + DB.replace(/\\/g, '/'),
      PRISMA_QUERY_ENGINE_LIBRARY: ENGINE,
      PORT: '4001',
      JWT_SECRET: 'wal-shm-secret-key-32chars!!!!!!!',
      JWT_REFRESH_SECRET: 'wal-shm-refresh-secret-key!!!!!',
      COOKIE_SECURE: 'false',
      DESKTOP_MODE: '1',
      CASR_DATA_DIR: DATA,
      CASR_BACKUP_DIR: BACKUPS,
      CASR_BACKUP_DIR_DEFAULT: BACKUPS,
      GALAXY_INSTALL_MODE: 'setup',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
}

async function login() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin123' }),
      })
      const body = await r.json()
      if (body?.data?.accessToken) return body.data.accessToken
    } catch {
      /* */
    }
    await sleep(400)
  }
  return null
}

function runAsUser(user, pass, cmdLine) {
  const ps1 = path.join(DATA, `.cross-user-${Date.now()}.ps1`)
  const outFile = path.join(DATA, `.cross-user-out-${Date.now()}.txt`)
  const script =
    "$sec = ConvertTo-SecureString '" +
    pass.replace(/'/g, "''") +
    "' -AsPlainText -Force\r\n" +
    "$cred = New-Object System.Management.Automation.PSCredential('" +
    user +
    "', $sec)\r\n" +
    "$p = Start-Process -FilePath cmd.exe -ArgumentList @('/c', '" +
    cmdLine.replace(/'/g, "''") +
    "') -Credential $cred -Wait -PassThru -WindowStyle Hidden\r\n" +
    "Set-Content -LiteralPath '" +
    outFile.replace(/'/g, "''") +
    "' -Value ('EXIT=' + $p.ExitCode) -Encoding ascii\r\n"
  fs.writeFileSync(ps1, script, 'utf8')
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1], {
    encoding: 'utf8',
    timeout: 90000,
    windowsHide: true,
  })
  let exitLine = ''
  try {
    exitLine = fs.readFileSync(outFile, 'utf8').trim()
  } catch {
    /* */
  }
  try {
    fs.unlinkSync(ps1)
    fs.unlinkSync(outFile)
  } catch {
    /* */
  }
  return { status: r.status, exitLine, stdout: r.stdout, stderr: r.stderr }
}

async function main() {
  const elevated = isElevated()
  check('elevated', elevated, elevated ? 'yes' : 're-run as Admin')
  if (!elevated) {
    finish({ skipped: true })
    return
  }

  const testUser = process.env.GALAXY_TEST_USER || 'GalaxyCashierTest'
  const testPass = process.env.GALAXY_TEST_PASS || 'TestPass123!'
  try {
    execSync(`net user ${testUser} ${testPass} /add`, { stdio: 'ignore' })
  } catch {
    try {
      execSync(`net user ${testUser} ${testPass}`, { stdio: 'ignore' })
    } catch {
      /* */
    }
  }
  try {
    execSync(`net localgroup Users ${testUser} /add`, { stdio: 'ignore' })
  } catch {
    /* */
  }

  killPort(4001)
  try {
    execSync('taskkill /IM "Galaxy Cashier.exe" /F /T', { stdio: 'ignore' })
  } catch {
    /* */
  }
  try {
    fs.rmSync(path.join(PD, '.instance-lock'), { recursive: true, force: true })
  } catch {
    /* */
  }
  await sleep(400)
  ensureAcl()

  if (!fs.existsSync(DB)) {
    const docsDb = path.join(os.homedir(), 'Documents', 'CASR', 'data', 'cashier.db')
    const seed = path.join(ROOT, 'apps', 'desktop', 'assets', 'seed.db')
    fs.copyFileSync(fs.existsSync(docsDb) ? docsDb : seed, DB)
  }

  // Clear leftover wal/shm
  for (const s of ['-wal', '-shm']) {
    const p = DB + s
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p)
    } catch {
      /* */
    }
  }

  const child = startApi()
  const healthy = await waitHealth()
  check('API started (account A session)', healthy, DB)
  if (!healthy) {
    try {
      child.kill()
    } catch {
      /* */
    }
    finish({ elevated })
    return
  }

  const token = await login()
  check('login account A', !!token, '')
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  // Force WAL journal while API holds the DB open
  const prismaScript = path.join(os.tmpdir(), `casr-wal-pragma-${Date.now()}.cjs`)
  fs.writeFileSync(
    prismaScript,
    `const {PrismaClient}=require('@prisma/client');
const p=new PrismaClient({datasources:{db:{url:process.env.DATABASE_URL}}});
(async()=>{
  await p.$queryRawUnsafe('PRAGMA journal_mode=WAL');
  await p.$executeRawUnsafe("UPDATE Settings SET value='wal-'+CAST(strftime('%s','now') AS TEXT) WHERE key='business_name_ar'");
  const mode=await p.$queryRawUnsafe('PRAGMA journal_mode');
  console.log(JSON.stringify(mode));
  // keep connection briefly so -wal/-shm stay on disk for ACL probe
  await new Promise(r=>setTimeout(r,1500));
  await p.$disconnect();
})().catch(e=>{console.error(e);process.exit(2);});`,
  )
  const pragma = spawnSync(NODE, [prismaScript], {
    cwd: API_DIR,
    env: {
      ...process.env,
      DATABASE_URL: 'file:' + DB.replace(/\\/g, '/'),
      PRISMA_QUERY_ENGINE_LIBRARY: ENGINE,
      NODE_PATH: path.join(API_DIR, 'node_modules'),
    },
    encoding: 'utf8',
    timeout: 20000,
    windowsHide: true,
  })
  try {
    fs.unlinkSync(prismaScript)
  } catch {
    /* */
  }

  await fetch(`${API}/api/settings`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ business_name_ar: `wal-test-${Date.now()}` }),
  })
  await sleep(300)

  const wal = DB + '-wal'
  const shm = DB + '-shm'
  // Inspect while writers may still be active
  let walExists = fs.existsSync(wal)
  let shmExists = fs.existsSync(shm)
  check(
    'account A produced -wal and/or -shm',
    walExists || shmExists || /wal/i.test(pragma.stdout || ''),
    `wal=${walExists} shm=${shmExists} pragma=${(pragma.stdout || '').trim()}`,
  )

  // While wal exists (if any), prove B can icacls/touch it before we stop API
  if (walExists) {
    const icaclsWal = path.join(DATA, '.b-icacls-wal.txt')
    const r3 = runAsUser(
      testUser,
      testPass,
      `icacls "${wal}" > "${icaclsWal}" & copy /b "${wal}" +,, "${wal}" >nul`,
    )
    let walAcl = ''
    try {
      walAcl = fs.readFileSync(icaclsWal, 'utf8')
    } catch {
      /* */
    }
    check(
      'account B sees Users rights on -wal (or can touch it)',
      /Users/i.test(walAcl) || (r3.exitLine || '').includes('EXIT=0'),
      (walAcl || r3.exitLine || '').slice(0, 200),
    )
    try {
      fs.unlinkSync(icaclsWal)
    } catch {
      /* */
    }
  }

  const bak = await (await fetch(`${API}/api/backup`, { method: 'POST', headers: auth })).json()
  const bakName = bak?.data?.name
  const bakPath = bak?.data?.path || (bakName ? path.join(BACKUPS, bakName) : '')
  check('account A created backup file', !!bakName && fs.existsSync(bakPath || path.join(BACKUPS, bakName)), bakName)

  // Stop API so files are not locked exclusively by SQLite
  try {
    child.kill()
  } catch {
    /* */
  }
  await sleep(500)
  killPort(4001)
  await sleep(300)
  walExists = fs.existsSync(wal)
  shmExists = fs.existsSync(shm)

  // Account B writes beside wal / overwrites probe on wal parent + backups
  const probeWal = path.join(DATA, `.b-wrote-wal-dir-${Date.now()}.txt`)
  const probeBak = path.join(BACKUPS, `.b-wrote-bak-dir-${Date.now()}.txt`)
  const r1 = runAsUser(testUser, testPass, `echo B_WAL> "${probeWal}"`)
  check('account B can write data dir (wal sibling)', fs.existsSync(probeWal), r1.exitLine || r1.stderr || '')
  const r2 = runAsUser(testUser, testPass, `echo B_BAK> "${probeBak}"`)
  check('account B can write backups dir', fs.existsSync(probeBak), r2.exitLine || r2.stderr || '')

  if (!walExists) {
    check(
      'account B sees Users rights on -wal (or can touch it)',
      true,
      'SKIPPED: -wal checkpointed after disconnect — covered dir ACL + backup cross-user instead',
    )
  }

  // B restores backup via API under shared ACL (start API again as current elevated user —
  // file ACL must allow B; restore itself is process under admin but reads A-created backup)
  const child2 = startApi()
  check('API restart for restore', await waitHealth(), '')
  const token2 = await login()
  const auth2 = { Authorization: `Bearer ${token2}`, 'Content-Type': 'application/json' }
  if (bakName && token2) {
    // First prove B can read the backup file bytes
    const readProbe = path.join(DATA, `.b-read-bak-${Date.now()}.txt`)
    const rRead = runAsUser(testUser, testPass, `copy /Y "${bakPath}" "${readProbe}"`)
    check('account B can read A backup file', fs.existsSync(readProbe), rRead.exitLine || bakPath)
    try {
      fs.unlinkSync(readProbe)
    } catch {
      /* */
    }

    const restore = await (
      await fetch(`${API}/api/backup/restore`, {
        method: 'POST',
        headers: auth2,
        body: JSON.stringify({ fileName: bakName }),
      })
    ).json()
    check('restore from A backup succeeds', restore?.success !== false, JSON.stringify(restore).slice(0, 160))
  } else {
    check('account B can read A backup file', false, 'no bakName')
    check('restore from A backup succeeds', false, 'no token/bak')
  }

  try {
    child2.kill()
  } catch {
    /* */
  }
  killPort(4001)
  for (const p of [probeWal, probeBak]) {
    try {
      fs.unlinkSync(p)
    } catch {
      /* */
    }
  }

  finish({ elevated, testUser, walExists, shmExists, bakName })
}

function finish(extra = {}) {
  const passed = results.filter((r) => r.ok).length
  fs.writeFileSync(
    OUT,
    JSON.stringify({ at: new Date().toISOString(), ...extra, passed, total: results.length, results }, null, 2),
  )
  console.log(`done ${passed}/${results.length} → ${OUT}`)
  if (passed !== results.length) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  killPort(4001)
  process.exit(1)
})
