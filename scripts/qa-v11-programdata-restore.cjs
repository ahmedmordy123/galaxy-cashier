/**
 * Restore-live QA against ProgramData\GalaxyCashier\data (Setup path).
 *   node scripts/qa-v11-programdata-restore.cjs
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawn, execSync } = require('child_process')
const os = require('os')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'docs', 'QA-V11-PROGRAMDATA-RESTORE.json')
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
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

async function waitHealth(sec = 40) {
  for (let i = 0; i < sec * 2; i++) {
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

function ensureAcl() {
  fs.mkdirSync(DATA, { recursive: true })
  fs.mkdirSync(BACKUPS, { recursive: true })
  try {
    execSync(
      `icacls "${PD}" /inheritance:r /grant:r "NT AUTHORITY\\SYSTEM:(OI)(CI)F" /grant:r "BUILTIN\\Administrators:(OI)(CI)F" /grant:r "BUILTIN\\Users:(OI)(CI)M"`,
      { stdio: 'ignore' },
    )
    check('ProgramData ACL set', true, PD)
  } catch (e) {
    check('ProgramData ACL set', false, e.message)
  }
}

function integrityCheck() {
  const script = path.join(os.tmpdir(), `casr-pd-integ-${Date.now()}.cjs`)
  fs.writeFileSync(
    script,
    `const {PrismaClient}=require('@prisma/client');
const p=new PrismaClient({datasources:{db:{url:process.env.DATABASE_URL}}});
p.$queryRawUnsafe('PRAGMA integrity_check').then(async r=>{
  const v=Object.values(r[0]||{})[0]; console.log(String(v)); await p.$disconnect();
  if(String(v)!=='ok') process.exit(3);
}).catch(async e=>{console.error(e.message); process.exit(2);});`,
  )
  const r = require('child_process').spawnSync(NODE, [script], {
    cwd: API_DIR,
    env: {
      ...process.env,
      DATABASE_URL: 'file:' + DB.replace(/\\/g, '/'),
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
  ensureAcl()

  const docsDb = path.join(os.homedir(), 'Documents', 'CASR', 'data', 'cashier.db')
  const seed = path.join(ROOT, 'apps', 'desktop', 'assets', 'seed.db')
  const src = fs.existsSync(docsDb) ? docsDb : seed
  // Preserve existing ProgramData DB if present; else seed from docs/seed
  if (!fs.existsSync(DB)) {
    fs.copyFileSync(src, DB)
    check('seeded ProgramData DB', true, `from ${src}`)
  } else {
    check('using existing ProgramData DB', true, DB)
  }

  const beforeSize = fs.statSync(DB).size
  const child = spawn(NODE, ['server.js'], {
    cwd: API_DIR,
    env: {
      ...process.env,
      DATABASE_URL: 'file:' + DB.replace(/\\/g, '/'),
      PRISMA_QUERY_ENGINE_LIBRARY: ENGINE,
      PORT: '4001',
      JWT_SECRET: 'pd-restore-secret-key-32chars!!!!',
      JWT_REFRESH_SECRET: 'pd-restore-refresh-secret-key!!',
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

  const healthy = await waitHealth()
  check('API health on ProgramData absolute URL', healthy, DB)
  if (!healthy) {
    child.kill()
    finish()
    return
  }

  let token = null
  for (let i = 0; i < 30; i++) {
    const login = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    })
    const body = await login.json().catch(() => ({}))
    token = body?.data?.accessToken
    if (token) break
    await sleep(400)
  }
  check('login', !!token, '')
  if (!token) {
    child.kill()
    finish()
    return
  }
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const before = await (await fetch(`${API}/api/settings`, { headers: auth })).json()
  const beforeTax = String(before?.data?.tax_rate ?? '')
  check('read tax_rate', true, beforeTax)

  const bak = await (await fetch(`${API}/api/backup`, { method: 'POST', headers: auth })).json()
  const name = bak?.data?.name
  check('backup created in ProgramData\\backups', !!name && String(bak?.data?.path || '').includes('GalaxyCashier'), name)

  await fetch(`${API}/api/settings`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ tax_rate: '99' }),
  })
  const mid = await (await fetch(`${API}/api/settings`, { headers: auth })).json()
  check('mutated tax_rate=99', String(mid?.data?.tax_rate) === '99', String(mid?.data?.tax_rate))

  const restore = await (
    await fetch(`${API}/api/backup/restore`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ fileName: name }),
    })
  ).json()
  check('restore reconnected', restore?.success && restore?.data?.reconnected !== false, JSON.stringify(restore).slice(0, 180))

  const after = await (await fetch(`${API}/api/settings`, { headers: auth })).json()
  check(
    'post-restore tax restored without restart',
    String(after?.data?.tax_rate) !== '99',
    `after=${after?.data?.tax_rate} before=${beforeTax}`,
  )

  try {
    child.kill()
  } catch {
    /* */
  }
  await sleep(400)
  killPort(4001)
  const integ = integrityCheck()
  check('PRAGMA integrity_check', integ.ok, integ.out)
  check('ProgramData DB still present after test', fs.existsSync(DB), `size ${beforeSize}→${fs.statSync(DB).size}`)

  finish({ db: DB, backups: BACKUPS, name })
}

function finish(extra = {}) {
  const passed = results.filter((r) => r.ok).length
  fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), ...extra, passed, total: results.length, results }, null, 2))
  console.log(`done ${passed}/${results.length} → ${OUT}`)
  if (passed !== results.length) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  killPort(4001)
  process.exit(1)
})
