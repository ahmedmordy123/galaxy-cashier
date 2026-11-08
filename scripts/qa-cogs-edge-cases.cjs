/**
 * COGS / today-summary edge cases:
 * 1) same-day full return
 * 2) costPrice change between two sales (unitCost snapshotted on confirm)
 * 3) sale + cancel same day
 *
 *   node scripts/qa-cogs-edge-cases.cjs
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawn, execSync } = require('child_process')
const bcrypt = require('bcryptjs')
const { PrismaClient } = require('@prisma/client')

const ROOT = path.resolve(__dirname, '..')
const SOURCE_DB = path.join(ROOT, 'data', 'cashier.db')
const TEST_DB = path.join(ROOT, 'data', 'cashier-qa-cogs-edge.db')
const API_PORT = process.env.QA_COGS_PORT || '4018'
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

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail: String(detail) })
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`)
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
  if (!wh) {
    wh = await prisma.warehouse.create({ data: { name: 'Main', code: 'MAIN', isDefault: true } })
  }

  async function makeItem(name, cost, stock = 50) {
    const item = await prisma.item.create({
      data: {
        name_ar: name,
        name_en: name,
        barcode: `COGS-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        retailPrice: 100,
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

  const itemA = await makeItem('صنف-مرتجع', 40)
  const itemB = await makeItem('صنف-تكلفة', 25)
  const itemC = await makeItem('صنف-إلغاء', 30)
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

    // ── 1) Same-day full return ─────────────────────────────────────────────
    const d1 = await req(token, 'POST', '/sales', {
      paymentType: 'CASH',
      priceType: 'RETAIL',
      currency: 'EGP',
      discountType: 'PERCENT',
      discount: 0,
      items: [{ itemId: itemA.id, quantity: 2, unitPrice: 100 }],
    })
    const id1 = d1.data.data.id
    await req(token, 'POST', `/sales/${id1}/confirm`, { payments: [{ method: 'CASH', amount: 200 }] })
    await req(token, 'POST', `/sales/${id1}/return`, {})

    const dKeep = await req(token, 'POST', '/sales', {
      paymentType: 'CASH',
      priceType: 'RETAIL',
      currency: 'EGP',
      discountType: 'PERCENT',
      discount: 0,
      items: [{ itemId: itemA.id, quantity: 1, unitPrice: 100 }],
    })
    await req(token, 'POST', `/sales/${dKeep.data.data.id}/confirm`, {
      payments: [{ method: 'CASH', amount: 100 }],
    })

    let summary = (await req(token, 'GET', '/reports/today-summary')).data.data
    // Remaining confirmed: 100 revenue, COGS 40 → gross 60 (returned sale must NOT zero COGS)
    check(
      'same-day return: cogs = remaining confirmed only (40)',
      nearly(summary.cogsTotalEGP, 40),
      `cogs=${summary.cogsTotalEGP} gross=${summary.grossProfitEGP} net=${summary.netSalesEGP}`,
    )
    check(
      'same-day return: gross = net - cogs',
      nearly(summary.grossProfitEGP, summary.netSalesEGP - summary.cogsTotalEGP),
      `gross=${summary.grossProfitEGP}`,
    )
    check(
      'same-day return: cogs not wiped to 0',
      Number(summary.cogsTotalEGP) > 0,
      `cogs=${summary.cogsTotalEGP}`,
    )

    // ── 2) costPrice change between two sales ───────────────────────────────
    // First sale at cost 25
    const s1 = await req(token, 'POST', '/sales', {
      paymentType: 'CASH',
      priceType: 'RETAIL',
      currency: 'EGP',
      discountType: 'PERCENT',
      discount: 0,
      items: [{ itemId: itemB.id, quantity: 1, unitPrice: 100 }],
    })
    await req(token, 'POST', `/sales/${s1.data.data.id}/confirm`, {
      payments: [{ method: 'CASH', amount: 100 }],
    })
    // Change item cost to 50 — must NOT rewrite first invoice unitCost
    await req(token, 'PUT', `/items/${itemB.id}`, { costPrice: 50 })
    const s2 = await req(token, 'POST', '/sales', {
      paymentType: 'CASH',
      priceType: 'RETAIL',
      currency: 'EGP',
      discountType: 'PERCENT',
      discount: 0,
      items: [{ itemId: itemB.id, quantity: 1, unitPrice: 100 }],
    })
    await req(token, 'POST', `/sales/${s2.data.data.id}/confirm`, {
      payments: [{ method: 'CASH', amount: 100 }],
    })

    const raw = new PrismaClient({ datasources: { db: { url: fileUrl(TEST_DB) } } })
    const line1 = await raw.salesInvoiceItem.findFirst({
      where: { invoiceId: s1.data.data.id },
    })
    const line2 = await raw.salesInvoiceItem.findFirst({
      where: { invoiceId: s2.data.data.id },
    })
    check(
      'cost change: first sale unitCost stays 25',
      nearly(line1.unitCost, 25),
      `unitCost=${line1.unitCost}`,
    )
    check(
      'cost change: second sale unitCost = 50',
      nearly(line2.unitCost, 50),
      `unitCost=${line2.unitCost}`,
    )
    summary = (await req(token, 'GET', '/reports/today-summary')).data.data
    // COGS includes: itemA remaining 40 + itemB 25 + itemB 50 = part of total
    const invCosts = await raw.salesInvoiceItem.findMany({
      where: { invoice: { status: 'CONFIRMED', isActive: true } },
    })
    const sqlCogs = invCosts.reduce((s, l) => s + Number(l.quantity) * Number(l.unitCost), 0)
    check(
      'cost change: today cogs matches sum of snapshotted unitCosts',
      nearly(summary.cogsTotalEGP, sqlCogs),
      `api=${summary.cogsTotalEGP} sql=${sqlCogs}`,
    )
    await raw.$disconnect()

    // ── 3) sale + cancel same day ───────────────────────────────────────────
    const c1 = await req(token, 'POST', '/sales', {
      paymentType: 'CASH',
      priceType: 'RETAIL',
      currency: 'EGP',
      discountType: 'PERCENT',
      discount: 0,
      items: [{ itemId: itemC.id, quantity: 1, unitPrice: 100 }],
    })
    const cid = c1.data.data.id
    await req(token, 'POST', `/sales/${cid}/confirm`, {
      payments: [{ method: 'CASH', amount: 100 }],
    })
    const beforeCancel = (await req(token, 'GET', '/reports/today-summary')).data.data
    const cancel = await req(token, 'POST', `/sales/${cid}/cancel`, {})
    check('cancel confirmed sale HTTP', cancel.ok, cancel.status)
    const afterCancel = (await req(token, 'GET', '/reports/today-summary')).data.data
    check(
      'cancel same day: netSales drops by ~100',
      nearly(beforeCancel.netSalesEGP - afterCancel.netSalesEGP, 100),
      `before=${beforeCancel.netSalesEGP} after=${afterCancel.netSalesEGP}`,
    )
    check(
      'cancel same day: cogs drops by ~30',
      nearly(beforeCancel.cogsTotalEGP - afterCancel.cogsTotalEGP, 30),
      `beforeCogs=${beforeCancel.cogsTotalEGP} afterCogs=${afterCancel.cogsTotalEGP}`,
    )
    check(
      'cancel same day: cancelled invoice not in confirmed cogs',
      nearly(afterCancel.grossProfitEGP, afterCancel.netSalesEGP - afterCancel.cogsTotalEGP),
      `gross=${afterCancel.grossProfitEGP}`,
    )
  } finally {
    try {
      spawn('taskkill', ['/pid', String(api.pid), '/f', '/t'], { stdio: 'ignore' })
    } catch {
      /* */
    }
    killPort(API_PORT)
  }

  fs.writeFileSync(
    path.join(ROOT, 'docs', 'QA-COGS-EDGE-RESULTS.json'),
    JSON.stringify({ at: new Date().toISOString(), results }, null, 2),
  )
  const failed = results.filter((r) => !r.ok)
  console.log(`\nSummary ${results.length - failed.length}/${results.length}`)
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
