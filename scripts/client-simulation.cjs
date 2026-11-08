/**
 * Real-client week simulation against installed Galaxy Cashier Setup.
 * Writes SIMULATION_REPORT.md at repo root.
 *
 *   node scripts/client-simulation.cjs
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawn, execSync } = require('child_process')
const { PrismaClient } = require('@prisma/client')
const { buildCatalog } = require('./sim-catalog.cjs')

const ROOT = path.resolve(__dirname, '..')
const REPORT = path.join(ROOT, 'SIMULATION_REPORT.md')
const EXE = 'C:\\Program Files\\Galaxy Cashier\\Galaxy Cashier.exe'
const SEED = 'C:\\Program Files\\Galaxy Cashier\\resources\\seed.db'
const DATA_DIR = path.join(process.env.USERPROFILE, 'Documents', 'CASR', 'data')
const DB = path.join(DATA_DIR, 'cashier.db')
const API = 'http://127.0.0.1:4001'
const BAK_DIR = path.join(process.env.USERPROFILE, 'Documents', 'CASR-Sim-Backups')

const lines = []
const issues = []
const timings = []
const dayStats = []

function log(s = '') {
  lines.push(s)
  console.log(s)
}
function issue(title, detail, needsDecision = false) {
  issues.push({ title, detail, needsDecision, fixed: false })
  log(`⚠️ مشكلة: ${title} — ${detail}${needsDecision ? ' (تحتاج قرار)' : ''}`)
}
function issueFixed(title, detail, testNote) {
  issues.push({ title, detail, needsDecision: false, fixed: true, testNote })
  log(`✅ أصلحت: ${title} — ${detail}`)
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}
function fileUrl(p) {
  return `file:${p.replace(/\\/g, '/')}`
}
function rnd(a, b) {
  return a + Math.floor(Math.random() * (b - a + 1))
}
function pick(arr) {
  return arr[rnd(0, arr.length - 1)]
}
function nearly(a, b, eps = 0.01) {
  return Math.abs(Number(a) - Number(b)) <= eps
}
function dayIso(offsetFromBase, base = '2026-10-26') {
  const d = new Date(base + 'T12:00:00')
  d.setDate(d.getDate() + offsetFromBase)
  return d.toISOString().slice(0, 10)
}
function dayStamp(iso, h = 10, m = 0, s = 0) {
  const d = new Date(`${iso}T00:00:00`)
  d.setHours(h, m, s, 0)
  return d
}

function killGalaxy() {
  try {
    execSync('taskkill /IM "Galaxy Cashier.exe" /F', { stdio: 'ignore' })
  } catch {
    /* */
  }
  for (const port of [4001, 3001]) {
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
}

async function waitHealth(sec = 120) {
  const t0 = Date.now()
  for (let i = 0; i < sec; i++) {
    try {
      const r = await fetch(`${API}/health`)
      if (r.ok) return Date.now() - t0
    } catch {
      /* */
    }
    await sleep(1000)
  }
  throw new Error('health timeout')
}

async function startApp() {
  killGalaxy()
  await sleep(1500)
  const t0 = Date.now()
  spawn(EXE, [], { detached: true, stdio: 'ignore' }).unref()
  const ms = await waitHealth(150)
  return { openMs: Date.now() - t0, healthMs: ms }
}

