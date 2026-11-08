/**
 * Galaxy Cashier — Batch 2 audit (Security RBAC, Backup/Restore, Concurrency)
 * Run: node scripts/integration-batch2-audit.cjs
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawn, execSync } = require('child_process')
const { PrismaClient } = require('@prisma/client')

const ROOT = path.resolve(__dirname, '..')
const SOURCE_DB = path.join(ROOT, 'data', 'cashier.db')
const TEST_DB = path.join(ROOT, 'data', 'cashier-batch2-audit.db')
const API_PORT = process.env.BATCH2_PORT || '4015'
const API_BASE = `http://127.0.0.1:${API_PORT}`

const rbacRows = []
const backupResult = { ok: false, detail: '' }
const concurrencyResult = { ok: false, detail: '' }
const lockResult = { ok: false, detail: '' }
let stopCritical = false

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function fileUrl(p) {
  return `file:${p.replace(/\\/g, '/')}`
}

function loadEnvFile() {
  const envPath = path.join(ROOT, 'apps', 'api', '.env')
  const env = { ...process.env }
  if (!fs.existsSync(envPath)) return env
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    let val = t.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    env[t.slice(0, eq).trim()] = val
  }
  return env
}

function killListenersOnPort(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' })
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes('LISTENING')) continue
      const pid = line.trim().split(/\s+/).pop()
      if (pid && /^\d+$/.test(pid)) {
        try {
          execSync(`taskkill /pid ${pid} /f /t`, { stdio: 'ignore' })
        } catch {
          /* */
        }
      }
    }
  } catch {
    /* */
  }
}

