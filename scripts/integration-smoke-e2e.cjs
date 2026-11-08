/**
 * End-to-end smoke: one business day (shift → sale → purchase → return → close → report)
 * Uses isolated DB copy + API on port 4014 (or INTEGRATION_API).
 *
 *   node scripts/integration-smoke-e2e.cjs
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawn, execSync } = require('child_process')
const { PrismaClient } = require('@prisma/client')

const ROOT = path.resolve(__dirname, '..')
const SOURCE_DB = path.join(ROOT, 'data', 'cashier.db')
const TEST_DB = path.join(ROOT, 'data', 'cashier-smoke-e2e.db')
const API_PORT = process.env.SMOKE_PORT || '4014'
const API_BASE = process.env.INTEGRATION_API || `http://127.0.0.1:${API_PORT}`

const steps = []

function step(name, expected, actual, ok) {
  steps.push({ name, expected, actual, ok })
  if (!ok) {
    console.error(`\n⛔ Smoke failed: ${name}`)
    console.error(`   expected: ${expected}`)
    console.error(`   actual:   ${actual}`)
  }
  return ok
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
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

function fileUrl(p) {
  return `file:${p.replace(/\\/g, '/')}`
}

async function ensureTestDbSchema(dbPath) {
  const prisma = new PrismaClient({ datasources: { db: { url: fileUrl(dbPath) } } })
  try {
    const addCol = async (table, col, ddl) => {
      const rows = await prisma.$queryRawUnsafe(`PRAGMA table_info("${table}")`)
      if (!rows.some((r) => r.name === col)) await prisma.$executeRawUnsafe(ddl)
    }
    await addCol('SalesInvoice', 'discountType', `ALTER TABLE "SalesInvoice" ADD COLUMN "discountType" TEXT NOT NULL DEFAULT 'PERCENT';`)
    await addCol('PurchaseInvoice', 'paymentType', `ALTER TABLE "PurchaseInvoice" ADD COLUMN "paymentType" TEXT NOT NULL DEFAULT 'CREDIT';`)
  } finally {
    await prisma.$disconnect()
  }
}

async function waitHealth(base) {
  for (let i = 0; i < 200; i++) {
    try {
      const r = await fetch(`${base}/health`)
      if (r.ok) return
    } catch {
      /* */
    }
    await sleep(300)
  }
  throw new Error('API health timeout')
}

let apiProcess = null

function killListenersOnPort(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' })
    const pids = new Set()
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes('LISTENING')) continue
      const parts = line.trim().split(/\s+/)
      const pid = parts[parts.length - 1]
      if (pid && /^\d+$/.test(pid)) pids.add(pid)
    }
    for (const pid of pids) {
      try {
        execSync(`taskkill /pid ${pid} /f /t`, { stdio: 'ignore' })
      } catch {
        /* */
      }
    }
  } catch {
    /* */
  }
}

function stopApi() {
  if (apiProcess && !apiProcess.killed) {
    try {
      spawn('taskkill', ['/pid', String(apiProcess.pid), '/f', '/t'], { stdio: 'ignore' })
    } catch {
      apiProcess.kill()
    }
  }
}

function api(token) {
  return async (method, urlPath, body) => {
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    const r = await fetch(`${API_BASE}/api${urlPath}`, { method, headers, body: body != null ? JSON.stringify(body) : undefined })
    let data = {}
    try {
      data = await r.json()
    } catch {
      data = {}
    }
    return { status: r.status, ok: r.ok, data }
  }
}

