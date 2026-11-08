/**
 * Galaxy Cashier — Integration tests for batch 1 (Phases A/B/C/D/G)
 *
 * Uses an isolated copy of cashier.db and a dedicated API instance (port 4012).
 *
 * Run from repo root:
 *   node scripts/integration-batch1.mjs
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawn, execSync } = require('child_process')
const { PrismaClient } = require('@prisma/client')

const ROOT = path.resolve(__dirname, '..')
const SOURCE_DB = path.join(ROOT, 'data', 'cashier.db')
const TEST_DB = path.join(ROOT, 'data', 'cashier-integration-test.db')
const MIGRATION_DB = path.join(ROOT, 'data', 'cashier-integration-migration-test.db')
const API_PORT = process.env.INTEGRATION_PORT || '4012'
const API_BASE = process.env.INTEGRATION_API || `http://127.0.0.1:${API_PORT}`

const results = []
let stopRequested = false

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function loadEnvFile() {
  const envPath = path.join(ROOT, 'apps', 'api', '.env')
  const env = { ...process.env }
  if (!fs.existsSync(envPath)) return env
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    env[key] = val
  }
  return env
}

function fileUrlForSqlite(absPath) {
  return `file:${absPath.replace(/\\/g, '/')}`
}

function computeInclusiveTotals(subtotal, discountType, discountValue, taxPct) {
  let afterDiscount = subtotal
  if (discountType === 'FIXED') {
    afterDiscount = Math.max(0, subtotal - discountValue)
  } else {
    afterDiscount = subtotal * (1 - discountValue / 100)
  }
  const tax = taxPct <= 0 ? 0 : afterDiscount * (taxPct / (100 + taxPct))
  const total = afterDiscount
  return { subtotal, afterDiscount, tax, total, discountAmount: subtotal - afterDiscount }
}

function creditUiFlag(balance, creditLimit, invoiceTotal) {
  const limit = Number(creditLimit)
  if (limit <= 0) return 'CREDIT_BLOCKED'
  const projected = Number(balance) + Number(invoiceTotal)
  if (projected > limit + 1e-6) return 'CREDIT_LIMIT_EXCEEDED'
  if (projected > limit * 0.85) return 'WARN_85_PERCENT'
  return 'OK'
}

function record(num, name, expected, actual, ok) {
  results.push({ num, name, expected, actual, ok })
  if (!ok && !stopRequested) {
    stopRequested = true
    console.error(`\n⛔ توقف عند الاختبار #${num}: ${name}`)
    console.error(`   متوقع: ${expected}`)
    console.error(`   فعلي:  ${actual}`)
  }
  return ok
}

function printReport(allPassed) {
  console.log('\n| # | الاختبار | النتيجة المتوقعة | النتيجة الفعلية | ✅/❌ |')
  console.log('|---|----------|-------------------|-------------------|------|')
  for (const r of results) {
    const mark = r.ok ? '✅' : '❌'
    const exp = String(r.expected).replace(/\|/g, '\\|').slice(0, 80)
    const act = String(r.actual).replace(/\|/g, '\\|').slice(0, 80)
    console.log(`| ${r.num} | ${r.name} | ${exp} | ${act} | ${mark} |`)
  }
  console.log('')
  if (allPassed) {
    console.log('✅ **كل الـ 12 اختبار نجحت** — جاهز للجولة الثانية (ما عدا معاينة الطباعة الحرارية يدويًا).')
  }
}

async function waitForHealth(base, timeoutMs = 90000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${base}/health`)
      if (r.ok) return
    } catch {
      /* retry */
    }
    await sleep(400)
  }
  throw new Error(`API لم يستجب على ${base}/health خلال ${timeoutMs}ms`)
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
        /* already gone */
      }
    }
  } catch {
    /* nothing listening */
  }
}

