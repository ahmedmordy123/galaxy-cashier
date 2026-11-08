/**
 * Golden accounting scenarios — hand-calculated expectations in docs/GOLDEN-SCENARIOS.md
 *   node scripts/qa-golden-accounting.cjs
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawn, execSync } = require('child_process')
const bcrypt = require('bcryptjs')
const { PrismaClient } = require('@prisma/client')

const ROOT = path.resolve(__dirname, '..')
const SOURCE_DB = path.join(ROOT, 'data', 'cashier.db')
const SEED = 'C:\\Program Files\\Galaxy Cashier\\resources\\seed.db'
const TEST_DB = path.join(ROOT, 'data', 'cashier-qa-golden.db')
const API_PORT = process.env.QA_GOLDEN_PORT || '4020'
const API_BASE = `http://127.0.0.1:${API_PORT}`

function fileUrl(p) {
  return `file:${p.replace(/\\/g, '/')}`
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}
function nearly(a, b, eps = 0.02) {
  return Math.abs(Number(a) - Number(b)) <= eps
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
  results.push({ name, ok, detail: String(detail) })
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`)
}

async function main() {
  const src = fs.existsSync(SOURCE_DB) ? SOURCE_DB : SEED
  fs.copyFileSync(src, TEST_DB)

  const prisma = new PrismaClient({ datasources: { db: { url: fileUrl(TEST_DB) } } })
  const hash = await bcrypt.hash('admin123', 10)
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: { passwordHash: hash, role: 'ADMIN', isActive: true },
    create: { username: 'admin', name: 'Admin', passwordHash: hash, role: 'ADMIN', language: 'ar' },
  })
  let wh = await prisma.warehouse.findFirst({ where: { isDefault: true } })
  if (!wh) wh = await prisma.warehouse.create({ data: { name: 'Main', code: 'MAIN', isDefault: true } })

  async function mkItem(name, price, cost, stock = 100) {
    const item = await prisma.item.create({
      data: {
        name_ar: name,
        name_en: name,
        barcode: `G-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        retailPrice: price,
        costPrice: cost,
        stockQty: stock,
        unit: 'piece',
      },
    })
    await prisma.stockBalance.upsert({
      where: { itemId_warehouseId: { itemId: item.id, warehouseId: wh.id } },
      update: { qty: stock },
      create: { itemId: item.id, warehouseId: wh.id, qty: stock },
    })
    return item
  }

  const g1a = await mkItem('G1-Item', 100, 40, 50)
  const g2a = await mkItem('G2-A', 100, 30, 50)
  const g2b = await mkItem('G2-B', 100, 30, 50)
  const g3 = await mkItem('G3-Item', 200, 90, 50)
  const g4 = await mkItem('G4-Item', 100, 40, 50)
  const cust = await prisma.customer.create({
    data: {
      name: 'Golden Credit Cust',
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

    // ── G1 ──
    await req(token, 'PUT', '/settings', { tax_rate: '14' })
    await req(token, 'POST', '/ops/shifts/open', { openingCash: 0 })
    const d1 = await req(token, 'POST', '/sales', {
      paymentType: 'CASH',
      priceType: 'RETAIL',
      currency: 'EGP',
      discountType: 'FIXED',
      discount: 20,
      items: [{ itemId: g1a.id, quantity: 2, unitPrice: 100 }],
    })
    const inv1 = d1.data.data
    check('G1 total==180', nearly(inv1.total, 180), `total=${inv1.total}`)
    check('G1 tax≈22.11', nearly(inv1.tax, 180 * 14 / 114), `tax=${inv1.tax}`)
    await req(token, 'POST', `/sales/${inv1.id}/confirm`, {
      payments: [{ method: 'CASH', amount: Number(inv1.total) }],
    })
    const today = new Date().toISOString().slice(0, 10)
    const profit1 = await req(token, 'GET', `/reports/profit?from=${today}&to=${today}`)
    // May include other goldens later — isolate via invoice fields first
    check('G1 invoice total locked', nearly(Number(inv1.total), 180), '180')

    const stock1 = await req(token, 'GET', `/items/${g1a.id}`)
    check('G1 stock 50→48', nearly(stock1.data.data.stockQty, 48), `qty=${stock1.data.data.stockQty}`)

    const invR = await req(token, 'GET', '/reports/inventory')
    const row1 = (invR.data.data?.items || invR.data.data || []).find((x) => x.id === g1a.id || x.itemId === g1a.id)
    if (row1) {
      check('G1 inventory qty independent of discount', nearly(row1.stockQty, 48), `invQty=${row1.stockQty}`)
    } else {
      check('G1 inventory row present', false, 'item missing in inventory report')
    }

    // ── G2 ──
    const d2 = await req(token, 'POST', '/sales', {
      paymentType: 'CASH',
      priceType: 'RETAIL',
      currency: 'EGP',
      discountType: 'PERCENT',
      discount: 10,
      items: [
        { itemId: g2a.id, quantity: 1, unitPrice: 100 },
        { itemId: g2b.id, quantity: 1, unitPrice: 100 },
      ],
    })
    const inv2 = d2.data.data
    check('G2 total==180', nearly(inv2.total, 180), `total=${inv2.total}`)
    await req(token, 'POST', `/sales/${inv2.id}/confirm`, {
      payments: [{ method: 'CASH', amount: 180 }],
    })
    const ret2 = await req(token, 'POST', `/sales/${inv2.id}/partial-return`, {
      items: [{ itemId: g2a.id, quantity: 1 }],
    })
    const after2 = ret2.data.data
    check('G2 remaining total==90', nearly(after2.total, 90), `total=${after2.total}`)
    check('G2 remaining tax≈11.05', nearly(after2.tax, 90 * 14 / 114), `tax=${after2.tax}`)
    const pay2 = await req(token, 'GET', `/sales/${inv2.id}`)
    const refund = (pay2.data.data.payments || []).find((p) => p.method === 'REFUND')
    check('G2 refund payment==90', nearly(refund?.amount, 90), `refund=${refund?.amount}`)
    const stock2a = await req(token, 'GET', `/items/${g2a.id}`)
    check('G2 stock A restored 50', nearly(stock2a.data.data.stockQty, 50), `qty=${stock2a.data.data.stockQty}`)

    // ── G3 ──
    await req(token, 'PUT', '/settings', { tax_rate: '0' })
    const d3 = await req(token, 'POST', '/sales', {
      customerId: cust.id,
      paymentType: 'CREDIT',
      priceType: 'RETAIL',
      currency: 'EGP',
      discountType: 'PERCENT',
      discount: 0,
      items: [{ itemId: g3.id, quantity: 1, unitPrice: 200 }],
    })
    const inv3 = d3.data.data
    check('G3 total==200', nearly(inv3.total, 200), `total=${inv3.total}`)
    await req(token, 'POST', `/sales/${inv3.id}/confirm`, {
      payments: [{ method: 'CREDIT', amount: 200 }],
    })
    const cAfter = await req(token, 'GET', `/customers/${cust.id}`)
    check('G3 AR==200', nearly(cAfter.data.data.balance, 200), `bal=${cAfter.data.data.balance}`)
    const vouch = await req(token, 'POST', '/vouchers', {
      type: 'RECEIPT',
      entityType: 'CUSTOMER',
      entityId: cust.id,
      amount: 50,
      currency: 'EGP',
      description: 'golden partial',
    })
    check('G3 receipt ok', vouch.ok, JSON.stringify(vouch.data))
    const cAfter2 = await req(token, 'GET', `/customers/${cust.id}`)
    check('G3 AR==150 after receipt', nearly(cAfter2.data.data.balance, 150), `bal=${cAfter2.data.data.balance}`)

    // ── G4 ──
    await req(token, 'PUT', '/settings', { tax_rate: '0' })
    const d4 = await req(token, 'POST', '/sales', {
      paymentType: 'CASH',
      priceType: 'RETAIL',
      currency: 'EGP',
      discountType: 'FIXED',
      discount: 50,
      items: [{ itemId: g4.id, quantity: 2, unitPrice: 100 }],
    })
    const inv4 = d4.data.data
    check('G4 total==150', nearly(inv4.total, 150), `total=${inv4.total}`)
    await req(token, 'POST', `/sales/${inv4.id}/confirm`, {
      payments: [{ method: 'CASH', amount: 150 }],
    })
    const ret4 = await req(token, 'POST', `/sales/${inv4.id}/partial-return`, {
      items: [{ itemId: g4.id, quantity: 1 }],
    })
    const after4 = ret4.data.data
    check('G4 remaining total==75 (not 50)', nearly(after4.total, 75), `total=${after4.total}`)
    check('G4 remaining discount==25', nearly(after4.discount, 25), `discount=${after4.discount}`)
    const pay4 = await req(token, 'GET', `/sales/${inv4.id}`)
    const refund4 = (pay4.data.data.payments || []).find((p) => p.method === 'REFUND')
    check('G4 refund==75', nearly(refund4?.amount, 75), `refund=${refund4?.amount}`)

    // Shift cash: G1 180 + G2 180 −90 + G4 150 −75 + receipt G3 50 = 395 (credit sale ignored)
    const closed = await req(token, 'POST', '/ops/shifts/close', { closingCash: 395, notes: 'golden' })
    const expected = Number(closed.data?.data?.expectedCash ?? closed.data?.data?.cashBreakdown?.expectedCash)
    check('G-shift expectedCash==395', nearly(expected, 395), `expected=${expected}`)
    check(
      'G-shift shiftCashIn persisted',
      nearly(Number(closed.data?.data?.shiftCashIn), 180 + 180 + 150),
      `cashIn=${closed.data?.data?.shiftCashIn}`
    )
    check(
      'G-shift shiftReceipts==50',
      nearly(Number(closed.data?.data?.shiftReceipts), 50),
      `receipts=${closed.data?.data?.shiftReceipts}`
    )

    // Profit must use discounted totals for G1-like invoice (spot-check via sales vs profit field names)
    const salesR = await req(token, 'GET', `/reports/sales?from=${today}&to=${today}`)
    const profitR = await req(token, 'GET', `/reports/profit?from=${today}&to=${today}`)
    const sTot = Number(salesR.data.data.summary.totalEGP)
    const pRev = Number(profitR.data.data.summary.totalRevenue)
    check('profit.revenue == sales.totalEGP', nearly(pRev, sTot), `profit=${pRev} sales=${sTot}`)
  } finally {
    try {
      execSync(`taskkill /pid ${api.pid} /f /t`, { stdio: 'ignore' })
    } catch {
      /* */
    }
    killPort(API_PORT)
  }

  const passed = results.filter((r) => r.ok).length
  const out = { at: new Date().toISOString(), passed, total: results.length, results }
  fs.writeFileSync(path.join(ROOT, 'docs', 'QA-GOLDEN-ACCOUNTING.json'), JSON.stringify(out, null, 2))
  console.log(`done ${passed}/${results.length}`)
  if (passed !== results.length) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