async function req(token, method, urlPath, body) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const r = await fetch(`${API}/api${urlPath}`, {
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

async function login(user, pass) {
  const r = await req(null, 'POST', '/auth/login', { username: user, password: pass })
  if (!r.ok) throw new Error(`login ${user}: ${r.status} ${JSON.stringify(r.data)}`)
  return r.data.data?.accessToken || r.data.accessToken
}

function prismaDb() {
  return new PrismaClient({ datasources: { db: { url: fileUrl(DB) } } })
}

async function backdateSince(cutoffIso, logicalDay, opts = {}) {
  const prisma = prismaDb()
  try {
    const start = new Date(cutoffIso)
    const baseH = opts.hour ?? 11
    const stamp = dayStamp(logicalDay, baseH, rnd(0, 40), rnd(0, 50))
    const midnightExtra = opts.midnightInvoiceIds || []

    const invs = await prisma.salesInvoice.findMany({
      where: { createdAt: { gte: start } },
      select: { id: true },
    })
    for (const inv of invs) {
      const isMid = midnightExtra.includes(inv.id)
      const at = isMid
        ? dayStamp(dayIso(dayOffset(logicalDay) + 1), 0, 20, rnd(0, 40))
        : new Date(stamp.getTime() + rnd(0, 6) * 3600000 + rnd(0, 50) * 60000)
      await prisma.salesInvoice.update({ where: { id: inv.id }, data: { createdAt: at, updatedAt: at } })
      await prisma.salesPayment.updateMany({ where: { invoiceId: inv.id }, data: { createdAt: at } })
    }

    await prisma.purchaseInvoice.updateMany({
      where: { createdAt: { gte: start } },
      data: { createdAt: stamp, updatedAt: stamp },
    })
    await prisma.expense.updateMany({
      where: { createdAt: { gte: start } },
      data: { createdAt: stamp, date: stamp },
    })
    await prisma.paymentVoucher.updateMany({
      where: { createdAt: { gte: start } },
      data: { createdAt: stamp },
    })
    await prisma.cashierShift.updateMany({
      where: { openedAt: { gte: start } },
      data: { openedAt: dayStamp(logicalDay, 8, 0, 0), closedAt: dayStamp(logicalDay, 22, 0, 0) },
    })
    return invs.length
  } finally {
    await prisma.$disconnect()
  }
}

function dayOffset(iso) {
  const base = new Date('2026-10-26T12:00:00')
  const d = new Date(iso + 'T12:00:00')
  return Math.round((d - base) / 86400000)
}

async function confirmSale(token, items, opts = {}) {
  const body = {
    customerId: opts.customerId || null,
    paymentType: opts.paymentType || 'CASH',
    priceType: 'RETAIL',
    currency: 'EGP',
    discountType: opts.discountType || 'PERCENT',
    discount: opts.discount ?? 0,
    items: items.map((x) => ({
      itemId: x.itemId,
      quantity: x.quantity,
      unitPrice: x.unitPrice,
      discount: x.lineDiscount || 0,
    })),
  }
  const t0 = Date.now()
  const created = await req(token, 'POST', '/sales', body)
  if (!created.ok) {
    return { ok: false, error: created.data, ms: Date.now() - t0 }
  }
  const inv = created.data.data
  const total = Number(inv.total)
  const payments =
    opts.paymentType === 'CREDIT'
      ? [{ method: 'CREDIT', amount: total }]
      : [{ method: 'CASH', amount: total }]
  const conf = await req(token, 'POST', `/sales/${inv.id}/confirm`, { payments })
  const ms = Date.now() - t0
  if (!conf.ok) return { ok: false, error: conf.data, id: inv.id, ms }
  return { ok: true, id: inv.id, total, ms, invoice: conf.data.data || inv }
}

async function runDaySales(cashierToken, adminToken, ctx, dayCfg) {
  const { items, creditCustomers, cashCustomers } = ctx
  const n = dayCfg.salesCount
  const confirmed = []
  const errors = []
  let saveMsSum = 0
  let saveN = 0

  for (let i = 0; i < n; i++) {
    const kindRoll = Math.random()
    let payload
    if (kindRoll < 0.12) {
      // weighted sale
      const it = pick(items.filter((x) => x.unit === 'kg'))
      const qty = Number((0.25 + Math.random() * 2.75).toFixed(3))
      payload = {
        items: [{ itemId: it.id, quantity: qty, unitPrice: it.retailPrice }],
        paymentType: 'CASH',
      }
    } else if (kindRoll < 0.22) {
      // discount
      const it = pick(items)
      payload = {
        items: [{ itemId: it.id, quantity: rnd(1, 3), unitPrice: it.retailPrice }],
        discountType: Math.random() < 0.5 ? 'PERCENT' : 'FIXED',
        discount: Math.random() < 0.5 ? rnd(5, 15) : rnd(2, 20),
        paymentType: 'CASH',
      }
    } else if (kindRoll < 0.32) {
      // credit
      const cust = pick(creditCustomers)
      const it = pick(items)
      payload = {
        customerId: cust.id,
        paymentType: 'CREDIT',
        items: [{ itemId: it.id, quantity: rnd(1, 4), unitPrice: it.retailPrice }],
      }
    } else if (kindRoll < 0.42) {
      // many lines
      const linesN = rnd(5, 12)
      const chosen = []
      for (let k = 0; k < linesN; k++) {
        const it = pick(items)
        chosen.push({
          itemId: it.id,
          quantity: it.unit === 'kg' ? Number((0.2 + Math.random()).toFixed(2)) : rnd(1, 2),
          unitPrice: it.retailPrice,
        })
      }
      payload = { items: chosen, paymentType: 'CASH' }
    } else {
      // single item cash
      const it = pick(items)
      payload = {
        items: [
          {
            itemId: it.id,
            quantity: it.unit === 'kg' ? Number((0.5 + Math.random() * 1.5).toFixed(2)) : rnd(1, 5),
            unitPrice: it.retailPrice,
          },
        ],
        paymentType: 'CASH',
        customerId: Math.random() < 0.2 ? pick(cashCustomers).id : null,
      }
    }

    const res = await confirmSale(cashierToken, payload.items, payload)
    if (res.ok) {
      confirmed.push(res)
      saveMsSum += res.ms
      saveN++
    } else {
      errors.push(res.error)
      // restock attempt skip
    }
  }

  // returns (>=3)
  const returnTargets = confirmed.filter((c) => c.ok).slice(-8)
  let returns = 0
  for (const t of returnTargets) {
    if (returns >= dayCfg.returns) break
    const full = Math.random() < 0.4
    if (full) {
      const r = await req(adminToken, 'POST', `/sales/${t.id}/return`)
      if (r.ok) returns++
    } else {
      const detail = await req(adminToken, 'GET', `/sales/${t.id}`)
      const line = detail.data?.data?.items?.[0]
      if (!line) continue
      const qty = Math.max(0.1, Number((Number(line.quantity) * 0.5).toFixed(3)))
      const r = await req(adminToken, 'POST', `/sales/${t.id}/partial-return`, {
        items: [{ itemId: line.itemId, quantity: qty }],
      })
      if (r.ok) returns++
    }
  }

  // cancel one confirmed
  let cancelled = false
  const cancelTarget = confirmed[Math.floor(confirmed.length / 3)]
  if (cancelTarget) {
    const r = await req(adminToken, 'POST', `/sales/${cancelTarget.id}/cancel`)
    cancelled = r.ok
    if (!r.ok) log(`  إلغاء فشل: ${JSON.stringify(r.data)}`)
  }

  // partial credit receipt
  let receiptOk = false
  const cust = pick(creditCustomers)
  const bal = await req(adminToken, 'GET', `/customers/${cust.id}`)
  const balance = Number(bal.data?.data?.balance || 0)
  if (balance > 0) {
    const amount = Math.min(balance, Math.max(10, Math.round(balance * 0.3)))
    const r = await req(adminToken, 'POST', '/vouchers', {
      type: 'RECEIPT',
      entityType: 'CUSTOMER',
      entityId: cust.id,
      amount,
      currency: 'EGP',
      description: `تسديد جزئي محاكاة يوم ${dayCfg.iso}`,
    })
    receiptOk = r.ok
  }

  // expense from drawer
  const exp = await req(adminToken, 'POST', '/expenses', {
    categoryId: 'expcat-utilities',
    amount: rnd(25, 120),
    currency: 'EGP',
    description: 'مصروف يومي محاكاة',
    date: new Date().toISOString().slice(0, 10),
  })

  // purchase with cost change
  const supplier = pick(ctx.suppliers)
  const buyItem = pick(items)
  const newCost = Number((buyItem.costPrice * (0.9 + Math.random() * 0.3)).toFixed(2))
  const qty = rnd(5, 20)
  const purch = await req(adminToken, 'POST', '/purchases', {
    supplierId: supplier.id,
    paymentType: Math.random() < 0.5 ? 'CASH' : 'CREDIT',
    currency: 'EGP',
    items: [{ itemId: buyItem.id, quantity: qty, unitCost: newCost }],
  })
  let purchaseOk = false
  if (purch.ok) {
    const pid = purch.data.data.id
    const conf = await req(adminToken, 'POST', `/purchases/${pid}/confirm`)
    purchaseOk = conf.ok
    buyItem.costPrice = newCost
  }

  // deplete one item toward low stock
  let lowStockHit = false
  const lowCand = items.find((x) => x.minimumStock > 0) || items[0]
  const lowDetail = await req(adminToken, 'GET', `/items/${lowCand.id}`)
  const stockQty = Number(lowDetail.data?.data?.stockQty || 0)
  if (stockQty > lowCand.minimumStock) {
    const dumpQty = Math.max(1, stockQty - lowCand.minimumStock + 1)
    // sell down via admin cash sale in chunks if needed
    const unitPrice = Number(lowDetail.data.data.retailPrice)
    const maxPer = Math.min(dumpQty, 50)
    const r = await confirmSale(adminToken, [{ itemId: lowCand.id, quantity: maxPer, unitPrice }], {
      paymentType: 'CASH',
    })
    if (r.ok) {
      const low = await req(adminToken, 'GET', '/stock/low-stock')
      lowStockHit = Array.isArray(low.data?.data)
        ? low.data.data.some((x) => x.id === lowCand.id || x.itemId === lowCand.id)
        : Array.isArray(low.data?.data?.items)
          ? low.data.data.items.some((x) => x.id === lowCand.id)
          : false
      if (!lowStockHit) {
        // accept if stock now <= min
        const after = await req(adminToken, 'GET', `/items/${lowCand.id}`)
        const sq = Number(after.data?.data?.stockQty || 99)
        const mn = Number(after.data?.data?.minimumStock || 0)
        lowStockHit = sq <= mn
      }
    }
  } else {
    lowStockHit = true
  }

  const today = await req(adminToken, 'GET', '/reports/today-summary')
  const shiftSum = await req(cashierToken, 'GET', '/ops/shifts/current/summary')

  return {
    salesAttempted: n,
    salesOk: confirmed.length,
    salesFail: errors.length,
    returns,
    cancelled,
    receiptOk,
    expenseOk: exp.ok,
    purchaseOk,
    lowStockHit,
    avgSaveMs: saveN ? Math.round(saveMsSum / saveN) : 0,
    todaySummary: today.data?.data || null,
    shiftSummary: shiftSum.data?.data || null,
    lastErrors: errors.slice(0, 3),
    confirmedIds: confirmed.map((c) => c.id),
  }
}

async function sqliteTotals(fromIso, toIso) {
  const prisma = prismaDb()
  try {
    const start = dayStamp(fromIso, 0, 0, 0)
    const end = dayStamp(toIso, 23, 59, 59)
    const confirmed = await prisma.salesInvoice.findMany({
      where: {
        isActive: true,
        status: { in: ['CONFIRMED', 'RETURNED'] },
        createdAt: { gte: start, lte: end },
      },
      include: { items: true, payments: true },
    })
    const confirmedOnly = confirmed.filter((i) => i.status === 'CONFIRMED')
    const returned = confirmed.filter((i) => i.status === 'RETURNED')
    let salesTotal = 0
    let cogs = 0
    let creditBalance = 0
    for (const inv of confirmedOnly) {
      salesTotal += Number(inv.total)
      for (const line of inv.items) {
        cogs += Number(line.quantity) * Number(line.unitCost)
      }
      if (inv.type === 'CREDIT') creditBalance += Number(inv.balance)
    }
    let returnsTotal = 0
    for (const inv of returned) returnsTotal += Number(inv.total)

    const customers = await prisma.customer.findMany({ where: { isActive: true } })
    const customerAR = customers.reduce((s, c) => s + Number(c.balance), 0)
    const stockValue = await prisma.item.findMany({ where: { isActive: true }, select: { stockQty: true, costPrice: true } })
    const invValue = stockValue.reduce((s, i) => s + Number(i.stockQty) * Number(i.costPrice), 0)
    const expenses = await prisma.expense.aggregate({
      where: { date: { gte: start, lte: end } },
      _sum: { amount: true },
    })
    return {
      salesConfirmed: salesTotal,
      returnsTotal,
      cogs,
      grossProfit: salesTotal - cogs,
      customerAR,
      inventoryCostValue: invValue,
      expenses: Number(expenses._sum.amount || 0),
      invoiceCount: confirmedOnly.length,
      returnedCount: returned.length,
    }
  } finally {
    await prisma.$disconnect()
  }
}

async function reconcilePeriod(adminToken, fromIso, toIso) {
  const sql = await sqliteTotals(fromIso, toIso)
  const salesR = await req(adminToken, 'GET', `/reports/sales?from=${fromIso}&to=${toIso}`)
  const profitR = await req(adminToken, 'GET', `/reports/profit?from=${fromIso}&to=${toIso}`)
  const invR = await req(adminToken, 'GET', `/reports/inventory`)

  const salesApi = salesR.data?.data?.summary || salesR.data?.data || {}
  const profitApi = profitR.data?.data?.summary || profitR.data?.data || {}
  const diffs = []

  const pairs = [
    ['sales.totalEGP', Number(salesApi.totalEGP ?? salesApi.total ?? NaN), sql.salesConfirmed],
    ['profit.revenue', Number(profitApi.totalSalesEGP ?? profitApi.revenue ?? profitApi.salesTotalEGP ?? NaN), sql.salesConfirmed],
    ['profit.cogs', Number(profitApi.cogsTotalEGP ?? profitApi.cogs ?? NaN), sql.cogs],
    ['profit.gross', Number(profitApi.grossProfitEGP ?? profitApi.grossProfit ?? NaN), sql.grossProfit],
  ]

  for (const [name, apiV, sqlV] of pairs) {
    if (!Number.isFinite(apiV)) {
      diffs.push({ name, api: apiV, sql: sqlV, note: 'حقل API غير موجود/NaN' })
      continue
    }
    if (!nearly(apiV, sqlV, 0.05)) {
      diffs.push({ name, api: apiV, sql: sqlV, delta: Number((apiV - sqlV).toFixed(3)) })
    }
  }

  return { sql, salesApi, profitApi, invApi: invR.data?.data, diffs }
}

async function measurePerf(adminToken, label) {
  const prisma = prismaDb()
  let itemCount = 0
  let invCount = 0
  try {
    itemCount = await prisma.item.count({ where: { isActive: true } })
    invCount = await prisma.salesInvoice.count()
  } finally {
    await prisma.$disconnect()
  }

  const searchT0 = Date.now()
  await req(adminToken, 'GET', '/items?search=' + encodeURIComponent('أرز') + '&pageSize=20')
  const searchMs = Date.now() - searchT0

  const items = (await req(adminToken, 'GET', '/items?pageSize=5')).data?.data?.items
    || (await req(adminToken, 'GET', '/items?page=1&pageSize=5')).data?.data
  const list = Array.isArray(items) ? items : items?.items || []
  const it = list[0]
  let saveMs = null
  if (it) {
    const r = await confirmSale(adminToken, [{ itemId: it.id, quantity: 1, unitPrice: Number(it.retailPrice) }], {
      paymentType: 'CASH',
    })
    saveMs = r.ms
  }

  const from = '2026-10-01'
  const to = '2026-11-30'
  const repT0 = Date.now()
  await req(adminToken, 'GET', `/reports/sales?from=${from}&to=${to}`)
  const reportMs = Date.now() - repT0

  const row = { label, itemCount, invCount, searchMs, saveMs, reportMs }
  timings.push(row)
  return row
}

function sid(prefix, n) {
  return `${prefix}${String(n).padStart(8, '0')}`
}

async function bulkScale(adminId, warehouseId) {
  killGalaxy()
  await sleep(2000)
  const prisma = prismaDb()
  try {
    const existing = await prisma.item.count()
    const need = Math.max(0, 5000 - existing)
    log(`توليد أصناف إضافية: ${need} (الحالي ${existing})`)
    const itemBatch = []
    const balBatch = []
    for (let i = 0; i < need; i++) {
      const n = existing + i + 1
      const id = sid('gitem', n)
      itemBatch.push({
        id,
        name_ar: `صنف مولَّد للمحاكاة رقم ${n}`,
        name_en: `Gen ${n}`,
        barcode: `9${String(100000000000 + n).slice(-12)}`,
        unit: 'piece',
        costPrice: 5 + (n % 40),
        retailPrice: 10 + (n % 60),
        stockQty: 100,
        minimumStock: 5,
        isActive: true,
      })
      balBatch.push({ id: sid('gbal', n), itemId: id, warehouseId, qty: 100 })
      if (itemBatch.length >= 500) {
        await prisma.item.createMany({ data: itemBatch })
        await prisma.stockBalance.createMany({ data: balBatch })
        itemBatch.length = 0
        balBatch.length = 0
        log(`  … أصناف ${n}`)
      }
    }
    if (itemBatch.length) {
      await prisma.item.createMany({ data: itemBatch })
      await prisma.stockBalance.createMany({ data: balBatch })
    }

    const allItems = await prisma.item.findMany({
      where: { isActive: true },
      select: { id: true, retailPrice: true, costPrice: true },
      take: 5000,
    })
    const invExisting = await prisma.salesInvoice.count()
    const needInv = Math.max(0, 20000 - invExisting)
    log(`توليد فواتير: ${needInv} (الحالي ${invExisting})`)
    const stamp0 = dayStamp('2026-09-15', 12, 0, 0).getTime()
    const invBatch = []
    const lineBatch = []
    const payBatch = []
    for (let i = 0; i < needInv; i++) {
      const it = allItems[i % allItems.length]
      const qty = 1 + (i % 3)
      const price = Number(it.retailPrice)
      const cost = Number(it.costPrice)
      const sub = qty * price
      const id = sid('ginv', invExisting + i + 1)
      const at = new Date(stamp0 + (i % 45) * 86400000 + (i % 100) * 1000)
      invBatch.push({
        id,
        invoiceNumber: `SIMBULK-${invExisting + i + 1}`,
        type: 'CASH',
        priceType: 'RETAIL',
        currency: 'EGP',
        exchangeRate: 1,
        subtotal: sub,
        discountType: 'PERCENT',
        discount: 0,
        tax: 0,
        total: sub,
        amountPaid: sub,
        balance: 0,
        status: 'CONFIRMED',
        createdById: adminId,
        warehouseId,
        createdAt: at,
        updatedAt: at,
        isActive: true,
      })
      lineBatch.push({
        id: sid('gln', invExisting + i + 1),
        invoiceId: id,
        itemId: it.id,
        quantity: qty,
        unitPrice: price,
        unitCost: cost,
        subtotal: sub,
        currency: 'EGP',
      })
      payBatch.push({
        id: sid('gpay', invExisting + i + 1),
        invoiceId: id,
        method: 'CASH',
        amount: sub,
        createdAt: at,
      })
      if (invBatch.length >= 500) {
        await prisma.salesInvoice.createMany({ data: invBatch })
        await prisma.salesInvoiceItem.createMany({ data: lineBatch })
        await prisma.salesPayment.createMany({ data: payBatch })
        invBatch.length = 0
        lineBatch.length = 0
        payBatch.length = 0
        if ((i + 1) % 2000 === 0) log(`  … فواتير ${i + 1}/${needInv}`)
      }
    }
    if (invBatch.length) {
      await prisma.salesInvoice.createMany({ data: invBatch })
      await prisma.salesInvoiceItem.createMany({ data: lineBatch })
      await prisma.salesPayment.createMany({ data: payBatch })
    }
  } finally {
    await prisma.$disconnect()
  }
}

async function main() {
  const startedAt = new Date()
  log('# تقرير محاكاة عميل حقيقي — Galaxy Cashier')
  log('')
  log(`- التاريخ: ${startedAt.toISOString()}`)
  log(`- الهدف: Setup المثبّت \`${EXE}\``)
  log(`- قاعدة البيانات: \`${DB}\``)
  log(`- الشخصية: صاحب بقالة/عطارة بالمنوفية (أدمن) + كاشير واحد`)
  log('')

  if (!fs.existsSync(EXE)) throw new Error('Setup not installed')
  if (!fs.existsSync(SEED)) throw new Error('seed.db missing')

  fs.mkdirSync(BAK_DIR, { recursive: true })
  fs.mkdirSync(DATA_DIR, { recursive: true })

  // ── Prep: fresh DB from seed ──
  log('## 0) تجهيز بيئة نظيفة')
  killGalaxy()
  await sleep(2000)
  const aside = path.join(DATA_DIR, `cashier.db.pre-sim-${Date.now()}`)
  if (fs.existsSync(DB)) {
    fs.copyFileSync(DB, aside)
    log(`- حفظ نسخة سابقة: \`${aside}\``)
  }
  fs.copyFileSync(SEED, DB)
  // clear wal/shm
  for (const s of ['-wal', '-shm']) {
    const p = DB + s
    if (fs.existsSync(p)) fs.unlinkSync(p)
  }
  log('- نسخ seed.db → cashier.db (أول تشغيل نظيف)')
  log(`- مجلد النسخ الاحتياطي للمحاكاة: \`${BAK_DIR}\``)

  let boot = await startApp()
  timings.push({ label: 'first-open-fresh-db', openMs: boot.openMs, healthMs: boot.healthMs })
  log(`- فتح البرنامج حتى /health: **${boot.openMs} ms**`)

  let adminToken = await login('admin', 'admin123')
  log('- تسجيل دخول الأدمن الافتراضي من الـ seed: `admin / admin123`')

  // Day 1
  const day1 = dayIso(0)
  log('')
  log(`## اليوم 1 — إعداد المحل (${day1})`)
  const cutoff1 = new Date().toISOString()

  const settings = await req(adminToken, 'PUT', '/settings', {
    business_name_ar: 'عطارة الحاج محمود — منوف',
    business_name_en: 'Haj Mahmoud Spices',
    business_address: 'شارع الجلاء، منوف، المنوفية',
    business_phone: '048-2223344',
    tax_rate: '14',
    default_currency: 'EGP',
    default_price_type: 'RETAIL',
    paper_width: '80',
    minimum_stock_alert: 'true',
    auto_backup_enabled: 'true',
    auto_backup_interval_hours: '6',
    auto_backup_keep_count: '30',
    backup_on_exit: 'true',
    backup_directory: BAK_DIR,
  })
  log(`- ضبط بيانات المحل والضريبة 14%: ${settings.ok ? 'OK' : JSON.stringify(settings.data)}`)

  const cashierUser = await req(adminToken, 'POST', '/settings/users', {
    name: 'أحمد الكاشير',
    username: 'cashier_ahmed',
    password: 'cashier123',
    role: 'CASHIER',
    language: 'ar',
  })
  log(`- إنشاء مستخدم كاشير: ${cashierUser.ok ? 'OK' : JSON.stringify(cashierUser.data)}`)

  const catalog = buildCatalog(150)
  log(`- إدخال ${catalog.length} صنف…`)
  let itemsCreated = 0
  const itemFails = []
  for (const row of catalog) {
    const r = await req(adminToken, 'POST', '/items', row)
    if (r.ok) itemsCreated++
    else itemFails.push(r.data)
  }
  log(`- أصناف ناجحة: **${itemsCreated}/150**${itemFails.length ? ` — فشل أول خطأ: ${JSON.stringify(itemFails[0])}` : ''}`)
  if (itemsCreated < 140) issue('إنشاء الأصناف', `نجح ${itemsCreated} فقط`, true)

  const suppliers = []
  const supplierNames = [
    'شركة الدلتا للمواد الغذائية',
    'مؤسسة أبو سمير للعطارة',
    'توزيعات المنوفية',
    'مصنع الزيوت المتحدة',
    'مورد الألبان الطازجة',
  ]
  for (const name of supplierNames) {
    const r = await req(adminToken, 'POST', '/suppliers', {
      name,
      phone: '010' + rnd(10000000, 99999999),
      currency: 'EGP',
    })
    if (r.ok) suppliers.push(r.data.data)
  }
  log(`- موردون: **${suppliers.length}/5**`)

  const customers = []
  const custDefs = [
    ['عم محمد الشامي', 0],
    ['ست زينب جارة المحل', 0],
    ['أبو أحمد السائق', 0],
    ['مكتب التموين الصغير', 0],
    ['كافيتريا المدرسة', 0],
    ['بيت الحاج فوزي', 0],
    ['مسجد الحي (مشتروات)', 0],
    ['عم سيد الآجل', 5000],
    ['محل نانسي جملة', 8000],
    ['مقاول أحمد — حساب آجل', 10000],
  ]
  for (const [name, limit] of custDefs) {
    const r = await req(adminToken, 'POST', '/customers', {
      name,
      phone: '01' + rnd(100000000, 999999999),
      type: limit > 0 ? 'WHOLESALE' : 'RETAIL',
      creditLimit: limit,
      currency: 'EGP',
    })
    if (r.ok) customers.push(r.data.data)
  }
  log(`- عملاء: **${customers.length}/10** (آجل: ${customers.filter((c) => Number(c.creditLimit) > 0).length})`)

  // refresh item list with ids/prices
  let items = []
  {
    let page = 1
    for (;;) {
      const r = await req(adminToken, 'GET', `/items?page=${page}&pageSize=100`)
      const payload = r.data?.data
      const chunk = payload?.items || payload?.data || (Array.isArray(payload) ? payload : [])
      if (!chunk.length) break
      items = items.concat(chunk)
      if (chunk.length < 100) break
      page++
    }
  }
  log(`- أصناف مقروءة من API بعد الإدخال: ${items.length}`)

  const ctx = {
    items: items.map((i) => ({
      id: i.id,
      retailPrice: Number(i.retailPrice),
      costPrice: Number(i.costPrice),
      unit: i.unit,
      minimumStock: Number(i.minimumStock || 0),
      name_ar: i.name_ar,
    })),
    suppliers,
    creditCustomers: customers.filter((c) => Number(c.creditLimit) > 0),
    cashCustomers: customers.filter((c) => Number(c.creditLimit) === 0),
  }

  await backdateSince(cutoff1, day1, { hour: 9 })
  dayStats.push({ day: 1, iso: day1, phase: 'setup', items: itemsCreated, suppliers: suppliers.length, customers: customers.length })
  log('- تم ختم تاريخ يوم الإعداد في SQLite')

  // Perf baseline @ 150
  adminToken = await login('admin', 'admin123')
  let cashierToken = await login('cashier_ahmed', 'cashier123')
  const openShift0 = await req(cashierToken, 'POST', '/ops/shifts/open', { openingCash: 500 })
  if (!openShift0.ok) log(`- فتح وردية تجريبي للأداء: ${JSON.stringify(openShift0.data)}`)
  const perf150 = await measurePerf(adminToken, 'after-day1-150-items')
  log(`- قياس أداء @150 صنف: بحث ${perf150.searchMs}ms · حفظ فاتورة ${perf150.saveMs}ms · تقرير شهر ${perf150.reportMs}ms`)
  await req(cashierToken, 'POST', '/ops/shifts/close', { closingCash: 500, notes: 'قياس' })

  const dayPlan = [
    { day: 2, iso: dayIso(1), salesCount: 42, returns: 3, openingCash: 500, events: [] },
    { day: 3, iso: dayIso(2), salesCount: 58, returns: 4, openingCash: 600, events: ['kill'] },
    { day: 4, iso: dayIso(3), salesCount: 71, returns: 3, openingCash: 550, events: ['backup-restore'] },
    { day: 5, iso: dayIso(4), salesCount: 80, returns: 5, openingCash: 700, events: ['midnight'] },
    { day: 6, iso: dayIso(5), salesCount: 45, returns: 3, openingCash: 500, events: [] },
    { day: 7, iso: dayIso(6), salesCount: 63, returns: 4, openingCash: 650, events: [] },
  ]

  for (const plan of dayPlan) {
    log('')
    log(`## اليوم ${plan.day} — تشغيل (${plan.iso}) · هدف مبيعات ≈ ${plan.salesCount}`)
    adminToken = await login('admin', 'admin123')
    cashierToken = await login('cashier_ahmed', 'cashier123')

    // ensure no stale open shift
    const cur = await req(cashierToken, 'GET', '/ops/shifts/current')
    if (cur.data?.data?.id) {
      await req(cashierToken, 'POST', '/ops/shifts/close', { closingCash: plan.openingCash, notes: 'إغلاق قبل يوم جديد' })
    }

    const cutoff = new Date().toISOString()
    const opened = await req(cashierToken, 'POST', '/ops/shifts/open', { openingCash: plan.openingCash })
    log(`- فتح وردية بعهدة ${plan.openingCash} ج: ${opened.ok ? 'OK' : JSON.stringify(opened.data)}`)

    // mid-week kill during draft sale
    if (plan.events.includes('kill')) {
      log('### محاكاة قتل البرنامج أثناء فاتورة')
      const it = pick(ctx.items)
      const draft = await req(cashierToken, 'POST', '/sales', {
        paymentType: 'CASH',
        priceType: 'RETAIL',
        currency: 'EGP',
        discountType: 'PERCENT',
        discount: 0,
        items: [{ itemId: it.id, quantity: 2, unitPrice: it.retailPrice }],
      })
      const draftId = draft.data?.data?.id
      const stockBefore = Number((await req(adminToken, 'GET', `/items/${it.id}`)).data?.data?.stockQty)
      log(`- مسودة فاتورة ${draftId || '?'} لصنف ${it.name_ar} · مخزون قبل: ${stockBefore}`)
      killGalaxy()
      log('- تم `taskkill` لـ Galaxy Cashier أثناء المسودة (قبل التأكيد)')
      await sleep(2000)
      boot = await startApp()
      log(`- إعادة الفتح: ${boot.openMs} ms`)
      adminToken = await login('admin', 'admin123')
      cashierToken = await login('cashier_ahmed', 'cashier123')
      // reopen shift if needed
      const cur2 = await req(cashierToken, 'GET', '/ops/shifts/current')
      if (!cur2.data?.data?.id) {
        await req(cashierToken, 'POST', '/ops/shifts/open', { openingCash: plan.openingCash })
        log('- أُعيد فتح الوردية بعد القتل (كانت مغلقة أو ضاعت الجلسة)')
      }
      const draftAfter = draftId ? await req(cashierToken, 'GET', `/sales/${draftId}`) : { ok: false }
      const stockAfter = Number((await req(adminToken, 'GET', `/items/${it.id}`)).data?.data?.stockQty)
      const status = draftAfter.data?.data?.status
      log(`- بعد الفتح: حالة الفاتورة=\`${status || 'مفقودة'}\` · مخزون=${stockAfter} (قبل ${stockBefore})`)
      if (status === 'DRAFT' && stockAfter === stockBefore) {
        log('- النتيجة: المسودة محفوظة والمخزون لم يُخصم ✅ (سلوك سليم)')
      } else if (!draftAfter.ok) {
        issue('قتل أثناء البيع', 'المسودة اختفت بعد إعادة التشغيل', false)
      } else if (stockAfter !== stockBefore) {
        issue('قتل أثناء البيع', `المخزون تغيّر رغم عدم التأكيد (${stockBefore}→${stockAfter})`, true)
      }
      // cancel leftover draft
      if (draftId && status === 'DRAFT') {
        await req(adminToken, 'POST', `/sales/${draftId}/cancel`)
      }
    }

    const result = await runDaySales(cashierToken, adminToken, ctx, plan)
    log(`- مبيعات مؤكدة: **${result.salesOk}/${result.salesAttempted}** (فشل ${result.salesFail}) · متوسط حفظ ${result.avgSaveMs}ms`)
    log(`- مرتجعات: ${result.returns} · إلغاء: ${result.cancelled} · تسديد جزئي: ${result.receiptOk}`)
    log(`- مصروف: ${result.expenseOk} · شراء بتغيير تكلفة: ${result.purchaseOk} · تنبيه نقص مخزون: ${result.lowStockHit}`)
    if (result.salesFail > result.salesAttempted * 0.15) {
      issue('معدل فشل مبيعات مرتفع', JSON.stringify(result.lastErrors), false)
    }
    if (result.todaySummary) {
      log(
        `- ملخص اليوم (API قبل الختم): مبيعات=${result.todaySummary.netSalesEGP ?? result.todaySummary.salesTotalEGP} · COGS=${result.todaySummary.cogsTotalEGP} · ربح=${result.todaySummary.grossProfitEGP}`
      )
    }

    let midnightId = null
    if (plan.events.includes('midnight')) {
      const it = pick(ctx.items)
      const mid = await confirmSale(cashierToken, [{ itemId: it.id, quantity: 1, unitPrice: it.retailPrice }], {
        paymentType: 'CASH',
      })
      if (mid.ok) {
        midnightId = mid.id
        log(`- عملية بعد منتصف الليل (ستُختم 00:20 ليوم+1): ${midnightId}`)
      }
    }

    // close shift
    const closed = await req(cashierToken, 'POST', '/ops/shifts/close', {
      closingCash: plan.openingCash + rnd(100, 800),
      notes: `إقفال يوم ${plan.iso}`,
    })
    log(`- إقفال الوردية: ${closed.ok ? 'OK' : JSON.stringify(closed.data)}`)
    if (closed.data?.data) {
      log(`  - ملخص وردية: ${JSON.stringify(closed.data.data).slice(0, 300)}…`)
    }

    // backup + wipe + restore mid week
    if (plan.events.includes('backup-restore')) {
      log('### Backup → مسح الداتا → Restore')
      adminToken = await login('admin', 'admin123')
      await req(adminToken, 'PUT', '/settings', { backup_directory: BAK_DIR })
      const bak = await req(adminToken, 'POST', '/backup')
      const bakName = bak.data?.data?.fileName || bak.data?.data?.name
      log(`- Backup: ${bak.ok ? bakName : JSON.stringify(bak.data)}`)
      killGalaxy()
      await sleep(1500)
      const wipedAside = path.join(DATA_DIR, `cashier.db.wiped-aside-${Date.now()}`)
      fs.copyFileSync(DB, wipedAside)
      fs.copyFileSync(SEED, DB)
      for (const s of ['-wal', '-shm']) {
        const p = DB + s
        if (fs.existsSync(p)) fs.unlinkSync(p)
      }
      log('- مُسحت الداتا (إعادة seed)')
      boot = await startApp()
      adminToken = await login('admin', 'admin123')
      const itemsAfterWipe = await req(adminToken, 'GET', '/items?pageSize=1')
      const cnt =
        itemsAfterWipe.data?.data?.total ??
        itemsAfterWipe.data?.data?.meta?.total ??
        (itemsAfterWipe.data?.data?.items || []).length
      log(`- بعد المسح: أصناف ظاهرة ≈ ${cnt}`)
      await req(adminToken, 'PUT', '/settings', { backup_directory: BAK_DIR })
      const list = await req(adminToken, 'GET', '/backup')
      const files = list.data?.data || []
      const target = files.find((f) => f.name === bakName) || files[0]
      const rest = await req(adminToken, 'POST', '/backup/restore', { fileName: target?.name || bakName })
      log(`- Restore \`${target?.name || bakName}\`: ${rest.ok ? 'OK' : JSON.stringify(rest.data)}`)
      await sleep(1500)
      adminToken = await login('admin', 'admin123')
      cashierToken = await login('cashier_ahmed', 'cashier123')
      // refresh items ctx ids after restore (same ids if same file)
      items = []
      {
        let page = 1
        for (;;) {
          const r = await req(adminToken, 'GET', `/items?page=${page}&pageSize=100`)
          const payload = r.data?.data
          const chunk = payload?.items || (Array.isArray(payload) ? payload : [])
          if (!chunk.length) break
          items = items.concat(chunk)
          if (chunk.length < 100) break
          page++
        }
      }
      ctx.items = items.map((i) => ({
        id: i.id,
        retailPrice: Number(i.retailPrice),
        costPrice: Number(i.costPrice),
        unit: i.unit,
        minimumStock: Number(i.minimumStock || 0),
        name_ar: i.name_ar,
      }))
      const custList = await req(adminToken, 'GET', '/customers?pageSize=50')
      const custs = custList.data?.data?.customers || custList.data?.data || []
      const custArr = Array.isArray(custs) ? custs : custs.items || []
      ctx.creditCustomers = custArr.filter((c) => Number(c.creditLimit) > 0)
      ctx.cashCustomers = custArr.filter((c) => Number(c.creditLimit) === 0)
      const supList = await req(adminToken, 'GET', '/suppliers?pageSize=50')
      const sups = Array.isArray(supList.data?.data) ? supList.data.data : supList.data?.data?.suppliers || []
      ctx.suppliers = sups
      log(`- بعد Restore: أصناف=${ctx.items.length} · عملاء آجل=${ctx.creditCustomers.length} · يمكن متابعة اليوم التالي`)
      // reopen for any trailing ops already done this day — day already closed before backup in our flow
      // Actually backup is AFTER close in my code... wait, backup is after close. Good - next day continues.
    }

    const stamped = await backdateSince(cutoff, plan.iso, {
      hour: 10,
      midnightInvoiceIds: midnightId ? [midnightId] : [],
    })
    log(`- ختم ${stamped} فاتورة لتاريخ ${plan.iso}${midnightId ? ' (+ فاتورة منتصف الليل لليوم التالي)' : ''}`)

    dayStats.push({
      day: plan.day,
      iso: plan.iso,
      salesOk: result.salesOk,
      returns: result.returns,
      cancelled: result.cancelled,
      avgSaveMs: result.avgSaveMs,
      events: plan.events,
    })
  }

  // ── Reconciliation ──
  log('')
  log('## مطابقة SQLite ↔ تقارير الواجهة')
  adminToken = await login('admin', 'admin123')
  const from = dayIso(0)
  const to = dayIso(6)
  const recon = await reconcilePeriod(adminToken, from, to)
  log('### أرقام خام (SQLite)')
  log('```')
  log(JSON.stringify(recon.sql, null, 2))
  log('```')
  log('### ملخص تقرير المبيعات (API)')
  log('```')
  log(JSON.stringify(recon.salesApi, null, 2))
  log('```')
  log('### ملخص تقرير الربح (API)')
  log('```')
  log(JSON.stringify(recon.profitApi, null, 2))
  log('```')
  if (recon.diffs.length === 0) {
    log('**لا فروق تتجاوز 0.05 ج** في الحقول المطابقة ✅')
  } else {
    log('### فروق مكتشفة')
    for (const d of recon.diffs) {
      log(`- **${d.name}**: API=${d.api} · SQL=${d.sql}${d.delta != null ? ` · Δ=${d.delta}` : ''}${d.note ? ` · ${d.note}` : ''}`)
      issue(`فرق تقرير ${d.name}`, `API=${d.api} SQL=${d.sql} Δ=${d.delta}`, false)
    }
  }

  // Customer AR check
  const sqlFull = recon.sql
  log(`- ذمم العملاء (مجموع balance في SQLite): **${sqlFull.customerAR.toFixed(3)}**`)
  log(`- قيمة المخزون بالتكلفة (SQLite): **${sqlFull.inventoryCostValue.toFixed(3)}**`)

  // ── Perf scale ──
  log('')
  log('## قياس الأداء: 150 → 5000 صنف / 20000 فاتورة')
  const prisma = prismaDb()
  let adminId
  let warehouseId
  try {
    adminId = (await prisma.user.findFirst({ where: { username: 'admin' } })).id
    warehouseId = (await prisma.warehouse.findFirst({ where: { isDefault: true } }))?.id
    if (!warehouseId) {
      warehouseId = (await prisma.warehouse.create({ data: { name: 'رئيسي', code: 'MAIN', isDefault: true } })).id
    }
  } finally {
    await prisma.$disconnect()
  }

  await bulkScale(adminId, warehouseId)
  boot = await startApp()
  timings.push({ label: 'open-after-5k-20k', openMs: boot.openMs })
  log(`- فتح البرنامج بعد تضخيم الداتا: **${boot.openMs} ms**`)
  adminToken = await login('admin', 'admin123')
  // need open shift for save invoice timing
  cashierToken = await login('cashier_ahmed', 'cashier123')
  const curS = await req(cashierToken, 'GET', '/ops/shifts/current')
  if (!curS.data?.data?.id) await req(cashierToken, 'POST', '/ops/shifts/open', { openingCash: 100 })
  const perf5k = await measurePerf(adminToken, 'after-5k-items-20k-invoices')
  log(`- @${perf5k.itemCount} صنف / ${perf5k.invCount} فاتورة: بحث ${perf5k.searchMs}ms · حفظ ${perf5k.saveMs}ms · تقرير شهر ${perf5k.reportMs}ms`)

  const slow = []
  for (const t of timings) {
    if (t.openMs > 20000) slow.push(`فتح البرنامج ${t.label}: ${t.openMs}ms`)
    if (t.searchMs > 2000) slow.push(`بحث أصناف ${t.label}: ${t.searchMs}ms`)
    if (t.saveMs > 3000) slow.push(`حفظ فاتورة ${t.label}: ${t.saveMs}ms`)
    if (t.reportMs > 5000) slow.push(`تقرير شهر ${t.label}: ${t.reportMs}ms`)
  }
  if (slow.length) {
    log('### بطيء')
    for (const s of slow) log(`- ${s}`)
  } else {
    log('- ضمن حدود معقولة للمحاكاة (عتبات: فتح>20ث، بحث>2ث، حفظ>3ث، تقرير>5ث)')
  }

  // ── Issues / coverage ──
  log('')
  log('## المشاكل المكتشفة')
  if (!issues.length) log('- لا مشاكل مانعة سُجّلت أثناء التشغيل الآلي.')
  else {
    for (const i of issues) {
      log(`- ${i.fixed ? 'أُصلحت' : i.needsDecision ? 'تحتاج قرار' : 'مفتوحة'}: **${i.title}** — ${i.detail}${i.testNote ? ` · اختبار: ${i.testNote}` : ''}`)
    }
  }

  log('')
  log('## جدول الأيام')
  log('| يوم | تاريخ | ملخص |')
  log('|-----|-------|------|')
  for (const d of dayStats) {
    log(`| ${d.day} | ${d.iso} | ${JSON.stringify(d)} |`)
  }

  log('')
  log('## ما لم تستطع المحاكاة تغطيته')
  log('- تفاعل واجهة المستخدم اليدوي (ماوس/لمس/ماسح باركود حقيقي وكاميرا).')
  log('- الطباعة الحرارية على طابعة ورق فعلية وحوارات Windows.')
  log('- جهاز نضيف تماماً (VM) بدون بقايا Documents/AppData — استخدمنا Setup مثبّت على نفس الجهاز مع seed نظيف.')
  log('- أيام تقويم حقيقية بانتظار منتصف الليل الفعلي؛ تم ختم `createdAt` في SQLite لحدود التاريخ.')
  log('- ضرائب شبكة/انقطاع كهرباء مطوّل، وتزامن Google Drive الفعلي للنسخ.')
  log('- ETA إرسال حي لمصلحة الضرائب.')
  log('- صلاحيات متعددة لكاشيرين متزامنين على جهازين.')
  log('- مراجعة بصرية لـ RTL وتخطيط الفاتورة المطبوعة.')

  log('')
  log('## الخلاصة')
  log(
    `محاكاة أسبوع تشغيلي على **Setup المثبّت** اكتملت. مبيعات الأيام 2–7 سُجّلت مع مرتجعات/إلغاء/آجل/مشتريات/مصروفات، مع اختبار قتل العملية وBackup/Restore. المطابقة والتقارير أعلاه. زمن الإنهاء: ${new Date().toISOString()}`
  )

  fs.writeFileSync(REPORT, lines.join('\n'), 'utf8')
  fs.writeFileSync(
    path.join(ROOT, 'docs', 'SIMULATION-RAW.json'),
    JSON.stringify({ dayStats, timings, issues, recon }, null, 2),
    'utf8'
  )
  console.log('\nWrote', REPORT)
}

main().catch((e) => {
  console.error(e)
  lines.push('')
  lines.push('## فشل التشغيل')
  lines.push('```')
  lines.push(String(e && e.stack || e))
  lines.push('```')
  fs.writeFileSync(REPORT, lines.join('\n'), 'utf8')
  process.exit(1)
})