function startApi(env) {
  return new Promise((resolve, reject) => {
    apiProcess = spawn('cmd.exe', ['/c', 'npx tsx src/index.ts'], {
      cwd: path.join(ROOT, 'apps', 'api'),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let errBuf = ''
    apiProcess.stderr.on('data', (d) => {
      errBuf += d.toString()
    })
    apiProcess.on('error', reject)
    waitForHealth(API_BASE)
      .then(resolve)
      .catch((e) => reject(new Error(`${e.message}\n${errBuf.slice(-500)}`)))
  })
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

function makeClient(token) {
  return async function api(method, urlPath, body) {
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
      data = {}
    }
    return { status: r.status, ok: r.ok, data }
  }
}

async function login(api) {
  const r = await api('POST', '/auth/login', { username: 'admin', password: 'admin123' })
  if (!r.ok || !r.data?.data?.accessToken) {
    throw new Error(`Login failed: ${JSON.stringify(r.data)}`)
  }
  return r.data.data.accessToken
}

async function assertStockAligned(prisma, itemId) {
  const item = await prisma.item.findUnique({ where: { id: itemId } })
  const balances = await prisma.stockBalance.findMany({ where: { itemId } })
  const sumBal = balances.reduce((s, b) => s + Number(b.qty), 0)
  const itemQty = Number(item?.stockQty ?? -1)
  return Math.abs(itemQty - sumBal) < 1e-6 ? { ok: true, itemQty, sumBal } : { ok: false, itemQty, sumBal }
}

async function getTaxRate(api) {
  const r = await api('GET', '/settings')
  const v = Number(r.data?.data?.tax_rate ?? 14)
  return Number.isFinite(v) ? v : 14
}

async function createTestItem(api, tag, opts = {}) {
  const barcode = `TST-${tag}-${Date.now()}`
  const r = await api('POST', '/items', {
    name_ar: `صنف ${tag}`,
    name_en: `Item ${tag}`,
    barcode,
    retailPrice: opts.retailPrice ?? 115,
    costPrice: opts.costPrice ?? 50,
    stockQty: opts.stockQty ?? 100,
    trackSerial: opts.trackSerial ?? false,
  })
  if (!r.ok) throw new Error(`createItem ${tag}: ${JSON.stringify(r.data)}`)
  return r.data.data
}

async function createCustomer(api, tag, creditLimit) {
  const r = await api('POST', '/customers', {
    name: `عميل ${tag}`,
    phone: `0100${String(Date.now()).slice(-7)}`,
    type: 'RETAIL',
    creditLimit,
    currency: 'EGP',
  })
  if (!r.ok) throw new Error(`createCustomer: ${JSON.stringify(r.data)}`)
  return r.data.data
}

async function createSupplier(api, tag) {
  const r = await api('POST', '/suppliers', {
    name: `مورد ${tag}`,
    phone: '01000000001',
    currency: 'EGP',
  })
  if (!r.ok) throw new Error(`createSupplier: ${JSON.stringify(r.data)}`)
  return r.data.data
}

async function saleDraftAndConfirm(api, payload, confirmBody) {
  const cr = await api('POST', '/sales', payload)
  if (!cr.ok) throw new Error(`create sale: ${JSON.stringify(cr.data)}`)
  const id = cr.data.data.id
  const cf = await api('POST', `/sales/${id}/confirm`, confirmBody ?? {})
  if (!cf.ok) throw new Error(`confirm sale: ${JSON.stringify(cf.data)}`)
  return cf.data.data
}

async function runTest1(api) {
  const name = 'بيع 3 أصناف نقدي (كاش + بطاقة) → كشف CASH فقط'
  const cashPart = 150
  const cardPart = 250
  const price = 115
  const items = []
  for (let i = 0; i < 3; i++) {
    items.push(await createTestItem(api, `T1-${i}`, { retailPrice: price, stockQty: 50 }))
  }
  const subtotal = price * 3
  const taxPct = await getTaxRate(api)
  const { total } = computeInclusiveTotals(subtotal, 'PERCENT', 0, taxPct)
  const stmtBefore = await api('GET', '/cash-statement/today')
  const cashBefore = Number(stmtBefore.data?.data?.cashSalesEGP ?? 0)
  await saleDraftAndConfirm(
    api,
    {
      paymentType: 'CASH',
      priceType: 'RETAIL',
      currency: 'EGP',
      discountType: 'PERCENT',
      discount: 0,
      items: items.map((it) => ({
        itemId: it.id,
        quantity: 1,
        unitPrice: price,
        discount: 0,
      })),
    },
    {
      amountPaid: total,
      payments: [
        { method: 'CASH', amount: cashPart },
        { method: 'CARD', amount: cardPart },
      ],
    },
  )
  const stmt = await api('GET', '/cash-statement/today')
  const delta = Number(stmt.data?.data?.cashSalesEGP ?? 0) - cashBefore
  const expected = `Δ cashSalesEGP = ${cashPart}`
  const actual = `Δ = ${delta.toFixed(2)}, invoiceTotal ≈ ${total.toFixed(2)}`
  return record(1, name, expected, actual, Math.abs(delta - cashPart) < 0.02)
}

async function runTest2(api, prisma) {
  const name = 'إرجاع جزئي + StockBalance + REFUND'
  const price = 200
  const item = await createTestItem(api, 'T2', { retailPrice: price, stockQty: 0 })
  const wh = await prisma.warehouse.findFirst({ where: { isActive: true } })
  if (wh) {
    await prisma.stockBalance.deleteMany({ where: { itemId: item.id } })
    await prisma.stockBalance.create({
      data: { itemId: item.id, warehouseId: wh.id, qty: 10 },
    })
    await prisma.item.update({ where: { id: item.id }, data: { stockQty: 10 } })
  }
  const inv = await saleDraftAndConfirm(
    api,
    {
      paymentType: 'CASH',
      priceType: 'RETAIL',
      currency: 'EGP',
      discountType: 'PERCENT',
      discount: 0,
      items: [{ itemId: item.id, quantity: 5, unitPrice: price, discount: 0 }],
    },
    { amountPaid: 1000, payments: [{ method: 'CASH', amount: 1000 }] },
  )
  const pr = await api('POST', `/sales/${inv.id}/partial-return`, {
    items: [{ itemId: item.id, quantity: 2 }],
  })
  if (!pr.ok) {
    return record(2, name, 'partial-return 200', JSON.stringify(pr.data), false)
  }
  const after = await assertStockAligned(prisma, item.id)
  const payments = await prisma.salesPayment.findMany({ where: { invoiceId: inv.id } })
  const hasRefund = payments.some((p) => p.method === 'REFUND' && Number(p.amount) > 0)
  const expected = 'stockQty=7, balances sum=7, REFUND exists'
  const actual = `stockQty=${after.itemQty}, sumBal=${after.sumBal}, refund=${hasRefund}`
  return record(2, name, expected, actual, after.ok && after.itemQty === 7 && hasRefund)
}

async function runTest3(api, prisma) {
  const name = 'creditLimit: NOT_ALLOWED vs EXCEEDED'
  const blockedCustomer = await createCustomer(api, 'T3-block', 0)
  const lineItem0 = await createTestItem(api, 'T3a', { retailPrice: 100 })
  const cr0 = await api('POST', '/sales', {
    customerId: blockedCustomer.id,
    paymentType: 'CREDIT',
    priceType: 'RETAIL',
    currency: 'EGP',
    discountType: 'PERCENT',
    discount: 0,
    items: [{ itemId: lineItem0.id, quantity: 1, unitPrice: 100, discount: 0 }],
  })
  let cf0 = cr0
  if (cr0.ok) {
    cf0 = await api('POST', `/sales/${cr0.data.data.id}/confirm`, {})
  }
  const notAllowedOk =
    cf0.status === 400 && cf0.data?.code === 'CREDIT_NOT_ALLOWED'

  const limitedCustomer = await createCustomer(api, 'T3-limit', 1000)
  await prisma.customer.update({
    where: { id: limitedCustomer.id },
    data: { balance: 700 },
  })
  const lineItem1 = await createTestItem(api, 'T3b', { retailPrice: 400 })
  const cr1 = await api('POST', '/sales', {
    customerId: limitedCustomer.id,
    paymentType: 'CREDIT',
    priceType: 'RETAIL',
    currency: 'EGP',
    discountType: 'PERCENT',
    discount: 0,
    items: [{ itemId: lineItem1.id, quantity: 1, unitPrice: 400, discount: 0 }],
  })
  let cf1 = cr1
  if (cr1.ok) {
    cf1 = await api('POST', `/sales/${cr1.data.data.id}/confirm`, {})
  }
  const errText = String(cf1.data?.error || '')
  const exceededOk =
    cf1.status === 400 &&
    cf1.data?.code === 'CREDIT_LIMIT_EXCEEDED' &&
    errText.includes('300') &&
    errText.includes('400')

  const flag = creditUiFlag(0, 1000, 900)
  const expected =
    'code=CREDIT_NOT_ALLOWED @0; code=CREDIT_LIMIT_EXCEEDED + المتاح 300 @700+400; WARN_85 UI'
  const actual = `notAllowed=${cf0.data?.code}; exceeded=${cf1.data?.code} msg=${errText.slice(0, 60)}; ui=${flag}`
  return record(3, name, expected, actual, notAllowedOk && exceededOk && flag === 'WARN_85_PERCENT')
}

async function runTest4(api, prisma) {
  const name = 'شراء نقدي → رصيد المورد ثابت'
  const supplier = await createSupplier(api, 'T4')
  const before = Number(
    (await prisma.supplier.findUnique({ where: { id: supplier.id } }))?.balance ?? 0,
  )
  const item = await createTestItem(api, 'T4-item', { costPrice: 30, retailPrice: 50 })
  const pr = await api('POST', '/purchases', {
    supplierId: supplier.id,
    paymentType: 'CASH',
    currency: 'EGP',
    exchangeRate: 1,
    discount: 0,
    items: [{ itemId: item.id, quantity: 2, unitCost: 30, discount: 0 }],
  })
  if (!pr.ok) return record(4, name, 'create purchase', JSON.stringify(pr.data), false)
  const cf = await api('POST', `/purchases/${pr.data.data.id}/confirm`, {})
  if (!cf.ok) return record(4, name, 'confirm purchase', JSON.stringify(cf.data), false)
  const after = Number(
    (await prisma.supplier.findUnique({ where: { id: supplier.id } }))?.balance ?? -1,
  )
  return record(
    4,
    name,
    `balance=${before}`,
    `before=${before}, after=${after}`,
    Math.abs(after - before) < 1e-6,
  )
}

async function runTest5(api) {
  const name = 'تأكيد payload الدفع (F2/API)'
  const price = 115
  const item = await createTestItem(api, 'T5', { retailPrice: price })
  const taxPct = await getTaxRate(api)
  const { total } = computeInclusiveTotals(price, 'PERCENT', 0, taxPct)
  const cr = await api('POST', '/sales', {
    paymentType: 'CASH',
    priceType: 'RETAIL',
    currency: 'EGP',
    discountType: 'PERCENT',
    discount: 0,
    items: [{ itemId: item.id, quantity: 1, unitPrice: price, discount: 0 }],
  })
  const id = cr.data?.data?.id
  const payload = {
    amountPaid: total,
    payments: [
      { method: 'CASH', amount: 60 },
      { method: 'CARD', amount: Math.max(0, total - 60) },
    ],
  }
  const cf = await api('POST', `/sales/${id}/confirm`, payload)
  const paid = Number(cf.data?.data?.amountPaid ?? -1)
  return record(
    5,
    name,
    'CONFIRMED + amountPaid=total',
    `status=${cf.status}, paid=${paid}, total=${total.toFixed(2)}`,
    cf.ok && cf.data?.data?.status === 'CONFIRMED' && Math.abs(paid - total) < 0.05,
  )
}

async function runTest6(api) {
  const name = 'خصم ثابت + Inclusive'
  const price = 115
  const fixedDiscount = 10
  const item = await createTestItem(api, 'T6', { retailPrice: price })
  const taxPct = await getTaxRate(api)
  const expectedTotals = computeInclusiveTotals(price, 'FIXED', fixedDiscount, taxPct)
  const cr = await api('POST', '/sales', {
    paymentType: 'CASH',
    priceType: 'RETAIL',
    currency: 'EGP',
    discountType: 'FIXED',
    discount: fixedDiscount,
    items: [{ itemId: item.id, quantity: 1, unitPrice: price, discount: 0 }],
  })
  const inv = cr.data?.data
  return record(
    6,
    name,
    `total=${expectedTotals.total.toFixed(2)}, tax=${expectedTotals.tax.toFixed(2)}`,
    `total=${Number(inv.total).toFixed(2)}, tax=${Number(inv.tax).toFixed(2)}`,
    Math.abs(Number(inv.total) - expectedTotals.total) < 0.02 &&
      Math.abs(Number(inv.tax) - expectedTotals.tax) < 0.02,
  )
}

async function runTest7(api) {
  const name = 'CASH/CARD → Δ cashStatement = CASH'
  const cashPart = 80
  const cardPart = 120
  const price = 200
  const item = await createTestItem(api, 'T7', { retailPrice: price })
  const stmtBefore = await api('GET', '/cash-statement/today')
  const cashBefore = Number(stmtBefore.data?.data?.cashSalesEGP ?? 0)
  await saleDraftAndConfirm(
    api,
    {
      paymentType: 'CASH',
      priceType: 'RETAIL',
      currency: 'EGP',
      discountType: 'PERCENT',
      discount: 0,
      items: [{ itemId: item.id, quantity: 1, unitPrice: price, discount: 0 }],
    },
    {
      payments: [
        { method: 'CASH', amount: cashPart },
        { method: 'CARD', amount: cardPart },
      ],
    },
  )
  const stmtAfter = await api('GET', '/cash-statement/today')
  const delta = Number(stmtAfter.data?.data?.cashSalesEGP ?? 0) - cashBefore
  return record(
    7,
    name,
    `Δ cashSales = ${cashPart}`,
    `Δ = ${delta.toFixed(2)}`,
    Math.abs(delta - cashPart) < 0.05,
  )
}

async function runTest8(api, prisma) {
  const name = 'سيريال: بيع → إرجاع → بيع'
  const serial = `SN-T8-${Date.now()}`
  const item = await createTestItem(api, 'T8', { retailPrice: 500, stockQty: 1, trackSerial: true })
  const sr = await api('POST', '/ops/serials', { itemId: item.id, serial, warrantyMonths: 12 })
  if (!sr.ok) return record(8, name, 'add serial', JSON.stringify(sr.data), false)
  const inv1 = await saleDraftAndConfirm(
    api,
    {
      paymentType: 'CASH',
      priceType: 'RETAIL',
      currency: 'EGP',
      discountType: 'PERCENT',
      discount: 0,
      items: [{ itemId: item.id, quantity: 1, unitPrice: 500, discount: 0, serialNumber: serial }],
    },
    { payments: [{ method: 'CASH', amount: 500 }] },
  )
  const ret = await api('POST', `/sales/${inv1.id}/return`, {})
  if (!ret.ok) return record(8, name, 'return', JSON.stringify(ret.data), false)
  const row = await prisma.itemSerial.findFirst({ where: { itemId: item.id, serial } })
  const inv2cr = await api('POST', '/sales', {
    paymentType: 'CASH',
    priceType: 'RETAIL',
    currency: 'EGP',
    discountType: 'PERCENT',
    discount: 0,
    items: [{ itemId: item.id, quantity: 1, unitPrice: 500, discount: 0, serialNumber: serial }],
  })
  const inv2cf = await api('POST', `/sales/${inv2cr.data.data.id}/confirm`, {
    payments: [{ method: 'CASH', amount: 500 }],
  })
  return record(
    8,
    name,
    'IN_STOCK + second CONFIRMED',
    `serial=${row?.status}, confirm2=${inv2cf.ok}`,
    row?.status === 'IN_STOCK' && inv2cf.ok,
  )
}

async function runTest9(api) {
  const name = 'Quote → فاتورة (سعر العرض)'
  const quotePrice = 100
  const item = await createTestItem(api, 'T9', { retailPrice: quotePrice })
  const qr = await api('POST', '/quotes', {
    paymentType: 'CASH',
    priceType: 'RETAIL',
    currency: 'EGP',
    discountType: 'PERCENT',
    discount: 0,
    items: [{ itemId: item.id, quantity: 1, unitPrice: quotePrice, discount: 0 }],
  })
  if (!qr.ok) return record(9, name, 'create quote', JSON.stringify(qr.data), false)
  await api('PATCH', `/items/${item.id}`, { retailPrice: 250 })
  const cv = await api('POST', `/quotes/${qr.data.data.id}/convert`, {})
  const linePrice = Number(cv.data?.data?.items?.[0]?.unitPrice ?? -1)
  return record(
    9,
    name,
    'unitPrice=100 after convert',
    `unitPrice=${linePrice}`,
    Math.abs(linePrice - quotePrice) < 0.01,
  )
}

async function runTest10(api) {
  const name = 'وردية + مرتجع نقدي → cashDifference=0'
  await api('POST', '/ops/shifts/close', { closingCash: 0 }).catch(() => {})
  await api('POST', '/ops/shifts/open', { openingCash: 0 })
  const price = 300
  const item = await createTestItem(api, 'T10', { retailPrice: price, stockQty: 20 })
  const inv = await saleDraftAndConfirm(
    api,
    {
      paymentType: 'CASH',
      priceType: 'RETAIL',
      currency: 'EGP',
      discountType: 'PERCENT',
      discount: 0,
      items: [{ itemId: item.id, quantity: 1, unitPrice: price, discount: 0 }],
    },
    { payments: [{ method: 'CASH', amount: price }] },
  )
  await api('POST', `/sales/${inv.id}/return`, {})
  const summary = await api('GET', '/ops/shifts/current/summary')
  const expectedCash = Number(summary.data?.data?.expectedCash ?? -1)
  const close = await api('POST', '/ops/shifts/close', { closingCash: expectedCash })
  const diff = Number(close.data?.data?.cashDifference ?? NaN)
  return record(
    10,
    name,
    'cashDifference=0 when closing=expected',
    `expected=${expectedCash}, diff=${diff}`,
    Number.isFinite(diff) && Math.abs(diff) < 0.05,
  )
}

async function ensureTestDbSchema(dbPath) {
  const prisma = await prismaForDb(dbPath)
  try {
    const addCol = async (table, col, ddl) => {
      const rows = await prisma.$queryRawUnsafe(`PRAGMA table_info("${table}")`)
      if (!rows.some((r) => r.name === col)) {
        await prisma.$executeRawUnsafe(ddl)
      }
    }
    await addCol(
      'SalesInvoice',
      'discountType',
      `ALTER TABLE "SalesInvoice" ADD COLUMN "discountType" TEXT NOT NULL DEFAULT 'PERCENT';`,
    )
    await addCol(
      'PurchaseInvoice',
      'paymentType',
      `ALTER TABLE "PurchaseInvoice" ADD COLUMN "paymentType" TEXT NOT NULL DEFAULT 'CREDIT';`,
    )
  } finally {
    await prisma.$disconnect()
  }
}

async function prismaForDb(dbPath) {
  return new PrismaClient({ datasources: { db: { url: fileUrlForSqlite(dbPath) } } })
}

async function columnExists(dbPath, table, column) {
  const prisma = await prismaForDb(dbPath)
  try {
    const rows = await prisma.$queryRawUnsafe(`PRAGMA table_info("${table}")`)
    return rows.some((r) => r.name === column)
  } finally {
    await prisma.$disconnect()
  }
}

async function runTest12(api) {
  const name = 'تقرير اليوم: إرجاع جزئي (CONFIRMED)'
  const beforeReport = await api('GET', '/reports/today-summary')
  const netBefore = Number(beforeReport.data?.data?.netSalesEGP ?? 0)
  const returnsBefore = Number(beforeReport.data?.data?.returnsTotalEGP ?? 0)

  const price = 100
  const item = await createTestItem(api, 'T12', { retailPrice: price, stockQty: 30 })
  const inv = await saleDraftAndConfirm(
    api,
    {
      paymentType: 'CASH',
      priceType: 'RETAIL',
      currency: 'EGP',
      discountType: 'PERCENT',
      discount: 0,
      items: [{ itemId: item.id, quantity: 3, unitPrice: price, discount: 0 }],
    },
    {
      amountPaid: 300,
      payments: [{ method: 'CASH', amount: 300 }],
    },
  )
  const grossTotal = Number(inv.total)
  const midReport = await api('GET', '/reports/today-summary')
  const netMid = Number(midReport.data?.data?.netSalesEGP ?? 0)
  const pr = await api('POST', `/sales/${inv.id}/partial-return`, {
    items: [{ itemId: item.id, quantity: 1 }],
  })
  if (!pr.ok) {
    return record(12, name, 'partial-return 200', JSON.stringify(pr.data), false)
  }
  const status = pr.data?.data?.status
  const remainingTotal = Number(pr.data?.data?.total)
  const afterReport = await api('GET', '/reports/today-summary')
  const netAfter = Number(afterReport.data?.data?.netSalesEGP)
  const returnsAfter = Number(afterReport.data?.data?.returnsTotalEGP ?? 0)
  const deltaNet = netAfter - netMid
  const expectedDelta = remainingTotal - grossTotal
  const ok =
    status === 'CONFIRMED' &&
    Math.abs(netMid - netBefore - grossTotal) < 0.05 &&
    Math.abs(deltaNet - expectedDelta) < 0.03 &&
    returnsAfter === returnsBefore &&
    remainingTotal < grossTotal - 0.05
  const expected = 'CONFIRMED; netMid−netBefore≈gross; after partial Δnet=remaining−gross'
  const actual = `status=${status}; mid−before=${(netMid - netBefore).toFixed(2)}; Δpartial=${deltaNet.toFixed(2)}; exp=${expectedDelta.toFixed(2)}`
  return record(12, name, expected, actual, ok)
}

async function runTest11() {
  const name = 'Migration discountType / paymentType'
  fs.copyFileSync(SOURCE_DB, MIGRATION_DB)
  const prisma = await prismaForDb(MIGRATION_DB)
  let countBefore = 0
  try {
    const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as c FROM "SalesInvoice"`)
    countBefore = Number(rows[0]?.c ?? 0)
  } finally {
    await prisma.$disconnect()
  }

  const env = loadEnvFile()
  env.DATABASE_URL = fileUrlForSqlite(MIGRATION_DB)
  env.PORT = '4013'
  killListenersOnPort('4013')
  await new Promise((resolve, reject) => {
    const p = spawn('cmd.exe', ['/c', 'npx tsx src/index.ts'], {
      cwd: path.join(ROOT, 'apps', 'api'),
      env,
      stdio: 'ignore',
    })
    waitForHealth('http://127.0.0.1:4013', 60000)
      .then(() => {
        spawn('taskkill', ['/pid', String(p.pid), '/f', '/t'], { stdio: 'ignore' })
        resolve()
      })
      .catch(reject)
  })

  const hasDisc = await columnExists(MIGRATION_DB, 'SalesInvoice', 'discountType')
  const hasPay = await columnExists(MIGRATION_DB, 'PurchaseInvoice', 'paymentType')
  const prisma2 = await prismaForDb(MIGRATION_DB)
  let countAfter = 0
  let sample = []
  try {
    const rows = await prisma2.$queryRawUnsafe(`SELECT COUNT(*) as c FROM "SalesInvoice"`)
    countAfter = Number(rows[0]?.c ?? 0)
    sample = await prisma2.$queryRawUnsafe(`SELECT "discountType" FROM "SalesInvoice" LIMIT 5`)
  } finally {
    await prisma2.$disconnect()
  }
  const defaultsOk =
    sample.length === 0 || sample.every((r) => r.discountType === 'PERCENT' || r.discountType == null)
  return record(
    11,
    name,
    'columns + preserved rows + PERCENT default',
    `disc=${hasDisc}, pay=${hasPay}, count=${countBefore}→${countAfter}`,
    hasDisc && hasPay && countBefore === countAfter && defaultsOk,
  )
}

async function resetTodayCashStatement(dbPath) {
  const prisma = await prismaForDb(dbPath)
  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000)
    await prisma.cashStatement.deleteMany({
      where: { date: { gte: today, lt: tomorrow } },
    })
  } finally {
    await prisma.$disconnect()
  }
}

async function main() {
  console.log('=== Galaxy Cashier — integration batch 1 ===\n')
  if (!fs.existsSync(SOURCE_DB)) {
    console.error(`Missing source DB: ${SOURCE_DB}`)
    process.exit(1)
  }
  fs.copyFileSync(SOURCE_DB, TEST_DB)
  await ensureTestDbSchema(TEST_DB)
  await resetTodayCashStatement(TEST_DB)
  console.log(`Test DB: ${TEST_DB}`)

  const env = loadEnvFile()
  env.DATABASE_URL = fileUrlForSqlite(TEST_DB)
  env.PORT = API_PORT

  if (!process.env.INTEGRATION_API) {
    killListenersOnPort(API_PORT)
    console.log(`Starting API on ${API_BASE} ...`)
    await startApi(env)
    console.log('API ready.\n')
  } else {
    await waitForHealth(API_BASE)
  }

  const prisma = await prismaForDb(TEST_DB)
  const api = makeClient(await login(makeClient(null)))

  const tests = [
    () => runTest1(api),
    () => runTest2(api, prisma),
    () => runTest3(api, prisma),
    () => runTest4(api, prisma),
    () => runTest5(api),
    () => runTest6(api),
    () => runTest7(api),
    () => runTest8(api, prisma),
    () => runTest9(api),
    () => runTest10(api),
    () => runTest11(),
    () => runTest12(api),
  ]

  for (let i = 0; i < tests.length; i++) {
    if (stopRequested) break
    console.log(`Running test ${i + 1}/${tests.length} ...`)
    try {
      await tests[i]()
    } catch (e) {
      record(i + 1, `Test ${i + 1}`, 'no throw', e.message, false)
      stopRequested = true
    }
    if (stopRequested) break
  }

  await prisma.$disconnect()
  stopApi()

  const allPassed = results.length === 12 && results.every((r) => r.ok)
  printReport(allPassed)
  process.exit(allPassed ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  stopApi()
  process.exit(1)
})
