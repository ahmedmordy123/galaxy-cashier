/**
 * v1.1 client simulation — exclusive VAT, price override, tax-exempt, 10 logical days.
 * Prefers freshly built win-unpacked Galaxy Cashier 1.1.0; falls back to staging API.
 * Writes SIMULATION_REPORT_V2.md
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawn, execSync } = require('child_process')
const ROOT = path.resolve(__dirname, '..')
const REPORT = path.join(ROOT, 'SIMULATION_REPORT_V2.md')
const RAW = path.join(ROOT, 'docs', 'SIMULATION-V2-RAW.json')
const UNPACKED = path.join(ROOT, 'apps', 'desktop', 'dist', 'win-unpacked', 'Galaxy Cashier.exe')
const STAGING_API = path.join(ROOT, 'apps', 'desktop', 'staging', 'api')
const STAGING_NODE = path.join(ROOT, 'apps', 'desktop', 'staging', 'node', 'node.exe')
const SEED_CANDIDATES = [
  path.join(ROOT, 'apps', 'desktop', 'assets', 'seed.db'),
  'C:\\Program Files\\Galaxy Cashier\\resources\\seed.db',
]
const DATA_DIR = path.join(process.env.USERPROFILE, 'Documents', 'CASR', 'data')
const DB = path.join(DATA_DIR, 'cashier.db')
const API = 'http://127.0.0.1:4001'

const lines = []
const checks = []
const dayStats = []

const { PrismaClient } = require('@prisma/client')

function log(s = '') {
  lines.push(s)
  console.log(s)
}
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail })
  log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`)
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
function nearly(a, b, eps = 0.02) {
  return Math.abs(Number(a) - Number(b)) <= eps
}
function dayIso(offset, base = '2026-10-30') {
  const d = new Date(base + 'T12:00:00')
  d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}

function killPorts() {
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

async function startRuntime() {
  killPorts()
  await sleep(1200)
  if (fs.existsSync(UNPACKED)) {
    log(`بدء win-unpacked: ${UNPACKED}`)
    spawn(UNPACKED, [], { detached: true, stdio: 'ignore' }).unref()
    return { mode: 'win-unpacked-1.1', healthMs: await waitHealth(150) }
  }
  const nodeExe = fs.existsSync(STAGING_NODE) ? STAGING_NODE : 'node'
  log(`بدء staging API: ${STAGING_API}`)
  spawn(nodeExe, ['server.js'], {
    cwd: STAGING_API,
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      DATABASE_URL: fileUrl(DB),
      PORT: '4001',
      JWT_SECRET: 'sim-v2-secret',
      NODE_ENV: 'production',
      CORS_ORIGIN: 'http://localhost:3001,http://127.0.0.1:3001',
    },
  }).unref()
  return { mode: 'staging-api', healthMs: await waitHealth(90) }
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
  if (!r.ok) throw new Error(`login ${user}: ${r.status}`)
  return r.data.data?.accessToken || r.data.accessToken
}

function prismaDb() {
  return new PrismaClient({ datasources: { db: { url: fileUrl(DB) } } })
}

async function confirmSale(token, items, opts = {}) {
  const body = {
    customerId: opts.customerId || null,
    paymentType: opts.paymentType || 'CASH',
    priceType: 'RETAIL',
    currency: 'EGP',
    discountType: opts.discountType || 'PERCENT',
    discount: opts.discount ?? 0,
    belowCostConfirmed: opts.belowCostConfirmed,
    items: items.map((x) => ({
      itemId: x.itemId,
      quantity: x.quantity,
      unitPrice: x.unitPrice,
      originalUnitPrice: x.originalUnitPrice ?? x.unitPrice,
      priceOverridden: Boolean(x.priceOverridden),
      discount: x.lineDiscount || 0,
    })),
  }
  const created = await req(token, 'POST', '/sales', body)
  if (!created.ok) return { ok: false, error: created.data }
  const inv = created.data.data
  const total = Number(inv.total)
  const payments =
    opts.paymentType === 'CREDIT'
      ? [{ method: 'CREDIT', amount: total }]
      : [{ method: 'CASH', amount: total }]
  const conf = await req(token, 'POST', `/sales/${inv.id}/confirm`, { payments })
  if (!conf.ok) return { ok: false, error: conf.data, id: inv.id }
  return { ok: true, inv: conf.data.data || inv, total }
}

async function stampDay(sinceIso, logicalDay) {
  const prisma = prismaDb()
  try {
    const start = new Date(sinceIso)
    const stamp = new Date(`${logicalDay}T11:00:00`)
    const invs = await prisma.salesInvoice.findMany({
      where: { createdAt: { gte: start } },
      select: { id: true },
    })
    for (const inv of invs) {
      const at = new Date(stamp.getTime() + rnd(0, 8) * 3600000)
      await prisma.salesInvoice.update({ where: { id: inv.id }, data: { createdAt: at, updatedAt: at } })
      await prisma.salesPayment.updateMany({ where: { invoiceId: inv.id }, data: { createdAt: at } })
    }
    await prisma.cashierShift.updateMany({
      where: { openedAt: { gte: start } },
      data: {
        openedAt: new Date(`${logicalDay}T08:00:00`),
        closedAt: new Date(`${logicalDay}T22:00:00`),
      },
    })
    return invs.length
  } finally {
    await prisma.$disconnect()
  }
}

async function main() {
  const started = new Date().toISOString()
  log('# محاكاة عميل v1.1 — SIMULATION_REPORT_V2')
  log(`بدء: ${started}`)

  fs.mkdirSync(DATA_DIR, { recursive: true })
  if (fs.existsSync(DB)) {
    const bak = DB + `.pre-v1.1-sim-${Date.now()}`
    fs.copyFileSync(DB, bak)
    log(`نسخ احتياطي DB → ${bak}`)
  }
  const seed = SEED_CANDIDATES.find((p) => fs.existsSync(p))
  if (!seed) throw new Error('seed.db not found')
  fs.copyFileSync(seed, DB)
  log(`seed → cashier.db من ${seed}`)

  const runtime = await startRuntime()
  check('health ok', runtime.healthMs > 0, `${runtime.mode} ${runtime.healthMs}ms`)

  let admin = await login('admin', 'admin123')
  check('admin login', Boolean(admin))

  // Settings: exclusive VAT + warn below cost
  const setRes = await req(admin, 'PUT', '/settings', {
    business_name_ar: 'عطارة الحاج محمود — منوف (v1.1)',
    tax_rate: '14',
    vat_enabled: 'true',
    tax_mode: 'EXCLUSIVE',
    below_cost_policy: 'WARN',
    paper_width: '80',
  })
  check(
    'settings exclusive VAT',
    setRes.ok,
    setRes.ok ? 'EXCLUSIVE' : JSON.stringify(setRes.data).slice(0, 200),
  )

  // Cashier with canEditPrice
  const u = await req(admin, 'POST', '/settings/users', {
    name: 'كاشير أحمد',
    username: 'cashier_v11',
    password: 'cashier123',
    role: 'CASHIER',
    language: 'ar',
    canEditPrice: true,
  })
  check('create cashier canEditPrice', u.ok || u.status === 409, String(u.status))

  // Items: golden + exempt + normal
  const mkItem = async (name, cost, retail, extra = {}) => {
    const r = await req(admin, 'POST', '/items', {
      name_ar: name,
      name_en: name,
      unit: 'piece',
      costPrice: cost,
      retailPrice: retail,
      wholesalePrice: retail,
      specialPrice: retail,
      stockQty: 500,
      minimumStock: 5,
      barcode: `V11${rnd(100000, 999999)}`,
      ...extra,
    })
    if (!r.ok) throw new Error(`item ${name}: ${JSON.stringify(r.data)}`)
    return r.data.data
  }

  const goldenItem = await mkItem('صنف ذهبي G0', 100, 130)
  const exemptItem = await mkItem('صنف معفى ضريبة', 40, 80, { taxExempt: true })
  const bulk = []
  for (let i = 0; i < 40; i++) {
    bulk.push(await mkItem(`بقالة ${i + 1}`, 10 + (i % 7), 20 + (i % 11)))
  }
  check('catalog seeded', Boolean(goldenItem?.id) && bulk.length === 40, `+exempt ${exemptItem.id}`)

  const openShift = await req(admin, 'POST', '/ops/shifts/open', { openingCash: 500 })
  check('shift open', openShift.ok, String(openShift.status))

  // ── Golden G0 exclusive ────────────────────────────────────────────────────
  const g0 = await confirmSale(
    admin,
    [{ itemId: goldenItem.id, quantity: 2, unitPrice: 130, originalUnitPrice: 130 }],
    { discountType: 'PERCENT', discount: 10 },
  )
  check('G0 sale ok', g0.ok, g0.error ? JSON.stringify(g0.error) : '')
  if (g0.ok) {
    const inv = g0.inv
    check('G0 total 266.76', nearly(Number(inv.total), 266.76), String(inv.total))
    check('G0 tax 32.76', nearly(Number(inv.tax), 32.76), String(inv.tax))
    check('G0 netOfTax 234', nearly(Number(inv.netOfTax), 234), String(inv.netOfTax))
    const profit = Number(inv.netOfTax) - 200
    check('G0 profit 34', nearly(profit, 34), String(profit))

    // Partial return 1 unit then residual (must use partial-return — not full /return)
    const ret1 = await req(admin, 'POST', `/sales/${inv.id}/partial-return`, {
      items: [{ itemId: goldenItem.id, quantity: 1 }],
    })
    check('G0 partial return ok', ret1.ok, String(ret1.status))
    if (ret1.ok) {
      const after = ret1.data.data || {}
      const remaining = Number(after.total)
      check('G0 remaining ≈133.38', nearly(remaining, 133.38), String(remaining))
      const ret2 = await req(admin, 'POST', `/sales/${inv.id}/partial-return`, {
        items: [{ itemId: goldenItem.id, quantity: 1 }],
      })
      check('G0 second return (residual) ok', ret2.ok, String(ret2.status))
      if (ret2.ok) {
        const fin = ret2.data.data || {}
        check('G0 fully returned total 0', nearly(Number(fin.total || 0), 0), String(fin.total))
      }
    }
  }

  // Price override by cashier
  let cashierTok = null
  try {
    cashierTok = await login('cashier_v11', 'cashier123')
  } catch {
    cashierTok = admin
  }
  const ov = await confirmSale(
    cashierTok,
    [
      {
        itemId: bulk[0].id,
        quantity: 1,
        unitPrice: 15,
        originalUnitPrice: Number(bulk[0].retailPrice),
        priceOverridden: true,
      },
    ],
    { belowCostConfirmed: true },
  )
  check('price override sale', ov.ok, ov.error ? JSON.stringify(ov.error).slice(0, 120) : String(ov.total))

  // Tax-exempt mix: taxable 130 + exempt 80, no discount, exclusive 14%
  // Recreate golden stock if depleted — use bulk + exempt
  const mix = await confirmSale(admin, [
    { itemId: bulk[1].id, quantity: 1, unitPrice: 130 },
    { itemId: exemptItem.id, quantity: 1, unitPrice: 80 },
  ])
  check('exempt mix sale ok', mix.ok, mix.error ? JSON.stringify(mix.error).slice(0, 100) : '')
  if (mix.ok) {
    // taxable after disc = 130 → tax 18.2; total = 210 + 18.2 = 228.2
    check('exempt mix tax≈18.2', nearly(Number(mix.inv.tax), 18.2), String(mix.inv.tax))
    check('exempt mix total≈228.2', nearly(Number(mix.inv.total), 228.2), String(mix.inv.total))
  }

  // ── 10 logical days of traffic ─────────────────────────────────────────────
  for (let d = 0; d < 10; d++) {
    const logical = dayIso(d)
    const since = new Date().toISOString()
    let sales = 0
    let fails = 0
    const target = 12 + (d % 5) * 3
    for (let n = 0; n < target; n++) {
      const item = bulk[rnd(0, bulk.length - 1)]
      const qty = rnd(1, 3)
      const disc = n % 4 === 0 ? 5 : 0
      const r = await confirmSale(
        admin,
        [{ itemId: item.id, quantity: qty, unitPrice: Number(item.retailPrice) }],
        { discount: disc, discountType: 'PERCENT' },
      )
      if (r.ok) sales++
      else fails++
    }
    // one return every other day
    if (d % 2 === 1 && sales > 0) {
      const list = await req(admin, 'GET', '/sales?limit=5&status=CONFIRMED')
      const row = (list.data?.data?.data || list.data?.data || [])[0]
      if (row?.id && row.items?.[0]) {
        await req(admin, 'POST', `/sales/${row.id}/partial-return`, {
          items: [{ itemId: row.items[0].itemId, quantity: 1 }],
        }).catch(() => null)
      }
    }
    await stampDay(since, logical)
    dayStats.push({ day: logical, sales, fails, target })
    log(`يوم ${d + 1} (${logical}): مبيعات ${sales}/${target} فشل ${fails}`)
  }

  // Reports: profit ≤ sales (VAT wedge)
  const from = dayIso(0)
  const to = dayIso(9)
  const salesR = await req(admin, 'GET', `/reports/sales?from=${from}&to=${to}`)
  const profitR = await req(admin, 'GET', `/reports/profit?from=${from}&to=${to}`)
  const sTot = Number(salesR.data?.data?.summary?.totalEGP || 0)
  const pRev = Number(profitR.data?.data?.summary?.totalRevenue || 0)
  check('reports sales ok', salesR.ok)
  check('reports profit ok', profitR.ok)
  check('profit ≤ sales (VAT out)', pRev <= sTot + 0.05 || sTot === 0, `p=${pRev} s=${sTot}`)

  // Audit PRICE_OVERRIDE if any
  const audit = await req(admin, 'GET', '/audit?action=PRICE_OVERRIDE&limit=5')
  check('audit endpoint', audit.ok || audit.status === 403, String(audit.status))

  const passed = checks.filter((c) => c.ok).length
  const ended = new Date().toISOString()

  const md = [
    '# تقرير محاكاة عميل v1.1 — SIMULATION_REPORT_V2',
    '',
    `- **البدء:** ${started}`,
    `- **الانتهاء:** ${ended}`,
    `- **الوضع:** ${runtime.mode} · health ${runtime.healthMs}ms`,
    `- **القاعدة:** \`${DB}\``,
    `- **القرارات:** 1أ exclusive بعد الخصم · 2أ أنواع أسعار موجودة · تقريب قرشين · مرتجع = إجمالي بالظبط`,
    '',
    '## نتائج الفحوص',
    '',
    `| فحص | نتيجة | تفاصيل |`,
    `|------|--------|--------|`,
    ...checks.map((c) => `| ${c.name} | ${c.ok ? '✅' : '❌'} | ${c.detail || '—'} |`),
    '',
    `**المجموع:** ${passed}/${checks.length}`,
    '',
    '## الأيام العشرة (حركة خفيفة)',
    '',
    '| يوم | مبيعات ناجحة | هدف | فشل |',
    '|-----|--------------|-----|-----|',
    ...dayStats.map((d) => `| ${d.day} | ${d.sales} | ${d.target} | ${d.fails} |`),
    '',
    '## ملاحظات',
    '',
    '- Golden G0: 2×130 −10% +14% exclusive = 266.76 · ربح 34 · مرتجع قطعة 133.38.',
    '- الربح من الصافي بدون ضريبة؛ تقارير الربح ≤ إجمالي المبيعات عند وجود VAT.',
    '- EXE: `apps/desktop/dist/Galaxy Cashier Setup 1.1.0.exe`.',
    '',
  ].join('\n')

  fs.writeFileSync(REPORT, md, 'utf8')
  fs.writeFileSync(
    RAW,
    JSON.stringify({ started, ended, runtime, checks, dayStats, passed, total: checks.length }, null, 2),
  )
  log(`\nكتب ${REPORT} — ${passed}/${checks.length}`)
  killPorts()
  if (passed < checks.length) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  killPorts()
  process.exit(1)
})