async function main() {
  console.log('=== Smoke E2E — يوم عمل كامل ===\n')
  if (!fs.existsSync(SOURCE_DB)) {
    console.error('Missing DB')
    process.exit(1)
  }
  fs.copyFileSync(SOURCE_DB, TEST_DB)
  await ensureTestDbSchema(TEST_DB)
  const env = loadEnvFile()
  env.DATABASE_URL = fileUrl(TEST_DB)
  env.PORT = API_PORT

  if (!process.env.INTEGRATION_API) {
    killListenersOnPort(API_PORT)
    apiProcess = spawn('cmd.exe', ['/c', 'npx tsx src/index.ts'], {
      cwd: path.join(ROOT, 'apps', 'api'),
      env,
      stdio: 'ignore',
    })
    await waitHealth(API_BASE)
  }

  const loginRes = await api(null)('POST', '/auth/login', { username: 'admin', password: 'admin123' })
  const token = loginRes.data?.data?.accessToken
  if (!token) {
    console.error('Login failed')
    process.exit(1)
  }
  const call = api(token)

  // Ensure cashier1 exists for cost-strip checks
  let cashierToken
  {
    const cashierLogin = await api(null)('POST', '/auth/login', { username: 'cashier1', password: 'cashier123' })
    cashierToken = cashierLogin.data?.data?.accessToken
    if (!cashierToken) {
      const bcrypt = require('bcryptjs')
      const prisma = new PrismaClient({ datasources: { db: { url: fileUrl(TEST_DB) } } })
      const hash = await bcrypt.hash('cashier123', 12)
      await prisma.user.upsert({
        where: { username: 'cashier1' },
        update: { passwordHash: hash, role: 'CASHIER', isActive: true },
        create: { username: 'cashier1', name: 'Cashier', passwordHash: hash, role: 'CASHIER', language: 'ar' },
      })
      await prisma.$disconnect()
      const retry = await api(null)('POST', '/auth/login', { username: 'cashier1', password: 'cashier123' })
      cashierToken = retry.data?.data?.accessToken
    }
  }
  if (!cashierToken) {
    console.error('Cashier login failed')
    process.exit(1)
  }
  const cashierCall = api(cashierToken)

  await call('POST', '/ops/shifts/close', { closingCash: 0 }).catch(() => {})
  const open = await call('POST', '/ops/shifts/open', { openingCash: 100 })
  step(
    'فتح وردية',
    'OPEN shift',
    open.data?.data?.status || open.data?.error,
    open.ok && open.data?.data?.status === 'OPEN',
  )
  if (!steps[steps.length - 1].ok) {
    printAndExit()
    return
  }

  const itemBarcode = `SMK-${Date.now()}`
  const itemRes = await call('POST', '/items', {
    name_ar: 'Smoke Item',
    name_en: 'Smoke Item',
    barcode: itemBarcode,
    costPrice: 100,
    retailPrice: 230,
    stockQty: 50,
  })
  const itemId = itemRes.data?.data?.id
  step('إنشاء صنف', 'item id', itemId || 'fail', Boolean(itemId))

  // Slice A — cost strip for CASHIER
  const adminList = await call('GET', '/items?page=1&pageSize=1')
  const adminItem0 = adminList.data?.data?.items?.[0]
  const adminCost = adminItem0?.costPrice
  step(
    'أدمن يرى costPrice في القائمة',
    'number-like',
    String(adminCost),
    adminCost != null && Number.isFinite(Number(adminCost)),
  )

  const cashierList = await cashierCall('GET', '/items?page=1&pageSize=1')
  const cashierItem0 = cashierList.data?.data?.items?.[0]
  step(
    'كاشير: لا costPrice في القائمة',
    'key absent',
    cashierItem0 && Object.prototype.hasOwnProperty.call(cashierItem0, 'costPrice') ? 'present' : 'absent',
    Boolean(cashierItem0) && !Object.prototype.hasOwnProperty.call(cashierItem0, 'costPrice'),
  )

  const cashierById = await cashierCall('GET', `/items/${itemId}`)
  const byId = cashierById.data?.data
  step(
    'كاشير: لا costPrice في getById',
    'key absent',
    byId && Object.prototype.hasOwnProperty.call(byId, 'costPrice') ? 'present' : 'absent',
    Boolean(byId) && !Object.prototype.hasOwnProperty.call(byId, 'costPrice'),
  )

  const cashierByBc = await cashierCall('GET', `/items/barcode/${encodeURIComponent(itemBarcode)}`)
  const byBc = cashierByBc.data?.data
  step(
    'كاشير: لا costPrice في barcode',
    'key absent',
    byBc && Object.prototype.hasOwnProperty.call(byBc, 'costPrice') ? 'present' : 'absent',
    Boolean(byBc) && !Object.prototype.hasOwnProperty.call(byBc, 'costPrice'),
  )

  const cashierSummary = await cashierCall('GET', '/reports/today-summary')
  const cs = cashierSummary.data?.data || {}
  step(
    'كاشير: today-summary بدون أرباح',
    'no cogs/gross/net',
    JSON.stringify({
      cogs: Object.prototype.hasOwnProperty.call(cs, 'cogsTotalEGP'),
      gross: Object.prototype.hasOwnProperty.call(cs, 'grossProfitEGP'),
      net: Object.prototype.hasOwnProperty.call(cs, 'netProfitEGP'),
    }),
    !Object.prototype.hasOwnProperty.call(cs, 'cogsTotalEGP') &&
      !Object.prototype.hasOwnProperty.call(cs, 'grossProfitEGP') &&
      !Object.prototype.hasOwnProperty.call(cs, 'netProfitEGP'),
  )

  const saleCr = await call('POST', '/sales', {
    paymentType: 'CASH',
    priceType: 'RETAIL',
    currency: 'EGP',
    discountType: 'PERCENT',
    discount: 0,
    items: [{ itemId, quantity: 2, unitPrice: 230, discount: 0 }],
  })
  const saleId = saleCr.data?.data?.id
  const saleCf = await call('POST', `/sales/${saleId}/confirm`, {
    payments: [{ method: 'CASH', amount: 460 }],
  })
  step('بيع نقدي', 'CONFIRMED', saleCf.data?.data?.status, saleCf.ok && saleCf.data?.data?.status === 'CONFIRMED')

  const sup = await call('POST', '/suppliers', { name: `Smoke Sup ${Date.now()}`, currency: 'EGP' })
  const supId = sup.data?.data?.id
  const pur = await call('POST', '/purchases', {
    supplierId: supId,
    paymentType: 'CREDIT',
    currency: 'EGP',
    exchangeRate: 1,
    discount: 0,
    items: [{ itemId, quantity: 5, unitCost: 100, discount: 0 }],
  })
  const purCf = await call('POST', `/purchases/${pur.data.data.id}/confirm`, {})
  step('شراء آجل + تأكيد', 'CONFIRMED purchase', purCf.data?.data?.status, purCf.ok)

  const ret = await call('POST', `/sales/${saleId}/return`, {})
  step('إرجاع نقدي', 'RETURNED', ret.data?.data?.status, ret.ok && ret.data?.data?.status === 'RETURNED')

  const summary = await call('GET', '/ops/shifts/current/summary')
  const expectedCash = Number(summary.data?.data?.expectedCash ?? NaN)
  const close = await call('POST', '/ops/shifts/close', { closingCash: expectedCash })
  const diff = Number(close.data?.data?.cashDifference ?? NaN)
  step('إقفال وردية', 'cashDifference≈0', String(diff), Number.isFinite(diff) && Math.abs(diff) < 0.05)

  const report = await call('GET', '/reports/today-summary')
  const net = Number(report.data?.data?.netSalesEGP ?? -1)
  step('تقرير اليوم', 'netSalesEGP≈0 after full return', String(net), Number.isFinite(net) && Math.abs(net) < 0.05)

  stopApi()
  printAndExit()
}

function printAndExit() {
  console.log('\n| # | الخطوة | المتوقع | الفعلي | ✅/❌ |')
  console.log('|---|--------|---------|--------|------|')
  steps.forEach((s, i) => {
    console.log(`| ${i + 1} | ${s.name} | ${s.expected} | ${s.actual} | ${s.ok ? '✅' : '❌'} |`)
  })
  const ok = steps.every((s) => s.ok)
  console.log(ok ? '\n✅ Smoke E2E passed' : '\n❌ Smoke E2E failed')
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  stopApi()
  process.exit(1)
})
