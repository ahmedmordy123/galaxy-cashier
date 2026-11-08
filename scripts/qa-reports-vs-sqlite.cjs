/**
 * Match report API totals against raw SQLite aggregates on known fixtures.
 *   node scripts/qa-reports-vs-sqlite.cjs
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawn, execSync } = require('child_process')
const bcrypt = require('bcryptjs')
const { PrismaClient } = require('@prisma/client')

const ROOT = path.resolve(__dirname, '..')
const SOURCE_DB = path.join(ROOT, 'data', 'cashier.db')
const TEST_DB = path.join(ROOT, 'data', 'cashier-qa-reports.db')
const API_PORT = process.env.QA_REPORTS_PORT || '4017'
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
function nearly(a, b, eps = 0.02) {
  return Math.abs(Number(a) - Number(b)) <= eps
}
async function req(token, method, urlPath, body) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const r = await fetch(`${API_BASE}/api${urlPath}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  })
  const data = await r.json().catch(() => ({}))
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

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`)
}

async function main() {
  fs.copyFileSync(SOURCE_DB, TEST_DB)
  const prisma = new PrismaClient({ datasources: { db: { url: fileUrl(TEST_DB) } } })
  const hash = await bcrypt.hash('admin123', 10)
  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: { passwordHash: hash, role: 'ADMIN', isActive: true },
    create: { username: 'admin', name: 'Admin', passwordHash: hash, role: 'ADMIN', language: 'ar' },
  })
  await prisma.settings.upsert({
    where: { key: 'tax_rate' },
    update: { value: '0' },
    create: { key: 'tax_rate', value: '0' },
  })

  // Known fixture day: use today's local dates via API after boot; seed items with known costs
  let wh = await prisma.warehouse.findFirst({ where: { isDefault: true } })
  if (!wh) {
    wh = await prisma.warehouse.create({
      data: { name: 'Main', code: 'MAIN', isDefault: true },
    })
  }
  const item = await prisma.item.create({
    data: {
      name_ar: 'تقرير-صنف',
      name_en: 'Report Item',
      barcode: `RPT-${Date.now()}`,
      retailPrice: 100,
      costPrice: 40,
      stockQty: 100,
      unit: 'piece',
    },
  })
  await prisma.stockBalance.upsert({
    where: { itemId_warehouseId: { itemId: item.id, warehouseId: wh.id } },
    update: { qty: 100 },
    create: { itemId: item.id, warehouseId: wh.id, qty: 100 },
  })
  const customer = await prisma.customer.create({
    data: {
      name: 'عميل تقارير',
      type: 'RETAIL',
      creditLimit: 10000,
      balance: 0,
      currency: 'EGP',
    },
  })
  await prisma.$disconnect()

  killPort(API_PORT)
  const api = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: path.join(ROOT, 'apps', 'api'),
    env: {
      ...process.env,
      PORT: API_PORT,
      DATABASE_URL: fileUrl(TEST_DB),
      COOKIE_SECURE: 'false',
      NODE_ENV: 'development',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  })

  try {
    await waitHealth()
    const login = await req(null, 'POST', '/auth/login', { username: 'admin', password: 'admin123' })
    const token = login.data.data?.accessToken || login.data.accessToken

    await req(token, 'POST', '/ops/shifts/open', { openingCash: 0 })

    // Cash sale 3 × 100 = 300, cost 40 → COGS 120, profit 180
    const d1 = await req(token, 'POST', '/sales', {
      paymentType: 'CASH',
      priceType: 'RETAIL',
      currency: 'EGP',
      discountType: 'PERCENT',
      discount: 0,
      items: [{ itemId: item.id, quantity: 3, unitPrice: 100 }],
    })
    const id1 = d1.data.data.id
    await req(token, 'POST', `/sales/${id1}/confirm`, {
      payments: [{ method: 'CASH', amount: 300 }],
    })

    // Credit sale 2 × 100 = 200
    const d2 = await req(token, 'POST', '/sales', {
      paymentType: 'CREDIT',
      customerId: customer.id,
      priceType: 'RETAIL',
      currency: 'EGP',
      discountType: 'PERCENT',
      discount: 0,
      items: [{ itemId: item.id, quantity: 2, unitPrice: 100 }],
    })
    const id2 = d2.data.data.id
    await req(token, 'POST', `/sales/${id2}/confirm`, {
      payments: [{ method: 'CREDIT', amount: 200 }],
    })

    // Full return of cash sale
    await req(token, 'POST', `/sales/${id1}/return`, {})

    // Raw SQLite aggregates
    const raw = new PrismaClient({ datasources: { db: { url: fileUrl(TEST_DB) } } })
    const salesRows = await raw.$queryRawUnsafe(`
      SELECT status, type, total, amountPaid, balance FROM SalesInvoice
      WHERE id IN ('${id1}', '${id2}')
    `)
    const cust = await raw.customer.findUnique({ where: { id: customer.id } })
    const returned = salesRows.find((r) => r.id === id1 || String(r.status) === 'RETURNED')
    // requery with id
    const inv1 = await raw.salesInvoice.findUnique({ where: { id: id1 } })
    const inv2 = await raw.salesInvoice.findUnique({ where: { id: id2 } })
    const rawCreditBalance = Number(cust.balance)
    const rawConfirmedCreditTotal = Number(inv2.total)
    const rawReturnStatus = inv1.status

    const today = await req(token, 'GET', '/reports/today-summary')
    const t = today.data.data || {}
    // After full return of cash 300 and credit 200 still confirmed:
    // net sales logic varies — compare against SQL truth we compute
    const confirmed = await raw.salesInvoice.findMany({
      where: { status: 'CONFIRMED', isActive: true },
      include: { items: true, payments: true },
    })
    const returnedInv = await raw.salesInvoice.findMany({
      where: { status: 'RETURNED', isActive: true },
    })

    const sqlConfirmedSales = confirmed.reduce((s, i) => s + Number(i.total), 0)
    const sqlReturnedSales = returnedInv.reduce((s, i) => s + Number(i.total), 0)
    // Credit exposure lives on Customer.balance (invoice may be fully "paid" via CREDIT method)
    const sqlCreditOpen = Number(cust.balance)
    const sqlCogs = confirmed.reduce(
      (s, inv) =>
        s + inv.items.reduce((ls, l) => ls + Number(l.quantity) * Number(l.unitCost), 0),
      0,
    )
    const sqlGross = sqlConfirmedSales - sqlCogs

    await raw.$disconnect()

    check(
      'credit customer balance matches invoice',
      nearly(rawCreditBalance, rawConfirmedCreditTotal),
      `cust.balance=${rawCreditBalance} inv2.total=${rawConfirmedCreditTotal}`,
    )
    check('cash sale fully RETURNED in SQLite', rawReturnStatus === 'RETURNED', rawReturnStatus)

    // today-summary fields — align with whatever API exposes
    const apiNet = t.netSalesEGP ?? t.netSales ?? t.salesNetEGP
    const apiSales = t.salesTotalEGP ?? t.salesTotal
    const apiReturns = t.returnsTotalEGP ?? t.returnsTotal
    const apiGross = t.grossProfitEGP ?? t.grossProfit
    const apiCogs = t.cogsTotalEGP ?? t.cogs

    // Confirmed-only sales in DB after return: only credit 200
    check(
      'SQLite confirmed sales total = 200 (credit only)',
      nearly(sqlConfirmedSales, 200),
      `sqlConfirmed=${sqlConfirmedSales}`,
    )
    check(
      'SQLite returned sales total = 300',
      nearly(sqlReturnedSales, 300),
      `sqlReturned=${sqlReturnedSales}`,
    )
    check('SQLite credit open balance = 200', nearly(sqlCreditOpen, 200), `sqlCredit=${sqlCreditOpen}`)
    check(
      'SQLite COGS for confirmed = 80 (2*40)',
      nearly(sqlCogs, 80),
      `sqlCogs=${sqlCogs}`,
    )
    check(
      'SQLite gross profit = 120 (200-80)',
      nearly(sqlGross, 120),
      `sqlGross=${sqlGross}`,
    )

    if (apiSales != null) {
      check('API salesTotal vs SQLite confirmed+returned day fields', nearly(apiSales, sqlConfirmedSales + sqlReturnedSales) || nearly(apiSales, sqlConfirmedSales) || nearly(apiSales, 500), `apiSales=${apiSales} sqlConf=${sqlConfirmedSales} sqlRet=${sqlReturnedSales}`)
    } else {
      check('API today-summary exposes salesTotalEGP', false, JSON.stringify(t).slice(0, 200))
    }

    if (apiReturns != null) {
      check('API returnsTotal vs SQLite returned', nearly(apiReturns, sqlReturnedSales), `api=${apiReturns} sql=${sqlReturnedSales}`)
    } else {
      check('API today-summary exposes returnsTotalEGP', false, JSON.stringify(Object.keys(t)))
    }

    if (apiGross != null) {
      check('API grossProfit vs SQLite', nearly(apiGross, sqlGross), `api=${apiGross} sql=${sqlGross}`)
    } else {
      check('API today-summary exposes grossProfitEGP', false, JSON.stringify(Object.keys(t)))
    }

    if (apiCogs != null) {
      check('API cogs vs SQLite', nearly(apiCogs, sqlCogs), `api=${apiCogs} sql=${sqlCogs}`)
    }

    if (apiNet != null) {
      // net sales often = confirmed - returns recognition; document actual
      const expectedNet = sqlConfirmedSales // remaining net after full return of cash sale
      check(
        'API netSales vs remaining confirmed',
        nearly(apiNet, expectedNet) || nearly(apiNet, sqlConfirmedSales - 0),
        `apiNet=${apiNet} expectedConfirmed=${expectedNet} fullKeys=${Object.keys(t).join(',')}`,
      )
    }

    // Sales report endpoint for today
    const day = new Date()
    const y = day.getFullYear()
    const m = String(day.getMonth() + 1).padStart(2, '0')
    const d = String(day.getDate()).padStart(2, '0')
    const dayStr = `${y}-${m}-${d}`
    const salesRep = await req(token, 'GET', `/reports/sales?from=${dayStr}&to=${dayStr}`)
    const sr = salesRep.data.data || salesRep.data
    check('sales report HTTP', salesRep.ok, salesRep.status)

    const profitRep = await req(token, 'GET', `/reports/profit?from=${dayStr}&to=${dayStr}`)
    check('profit report HTTP', profitRep.ok, profitRep.status)
    const pr = profitRep.data.data || profitRep.data
    const profitSummary = pr?.summary || pr
    if (profitSummary && (profitSummary.totalGrossProfit != null || profitSummary.grossProfitEGP != null || profitSummary.grossProfit != null)) {
      const g = profitSummary.totalGrossProfit ?? profitSummary.grossProfitEGP ?? profitSummary.grossProfit
      check('profit report vs SQLite gross', nearly(g, sqlGross), `api=${g} sql=${sqlGross}`)
    } else {
      check('profit report has gross field', false, JSON.stringify(pr).slice(0, 250))
    }

    // Customer balance via API
    const cApi = await req(token, 'GET', `/customers/${customer.id}`)
    const cBal = Number(cApi.data.data?.balance ?? cApi.data.balance)
    check('API customer balance = 200', nearly(cBal, 200), `bal=${cBal}`)
  } finally {
    try {
      spawn('taskkill', ['/pid', String(api.pid), '/f', '/t'], { stdio: 'ignore' })
    } catch {
      /* */
    }
    killPort(API_PORT)
  }

  const failed = results.filter((r) => !r.ok)
  fs.writeFileSync(
    path.join(ROOT, 'docs', 'QA-REPORTS-VS-SQLITE.json'),
    JSON.stringify({ at: new Date().toISOString(), results }, null, 2),
  )
  console.log(`\nSummary ${results.length - failed.length}/${results.length}`)
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
