/**
 * Profit report must use invoice.total (after invoice-level discount),
 * not raw sum of line subtotals.
 *
 *   node scripts/qa-profit-discount.cjs
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawn, execSync } = require('child_process')
const bcrypt = require('bcryptjs')
const { PrismaClient } = require('@prisma/client')

const ROOT = path.resolve(__dirname, '..')
const SOURCE_DB = path.join(ROOT, 'data', 'cashier.db')
const TEST_DB = path.join(ROOT, 'data', 'cashier-qa-profit-discount.db')
const API_PORT = process.env.QA_PROFIT_PORT || '4019'
const API_BASE = `http://127.0.0.1:${API_PORT}`

function fileUrl(p) {
  return `file:${p.replace(/\\/g, '/')}`
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}
function nearly(a, b, eps = 0.05) {
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

async function main() {
  fs.copyFileSync(SOURCE_DB, TEST_DB)
  const prisma = new PrismaClient({ datasources: { db: { url: fileUrl(TEST_DB) } } })
  const hash = await bcrypt.hash('admin123', 10)
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: { passwordHash: hash, role: 'ADMIN', isActive: true },
    create: { username: 'admin', name: 'Admin', passwordHash: hash, role: 'ADMIN', language: 'ar' },
  })
  await prisma.settings.upsert({
    where: { key: 'tax_rate' },
    update: { value: '0' },
    create: { key: 'tax_rate', value: '0' },
  })
  let wh = await prisma.warehouse.findFirst({ where: { isDefault: true } })
  if (!wh) wh = await prisma.warehouse.create({ data: { name: 'Main', code: 'MAIN', isDefault: true } })
  const item = await prisma.item.create({
    data: {
      name_ar: 'ربح-خصم',
      name_en: 'Profit Disc',
      barcode: `PD-${Date.now()}`,
      retailPrice: 100,
      costPrice: 40,
      stockQty: 50,
      unit: 'piece',
    },
  })
  await prisma.stockBalance.upsert({
    where: { itemId_warehouseId: { itemId: item.id, warehouseId: wh.id } },
    update: { qty: 50 },
    create: { itemId: item.id, warehouseId: wh.id, qty: 50 },
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

  const results = []
  const check = (name, ok, detail) => {
    results.push({ name, ok, detail })
    console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`)
  }

  try {
    await waitHealth()
    const login = await req(null, 'POST', '/auth/login', { username: 'admin', password: 'admin123' })
    const token = login.data.data?.accessToken || login.data.accessToken
    await req(token, 'POST', '/ops/shifts/open', { openingCash: 0 })

    // 2 × 100 = 200 subtotal, FIXED discount 20 → total 180, COGS 80
    const d = await req(token, 'POST', '/sales', {
      paymentType: 'CASH',
      priceType: 'RETAIL',
      currency: 'EGP',
      discountType: 'FIXED',
      discount: 20,
      items: [{ itemId: item.id, quantity: 2, unitPrice: 100 }],
    })
    const id = d.data.data.id
    const total = Number(d.data.data.total)
    await req(token, 'POST', `/sales/${id}/confirm`, {
      payments: [{ method: 'CASH', amount: total }],
    })

    const today = new Date()
    const iso = today.toISOString().slice(0, 10)
    const sales = await req(token, 'GET', `/reports/sales?from=${iso}&to=${iso}`)
    const profit = await req(token, 'GET', `/reports/profit?from=${iso}&to=${iso}`)
    const sTotal = Number(sales.data.data.summary.totalEGP)
    const pRev = Number(profit.data.data.summary.totalRevenue)
    const pCogs = Number(profit.data.data.summary.totalCostOfGoods)
    const pGross = Number(profit.data.data.summary.totalGrossProfit)

    check('invoice total is 180', nearly(total, 180), `total=${total}`)
    check('sales.totalEGP == invoice total', nearly(sTotal, total), `sales=${sTotal}`)
    check('profit.revenue == sales.totalEGP (discount applied)', nearly(pRev, sTotal), `profit=${pRev} sales=${sTotal}`)
    check('profit.cogs == 80', nearly(pCogs, 80), `cogs=${pCogs}`)
    check('profit.gross == 100', nearly(pGross, 100), `gross=${pGross}`)
  } finally {
    try {
      execSync(`taskkill /pid ${api.pid} /f /t`, { stdio: 'ignore' })
    } catch {
      /* */
    }
    killPort(API_PORT)
  }

  const passed = results.filter((r) => r.ok).length
  fs.writeFileSync(
    path.join(ROOT, 'docs', 'QA-PROFIT-DISCOUNT.json'),
    JSON.stringify({ at: new Date().toISOString(), passed, total: results.length, results }, null, 2)
  )
  console.log(`done ${passed}/${results.length}`)
  if (passed !== results.length) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