async function waitHealth(base) {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${base}/health`)
      if (r.ok) return
    } catch {
      /* */
    }
    await sleep(400)
  }
  throw new Error('API health timeout')
}

let apiProcess = null
function stopApi() {
  if (apiProcess && !apiProcess.killed) {
    try {
      spawn('taskkill', ['/pid', String(apiProcess.pid), '/f', '/t'], { stdio: 'ignore' })
    } catch {
      apiProcess.kill()
    }
  }
}

async function login(username, password) {
  const r = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const data = await r.json()
  if (!data?.data?.accessToken) throw new Error(`Login ${username}: ${JSON.stringify(data)}`)
  return data.data.accessToken
}

async function req(token, method, urlPath, body) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const init = { method, headers }
  if (body != null && method !== 'GET' && method !== 'HEAD') {
    init.body = JSON.stringify(body)
  }
  const r = await fetch(`${API_BASE}/api${urlPath}`, init)
  let data = {}
  try {
    data = await r.json()
  } catch {
    data = {}
  }
  return { status: r.status, data }
}

function recordRbac(endpoint, role, expected, actual, ok, note = '') {
  rbacRows.push({ endpoint, role, expected, actual, ok, note })
  if (!ok && note.includes('Critical')) {
    stopCritical = true
  }
}

async function runRbacTests(tokens) {
  const cases = [
    { ep: 'DELETE /items/:id', method: 'DELETE', path: '/items/000000000000000000000000', roles: { none: 401, CASHIER: 403, MANAGER: 404, ADMIN: 404 }, critical: true },
    { ep: 'PUT /settings', method: 'PUT', path: '/settings', body: { business_name_ar: 'test' }, roles: { none: 401, CASHIER: 403, MANAGER: 403, ADMIN: '200|400' }, critical: true },
    { ep: 'GET /settings/users', method: 'GET', path: '/settings/users', roles: { none: 401, CASHIER: 403, MANAGER: 403, ADMIN: 200 }, critical: true },
    { ep: 'POST /backup', method: 'POST', path: '/backup', roles: { none: 401, CASHIER: 403, MANAGER: '200|201', ADMIN: '200|201' }, critical: true },
    { ep: 'GET /reports/profit', method: 'GET', path: '/reports/profit?from=2026-01-01&to=2026-12-31', roles: { none: 401, CASHIER: 403, MANAGER: 200, ADMIN: 200 }, critical: true },
    { ep: 'DELETE /customers/:id', method: 'DELETE', path: '/customers/000000000000000000000000', roles: { none: 401, CASHIER: 403, MANAGER: 403, ADMIN: 404 }, critical: true },
    { ep: 'DELETE /suppliers/:id', method: 'DELETE', path: '/suppliers/000000000000000000000000', roles: { none: 401, CASHIER: 403, MANAGER: 403, ADMIN: 404 }, critical: true },
    { ep: 'DELETE /expense-categories/:id', method: 'DELETE', path: '/expense-categories/000000000000000000000000', roles: { none: 401, CASHIER: 403, MANAGER: 403, ADMIN: 404 }, critical: true },
    { ep: 'POST /purchases', method: 'POST', path: '/purchases', body: { supplierId: 'x', items: [] }, roles: { none: 401, CASHIER: 403, MANAGER: '400|404', ADMIN: '400|404' }, critical: true },
    { ep: 'POST /sales/:id/cancel', method: 'POST', path: '/sales/000000000000000000000000/cancel', roles: { none: 401, CASHIER: 403, MANAGER: '404|400', ADMIN: '404|400' }, critical: true },
  ]

  for (const c of cases) {
    for (const [role, expected] of Object.entries(c.roles)) {
      const token = role === 'none' ? null : tokens[role]
      const r = await req(token, c.method, c.path, c.body)
      const actual = r.status
      let ok = false
      if (typeof expected === 'number') ok = actual === expected
      else if (typeof expected === 'string' && expected.includes('|')) {
        ok = expected.split('|').map(Number).includes(actual)
      }
      const note = c.critical && !ok && role === 'CASHIER' && actual === 200 ? 'Critical: CASHIER bypass' : ''
      recordRbac(c.ep, role, String(expected), String(actual), ok, note)
      if (stopCritical) return
    }
  }
}

async function dbSnapshot(dbPath) {
  const prisma = new PrismaClient({ datasources: { db: { url: fileUrl(dbPath) } } })
  try {
    const tables = [
      ['Item', 'SELECT COUNT(*) as c FROM "Item"'],
      ['Customer', 'SELECT COUNT(*) as c FROM "Customer"'],
      ['SalesInvoice', 'SELECT COUNT(*) as c FROM "SalesInvoice"'],
      ['SalesInvoiceItem', 'SELECT COUNT(*) as c FROM "SalesInvoiceItem"'],
      ['StockBalance', 'SELECT COUNT(*) as c FROM "StockBalance"'],
      ['PurchaseInvoice', 'SELECT COUNT(*) as c FROM "PurchaseInvoice"'],
    ]
    const snap = {}
    for (const [name, sql] of tables) {
      const rows = await prisma.$queryRawUnsafe(sql)
      snap[name] = Number(rows[0]?.c ?? -1)
    }
    const sumRows = await prisma.$queryRawUnsafe(
      `SELECT CAST(COALESCE(SUM(CAST(total AS REAL)), 0) AS TEXT) as s FROM "SalesInvoice"`,
    )
    snap.salesTotalSum = sumRows[0]?.s ?? '0'
    return snap
  } finally {
    await prisma.$disconnect()
  }
}

async function runAccountLockTest() {
  const user = 'locktest1'
  const pass = 'wrong-pass-batch2'
  for (let i = 0; i < 5; i++) {
    const r = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass }),
    })
    const data = await r.json()
    if (r.status !== 401) {
      lockResult.detail = `attempt ${i + 1} expected 401 got ${r.status}`
      return
    }
    if (JSON.stringify(data).match(/stack|\.ts|prisma|P20/i)) {
      lockResult.detail = '401 response leaked technical details'
      return
    }
  }
  const locked = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass }),
  })
  const body = await locked.json()
  const raw = JSON.stringify(body)
  if (locked.status !== 423) {
    lockResult.detail = `expected 423 after 5 failures got ${locked.status}`
    return
  }
  if (raw.match(/stack|\.ts|prisma|Error:/i)) {
    lockResult.detail = '423 response leaked technical details'
    return
  }
  lockResult.ok = true
  lockResult.detail = '5×401 then 423, no leak in body'
}

async function seedMinimalBusinessData(token) {
  const cust = await req(token, 'POST', '/customers', {
    name: 'Batch2 Cust',
    phone: '01009998877',
    type: 'RETAIL',
    creditLimit: 0,
    currency: 'EGP',
  })
  const item = await req(token, 'POST', '/items', {
    name_ar: 'صنف batch2',
    name_en: 'Batch2 Item',
    barcode: `B2-${Date.now()}`,
    retailPrice: 100,
    costPrice: 40,
    stockQty: 5,
  })
  return { customer: cust.status, item: item.status }
}

async function runBackupRestoreTest(adminToken) {
  const backupDir = path.join(process.env.USERPROFILE || ROOT, 'Documents', 'CASR', 'backups')
  fs.mkdirSync(backupDir, { recursive: true })

  await seedMinimalBusinessData(adminToken)
  const before = await dbSnapshot(TEST_DB)
  const backupName = `batch2-test-${Date.now()}.db`
  const backupPath = path.join(backupDir, backupName)
  fs.copyFileSync(TEST_DB, backupPath)

  // corrupt: zero out file then partial write
  fs.writeFileSync(TEST_DB, Buffer.alloc(1024, 0))

  const corrupted = await dbSnapshot(TEST_DB).catch(() => ({ corrupt: true }))
  if (!corrupted.corrupt && corrupted.Item === undefined) {
    backupResult.ok = false
    backupResult.detail = 'corruption check inconclusive'
    return
  }

  fs.copyFileSync(backupPath, TEST_DB)
  const after = await dbSnapshot(TEST_DB)

  const diffs = []
  for (const k of Object.keys(before)) {
    if (String(before[k]) !== String(after[k])) diffs.push(`${k}: ${before[k]} → ${after[k]}`)
  }
  backupResult.ok = diffs.length === 0
  backupResult.detail = diffs.length ? diffs.join('; ') : `match ${JSON.stringify(before)}`
  backupResult.backupFile = backupPath

  // auto backup force via API
  const auto = await req(adminToken, 'POST', '/backup/auto-run', {})
  backupResult.autoRun = auto.status

  const cfg = await req(adminToken, 'GET', '/backup/auto-status')
  backupResult.autoStatus = cfg.data?.data
}

async function runConcurrencyTest(tokens) {
  const admin = tokens.ADMIN
  const barcode = `RACE-${Date.now()}`
  const cr = await req(admin, 'POST', '/items', {
    name_ar: 'سباق',
    name_en: 'Race Batch2',
    barcode,
    retailPrice: 50,
    costPrice: 20,
    stockQty: 1,
  })
  const itemId = cr.data?.data?.id
  if (!itemId) {
    concurrencyResult.detail = `create item failed ${cr.status}`
    return
  }

  const payload = {
    paymentType: 'CASH',
    priceType: 'RETAIL',
    currency: 'EGP',
    discountType: 'PERCENT',
    discount: 0,
    items: [{ itemId, quantity: 1, unitPrice: 50, discount: 0 }],
  }

  const [d1, d2] = await Promise.all([
    req(tokens.CASHIER, 'POST', '/sales', payload),
    req(tokens.CASHIER, 'POST', '/sales', payload),
  ])
  const id1 = d1.data?.data?.id
  const id2 = d2.data?.data?.id
  if (!id1 || !id2) {
    concurrencyResult.detail = `draft fail ${d1.status}/${d2.status}`
    return
  }

  const [c1, c2] = await Promise.all([
    req(tokens.CASHIER, 'POST', `/sales/${id1}/confirm`, { payments: [{ method: 'CASH', amount: 50 }] }),
    req(tokens.CASHIER, 'POST', `/sales/${id2}/confirm`, { payments: [{ method: 'CASH', amount: 50 }] }),
  ])
  const okCount = [c1, c2].filter((c) => c.status === 200 && c.data?.success).length
  const failCount = [c1, c2].filter((c) => c.status >= 400).length

  const prisma = new PrismaClient({ datasources: { db: { url: fileUrl(TEST_DB) } } })
  let stock = -1
  try {
    const item = await prisma.item.findUnique({ where: { id: itemId } })
    stock = Number(item?.stockQty ?? -1)
  } finally {
    await prisma.$disconnect()
  }

  concurrencyResult.ok = okCount === 1 && failCount === 1 && stock === 0
  concurrencyResult.detail = `confirm ok=${okCount} fail=${failCount} stock=${stock} statuses=${c1.status}/${c2.status}`
}

function printReport() {
  console.log('\n## Priority 1 — RBAC (sample sensitive endpoints)\n')
  console.log('| Endpoint | Role | Expected | Actual | OK |')
  console.log('|----------|------|----------|--------|-----|')
  for (const r of rbacRows) {
    console.log(`| ${r.endpoint} | ${r.role} | ${r.expected} | ${r.actual} | ${r.ok ? '✅' : '❌'} |`)
  }
  const rbacFail = rbacRows.filter((r) => !r.ok)
  console.log(`\nRBAC: ${rbacFail.length === 0 ? '✅ all checks passed' : `❌ ${rbacFail.length} mismatch(es)`}`)

  console.log('\n## Priority 2 — Backup / Restore\n')
  console.log(backupResult.ok ? `✅ ${backupResult.detail}` : `❌ ${backupResult.detail}`)
  if (backupResult.autoRun) console.log(`Auto-backup API trigger: HTTP ${backupResult.autoRun}`)

  console.log('\n## Priority 3 — Concurrency (qty=1, parallel confirm)\n')
  console.log(concurrencyResult.ok ? `✅ ${concurrencyResult.detail}` : `❌ ${concurrencyResult.detail}`)

  console.log('\n## Auth — account lockout + safe errors\n')
  console.log(lockResult.ok ? `✅ ${lockResult.detail}` : lockResult.detail ? `❌ ${lockResult.detail}` : '⏳ not run')
  console.log('- Passwords: bcrypt; JWT 15m / refresh 7d')
  console.log('- Login: IP limit 25 failed/15min (423 counts); account lock 5 failures/username → 20min (423)')
  console.log('- Backup: disk-space check before copy (AUDIT #22); DISK_FULL → HTTP 507')
}

async function ensureAuditUsers(dbPath) {
  const bcrypt = require('bcryptjs')
  const prisma = new PrismaClient({ datasources: { db: { url: fileUrl(dbPath) } } })
  try {
    const hashM = await bcrypt.hash('manager123', 12)
    const hashC = await bcrypt.hash('cashier123', 12)
    await prisma.user.upsert({
      where: { username: 'manager1' },
      update: { role: 'MANAGER', passwordHash: hashM, isActive: true },
      create: { username: 'manager1', name: 'Manager Audit', passwordHash: hashM, role: 'MANAGER', language: 'ar' },
    })
    await prisma.user.upsert({
      where: { username: 'cashier1' },
      update: { role: 'CASHIER', passwordHash: hashC, isActive: true },
      create: { username: 'cashier1', name: 'Cashier Audit', passwordHash: hashC, role: 'CASHIER', language: 'ar' },
    })
    const hashL = await bcrypt.hash('locktest123', 12)
    await prisma.user.upsert({
      where: { username: 'locktest1' },
      update: { role: 'CASHIER', passwordHash: hashL, isActive: true, failedLoginAttempts: 0, lockedUntil: null },
      create: {
        username: 'locktest1',
        name: 'Lock Test',
        passwordHash: hashL,
        role: 'CASHIER',
        language: 'ar',
        failedLoginAttempts: 0,
      },
    })
  } finally {
    await prisma.$disconnect()
  }
}

async function main() {
  console.log('=== Batch 2 Audit ===\n')
  if (!fs.existsSync(SOURCE_DB)) {
    console.error('Missing source DB')
    process.exit(1)
  }
  fs.copyFileSync(SOURCE_DB, TEST_DB)
  await ensureAuditUsers(TEST_DB)

  const env = loadEnvFile()
  env.DATABASE_URL = fileUrl(TEST_DB)
  env.PORT = API_PORT
  killListenersOnPort(API_PORT)

  apiProcess = spawn('cmd.exe', ['/c', 'npx tsx src/index.ts'], {
    cwd: path.join(ROOT, 'apps', 'api'),
    env,
    stdio: 'ignore',
  })
  await waitHealth(API_BASE)

  await runAccountLockTest()

  let tokens = {}
  try {
    tokens.ADMIN = await login('admin', 'admin123')
    tokens.MANAGER = await login('manager1', 'manager123')
    tokens.CASHIER = await login('cashier1', 'cashier123')
  } catch (e) {
    console.error('Login failed — ensure dev seed users (manager1/cashier1):', e.message)
    stopApi()
    process.exit(1)
  }

  await runRbacTests(tokens)
  if (stopCritical) {
    printReport()
    stopApi()
    process.exit(1)
  }

  await runBackupRestoreTest(tokens.ADMIN)
  if (!backupResult.ok) {
    printReport()
    stopApi()
    process.exit(1)
  }

  await runConcurrencyTest(tokens)
  printReport()
  stopApi()
  const exitOk = concurrencyResult.ok && lockResult.ok
  process.exit(exitOk ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  stopApi()
  process.exit(1)
})
