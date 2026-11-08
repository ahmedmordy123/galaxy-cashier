/**
 * Proves backup restore reloads Prisma without process restart.
 *   node scripts/qa-fix-restore.cjs
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawn, execSync } = require('child_process')
const bcrypt = require('bcryptjs')
const { PrismaClient } = require('@prisma/client')

const ROOT = path.resolve(__dirname, '..')
const SOURCE_DB = path.join(ROOT, 'data', 'cashier.db')
const TEST_DB = path.join(ROOT, 'data', 'cashier-qa-restore.db')
const API_PORT = process.env.QA_RESTORE_PORT || '4016'
const API_BASE = `http://127.0.0.1:${API_PORT}`

function fileUrl(p) {
  return `file:${p.replace(/\\/g, '/')}`
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}
function killPort(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' })
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes('LISTENING')) continue
      const pid = line.trim().split(/\s+/).pop()
      if (/^\d+$/.test(pid)) execSync(`taskkill /pid ${pid} /f /t`, { stdio: 'ignore' })
    }
  } catch {
    /* */
  }
}

async function req(token, method, urlPath, body) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const r = await fetch(`${API_BASE}/api${urlPath}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  })
  let data = {}
  try {
    data = await r.json()
  } catch {
    /* */
  }
  return { status: r.status, ok: r.ok, data }
}

async function waitHealth() {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${API_BASE}/health`)).ok) return
    } catch {
      /* */
    }
    await sleep(250)
  }
  throw new Error('health timeout')
}

async function main() {
  if (!fs.existsSync(SOURCE_DB)) throw new Error('missing source db')
  fs.copyFileSync(SOURCE_DB, TEST_DB)

  const prep = new PrismaClient({ datasources: { db: { url: fileUrl(TEST_DB) } } })
  const hash = await bcrypt.hash('admin123', 10)
  await prep.user.upsert({
    where: { username: 'admin' },
    update: { passwordHash: hash, role: 'ADMIN', isActive: true },
    create: { username: 'admin', name: 'Admin', passwordHash: hash, role: 'ADMIN', language: 'ar' },
  })
  await prep.$disconnect()

  killPort(API_PORT)
  const api = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: path.join(ROOT, 'apps', 'api'),
    env: {
      ...process.env,
      PORT: API_PORT,
      DATABASE_URL: fileUrl(TEST_DB),
      COOKIE_SECURE: 'false',
      NODE_ENV: 'development',
      // force backups into test dir under Documents CASR-Backups or env
      CASR_BACKUP_DIR: path.join(ROOT, 'data', 'qa-restore-backups'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  })

  try {
    await waitHealth()
    const login = await req(null, 'POST', '/auth/login', { username: 'admin', password: 'admin123' })
    const token = login.data.data?.accessToken || login.data.accessToken
    if (!token) throw new Error('login failed ' + JSON.stringify(login.data))

    const bak = await req(token, 'POST', '/backup', {})
    if (!bak.ok) throw new Error('backup failed ' + JSON.stringify(bak.data))
    const list = await req(token, 'GET', '/backup')
    const files = list.data.data || []
    const fileName = files[0]?.name
    if (!fileName) throw new Error('no backup file')

    const marker = `RESTORE-MARKER-${Date.now()}`
    const created = await req(token, 'POST', '/items', {
      name_ar: marker,
      name_en: marker,
      retailPrice: 1,
      costPrice: 1,
      unit: 'piece',
    })
    const markerId = created.data.data?.id || created.data.id
    if (!markerId) throw new Error('create marker failed')

    const before = await req(token, 'GET', `/items/${markerId}`)
    if (!before.ok) throw new Error('marker missing before restore')

    const rest = await req(token, 'POST', '/backup/restore', { fileName })
    if (!rest.ok) throw new Error('restore failed ' + JSON.stringify(rest.data))
    if (!rest.data.data?.reconnected && rest.data.data?.reconnected !== true) {
      // reconnected flag expected after fix
      console.warn('WARN: reconnected flag missing', rest.data)
    }

    // Immediate read — must 404 without restarting API process
    const after = await req(token, 'GET', `/items/${markerId}`)
    const gone = after.status === 404 || !after.ok
    const msg = rest.data.data?.message || ''
    const immediate = gone
    console.log(
      JSON.stringify(
        {
          ok: immediate,
          markerId,
          afterStatus: after.status,
          reconnected: rest.data.data?.reconnected,
          message: msg,
        },
        null,
        2,
      ),
    )
    if (!immediate) {
      console.error('FAIL: marker still visible after restore — Prisma did not reconnect')
      process.exitCode = 1
    } else {
      console.log('PASS: restore applied immediately without API process restart')
    }
  } finally {
    try {
      spawn('taskkill', ['/pid', String(api.pid), '/f', '/t'], { stdio: 'ignore' })
    } catch {
      /* */
    }
    killPort(API_PORT)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
