/**
 * Galaxy Cashier — Batch 3 audit (Phase A: reconcile, shift cash, unified aggregates)
 * Run: node scripts/integration-batch3-audit.cjs
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawn, execSync } = require('child_process')
const { PrismaClient } = require('@prisma/client')

const ROOT = path.resolve(__dirname, '..')
const SOURCE_DB = path.join(ROOT, 'data', 'cashier.db')
const TEST_DB = path.join(ROOT, 'data', 'cashier-batch3-audit.db')
const API_PORT = process.env.BATCH3_PORT || '4016'
const API_BASE = `http://127.0.0.1:${API_PORT}`

const results = []

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

function pass(name, detail) {
  results.push({ name, ok: true, detail })
  console.log(`✅ ${name}${detail ? ` — ${detail}` : ''}`)
}

function fail(name, detail) {
  results.push({ name, ok: false, detail })
  console.log(`❌ ${name} — ${detail}`)
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
  if (body != null && method !== 'GET' && method !== 'HEAD') init.body = JSON.stringify(body)
  const r = await fetch(`${API_BASE}/api${urlPath}`, init)
  let data = {}
  try {
    data = await r.json()
  } catch {
    data = {}
  }
  return { status: r.status, data }
}

async function testCustomerReconcile(adminToken) {
  const cust = await req(adminToken, 'POST', '/customers', {
    name: 'Batch3 Credit',
    phone: '01001112233',
    type: 'RETAIL',
    creditLimit: 50000,
    currency: 'EGP',
  })
  const customerId = cust.data?.data?.id
  if (!customerId) return fail('A1 reconcile', `create customer ${cust.status}`)

  const item = await req(adminToken, 'POST', '/items', {
    name_ar: 'ب3',
    name_en: 'B3',
    barcode: `B3-${Date.now()}`,
    retailPrice: 1000,
    costPrice: 400,
    stockQty: 10,
  })
  const itemId = item.data?.data?.id
  if (!itemId) return fail('A1 reconcile', 'create item')

  const draft = await req(adminToken, 'POST', '/sales', {
    paymentType: 'CREDIT',
    customerId,
    priceType: 'RETAIL',
    currency: 'EGP',
    discountType: 'PERCENT',
    discount: 0,
    items: [{ itemId, quantity: 1, unitPrice: 1000, discount: 0 }],
  })
  const invId = draft.data?.data?.id
  const conf = await req(adminToken, 'POST', `/sales/${invId}/confirm`, {
    payments: [{ method: 'CREDIT', amount: 1000 }],
  })
  if (conf.status !== 200) return fail('A1 reconcile', `confirm ${conf.status}`)

  const vch = await req(adminToken, 'POST', '/vouchers', {
    type: 'RECEIPT',
    entityType: 'CUSTOMER',
    entityId: customerId,
    amount: 400,
    currency: 'EGP',
    exchangeRate: 1,
    description: 'batch3 receipt',
  })
  if (vch.status !== 201 && vch.status !== 200) return fail('A1 reconcile', `voucher ${vch.status}`)

  const rec = await req(adminToken, 'GET', `/customers/${customerId}/reconcile`)
  const stored = rec.data?.data?.storedBalance
  const computed = rec.data?.data?.computedBalance
  if (Math.abs(stored - 600) > 0.02 || Math.abs(computed - 600) > 0.02 || !rec.data?.data?.inSync) {
    return fail('A1 reconcile', `expected 600/600 inSync got ${stored}/${computed}`)
  }
  pass('A1 customer reconcile in sync', '600 EGP')

  const prisma = new PrismaClient({ datasources: { db: { url: fileUrl(TEST_DB) } } })
  try {
    await prisma.$executeRawUnsafe(`UPDATE "Customer" SET balance = 999 WHERE id = ?`, customerId)
  } finally {
    await prisma.$disconnect()
  }

  const rec2 = await req(adminToken, 'GET', `/customers/${customerId}/reconcile`)
  if (rec2.data?.data?.inSync) return fail('A1 reconcile fix', 'expected out of sync after manual edit')

  const fix = await req(adminToken, 'POST', `/customers/${customerId}/reconcile`)
  if (!fix.data?.data?.adjusted || !fix.data?.data?.inSync) {
    return fail('A1 reconcile fix', JSON.stringify(fix.data))
  }
  pass('A1 POST reconcile corrects drift', '999 → 600')
}

async function testShiftExpectedCash(adminToken, cashierToken) {
  await req(cashierToken, 'POST', '/ops/shifts/open', { openingCash: 500 })

  const item = await req(adminToken, 'POST', '/items', {
    name_ar: 'وردية',
    name_en: 'Shift Item',
    barcode: `SH-${Date.now()}`,
    retailPrice: 1000,
    costPrice: 300,
    stockQty: 5,
  })
  const itemId = item.data?.data?.id
  if (!itemId) return fail('A2 shift cash', 'item')

  const d1 = await req(cashierToken, 'POST', '/sales', {
    paymentType: 'CASH',
    priceType: 'RETAIL',
    currency: 'EGP',
    discountType: 'PERCENT',
    discount: 0,
    items: [{ itemId, quantity: 2, unitPrice: 500, discount: 0 }],
  })
  const invId = d1.data?.data?.id
  const c1 = await req(cashierToken, 'POST', `/sales/${invId}/confirm`, {
    payments: [{ method: 'CASH', amount: 1000 }],
  })
  if (c1.status !== 200) return fail('A2 shift cash', `confirm ${c1.status}`)

  const pr = await req(cashierToken, 'POST', `/sales/${invId}/partial-return`, {
    items: [{ itemId, quantity: 1 }],
  })
  if (pr.status !== 200) return fail('A2 shift cash', `partial return ${pr.status}`)

  let refundTotal = 0
  if (pr.data?.data?.payments) {
    for (const p of pr.data.data.payments) {
      if (p.method === 'REFUND') refundTotal += Number(p.amount)
    }
  }
  if (refundTotal <= 0) {
    const sum = await req(cashierToken, 'GET', '/ops/shifts/current/summary')
    refundTotal = sum.data?.data?.cashBreakdown?.cashRefunds ?? 500
  }

  const cat = await req(adminToken, 'POST', '/expense-categories', { nameAr: 'عام', nameEn: 'General' })
  const categoryId = cat.data?.data?.id
  if (!categoryId) return fail('A2 shift cash', 'expense category')

  const today = new Date().toISOString().slice(0, 10)
  const exp = await req(cashierToken, 'POST', '/expenses', {
    categoryId,
    amount: 100,
    currency: 'EGP',
    description: 'drawer expense',
    date: today,
  })
  if (exp.status !== 201 && exp.status !== 200) return fail('A2 shift cash', `expense ${exp.status}`)

  const dis = await req(cashierToken, 'POST', '/vouchers', {
    type: 'DISBURSEMENT',
    entityType: 'OTHER',
    amount: 50,
    currency: 'EGP',
    exchangeRate: 1,
    description: 'petty cash out',
  })
  if (dis.status !== 201 && dis.status !== 200) return fail('A2 shift cash', `disbursement ${dis.status}`)

  const expected = 500 + 1000 - refundTotal - 100 - 50
  const close = await req(cashierToken, 'POST', '/ops/shifts/close', { closingCash: expected })
  const expCash = close.data?.data?.expectedCash ?? close.data?.data?.cashBreakdown?.expectedCash
  const diff = close.data?.data?.cashDifference
  if (Math.abs(Number(expCash) - expected) > 0.02) {
    return fail('A2 shift cash', `expectedCash ${expCash} want ${expected}`)
  }
  if (Math.abs(Number(diff)) > 0.02) {
    return fail('A2 shift cash', `difference ${diff} want 0`)
  }
  pass('A2 shift expectedCash', `${expected} (opening+cash−refund−expense−disburse)`)
}

async function testUnifiedCashMetrics(adminToken) {
  const dash = await req(adminToken, 'GET', '/reports/today-summary')
  const stmt = await req(adminToken, 'GET', '/cash-statement/today')
  const dashCash = dash.data?.data?.cashSalesEGP
  const stmtCash = stmt.data?.data?.cashSalesEGP
  if (dashCash == null || stmtCash == null) {
    return fail('A3 unified cash', `missing fields dash=${dashCash} stmt=${stmtCash}`)
  }
  if (Math.abs(Number(dashCash) - Number(stmtCash)) > 0.02) {
    return fail('A3 unified cash', `dashboard ${dashCash} vs statement ${stmtCash}`)
  }
  pass('A3 dashboard cash = cash statement', String(dashCash))
}

async function main() {
  console.log('=== Batch 3 Audit — Phase A ===\n')
  if (!fs.existsSync(SOURCE_DB)) {
    console.error('Missing source DB')
    process.exit(1)
  }
  fs.copyFileSync(SOURCE_DB, TEST_DB)

  const env = loadEnvFile()
  env.DATABASE_URL = fileUrl(TEST_DB)
  env.PORT = API_PORT
  env.ETA_MOCK_SUBMIT = 'true'
  killListenersOnPort(API_PORT)

  apiProcess = spawn('cmd.exe', ['/c', 'npx tsx src/index.ts'], {
    cwd: path.join(ROOT, 'apps', 'api'),
    env,
    stdio: 'ignore',
  })
  await waitHealth(API_BASE)

  const adminToken = await login('admin', 'admin123')
  let cashierToken
  try {
    cashierToken = await login('cashier1', 'cashier123')
  } catch {
    const bcrypt = require('bcryptjs')
    const prisma = new PrismaClient({ datasources: { db: { url: fileUrl(TEST_DB) } } })
    const hash = await bcrypt.hash('cashier123', 12)
    await prisma.user.upsert({
      where: { username: 'cashier1' },
      update: { passwordHash: hash, role: 'CASHIER', isActive: true },
      create: { username: 'cashier1', name: 'Cashier', passwordHash: hash, role: 'CASHIER', language: 'ar' },
    })
    await prisma.$disconnect()
    cashierToken = await login('cashier1', 'cashier123')
  }

  await testCustomerReconcile(adminToken)
  await testShiftExpectedCash(adminToken, cashierToken)
  await testUnifiedCashMetrics(adminToken)
  await testAuditAndParkedLock(adminToken, cashierToken)
  await testPurchaseSupplierRef(adminToken)
  await testEtaQueue(adminToken)

  stopApi()
  const failed = results.filter((r) => !r.ok)
  console.log(`\nBatch 3 total: ${failed.length === 0 ? '✅ all passed' : `❌ ${failed.length} failed`}`)
  process.exit(failed.length ? 1 : 0)
}

async function testAuditAndParkedLock(adminToken, cashierToken) {
  const item = await req(adminToken, 'POST', '/items', {
    name_ar: 'قفل',
    name_en: 'Lock',
    barcode: `LK-${Date.now()}`,
    retailPrice: 10,
    costPrice: 5,
    stockQty: 10,
  })
  const itemId = item.data?.data?.id
  const d = await req(cashierToken, 'POST', '/sales', {
    paymentType: 'CASH',
    priceType: 'RETAIL',
    currency: 'EGP',
    discountType: 'PERCENT',
    discount: 0,
    items: [{ itemId, quantity: 1, unitPrice: 10, discount: 0 }],
  })
  const invId = d.data?.data?.id
  if (!invId) return fail('B2 PARKED lock', 'no invoice id')
  await req(cashierToken, 'POST', `/sales/${invId}/park`)
  const snap = await req(cashierToken, 'GET', `/sales/${invId}`)
  const updatedAt = snap.data?.data?.updatedAt
  if (!updatedAt) return fail('B2 PARKED lock', 'no updatedAt')
  const ok = await req(cashierToken, 'PATCH', `/sales/${invId}`, {
    paymentType: 'CASH',
    priceType: 'RETAIL',
    currency: 'EGP',
    discountType: 'PERCENT',
    discount: 0,
    items: [{ itemId, quantity: 1, unitPrice: 11, discount: 0 }],
    updatedAt,
  })
  if (ok.status !== 200) return fail('B2 PARKED lock', `first patch ${ok.status} ${JSON.stringify(ok.data)}`)
  await sleep(50)
  const conflict = await req(cashierToken, 'PATCH', `/sales/${invId}`, {
    paymentType: 'CASH',
    priceType: 'RETAIL',
    currency: 'EGP',
    discountType: 'PERCENT',
    discount: 0,
    items: [{ itemId, quantity: 1, unitPrice: 9, discount: 0 }],
    updatedAt,
  })
  if (conflict.status !== 409) fail('B2 PARKED lock', `expected 409 got ${conflict.status}`)
  else pass('B2 optimistic lock 409', '')

  const logs = await req(adminToken, 'GET', '/audit?limit=5')
  if (logs.status !== 200 || !logs.data?.data?.data?.length) fail('B1 audit log', 'empty')
  else pass('B1 audit log readable', `${logs.data.data.total} rows`)
}

async function testPurchaseSupplierRef(adminToken) {
  const sup = await req(adminToken, 'POST', '/suppliers', {
    name: 'مورد batch3',
    phone: '01000000001',
    currency: 'EGP',
  })
  const supplierId = sup.data?.data?.id
  const it = await req(adminToken, 'POST', '/items', {
    name_ar: 'شراء',
    name_en: 'P',
    barcode: `P-${Date.now()}`,
    retailPrice: 20,
    costPrice: 10,
    stockQty: 1,
  })
  const itemId = it.data?.data?.id
  const body = {
    supplierId,
    supplierRef: 'INV-2026-001',
    paymentType: 'CREDIT',
    currency: 'EGP',
    items: [{ itemId, quantity: 1, unitCost: 10, discount: 0 }],
  }
  const a = await req(adminToken, 'POST', '/purchases', body)
  const b = await req(adminToken, 'POST', '/purchases', body)
  if (a.status !== 201 && a.status !== 200) fail('C3 supplier ref', `first ${a.status}`)
  else if (b.status !== 409) fail('C3 supplier ref dup', `second ${b.status}`)
  else pass('C3 supplierRef unique', '409 on duplicate')
}

async function testEtaQueue(adminToken) {
  const prisma = new PrismaClient({ datasources: { db: { url: fileUrl(TEST_DB) } } })
  await prisma.settings.upsert({
    where: { key: 'eta_enabled' },
    create: { key: 'eta_enabled', value: 'true', description: 'test' },
    update: { value: 'true' },
  })
  await prisma.$disconnect()

  const st = await req(adminToken, 'GET', '/eta/status')
  if (!st.data?.data?.enabled) fail('D ETA status', 'not enabled')
  else pass('D ETA module enabled', '')

  const item = await req(adminToken, 'POST', '/items', {
    name_ar: 'eta',
    name_en: 'eta',
    barcode: `ETA-${Date.now()}`,
    retailPrice: 50,
    costPrice: 20,
    stockQty: 3,
  })
  const itemId = item.data?.data?.id
  const d = await req(adminToken, 'POST', '/sales', {
    paymentType: 'CASH',
    priceType: 'RETAIL',
    currency: 'EGP',
    discountType: 'PERCENT',
    discount: 0,
    items: [{ itemId, quantity: 1, unitPrice: 50, discount: 0 }],
  })
  const invId = d.data?.data?.id
  await req(adminToken, 'POST', `/sales/${invId}/confirm`, { payments: [{ method: 'CASH', amount: 50 }] })
  await sleep(2500)
  const proc = await req(adminToken, 'POST', '/eta/process')
  const docs = await req(adminToken, 'GET', '/eta/documents?status=SUBMITTED')
  if (docs.data?.data?.total >= 1) pass('D ETA worker mock submit', `submitted=${docs.data.data.total}`)
  else fail('D ETA worker', JSON.stringify({ proc: proc.data, docs: docs.data }))
}

main().catch((e) => {
  console.error(e)
  stopApi()
  process.exit(1)
})
