/**
 * Live feature inventory + stress against a running Galaxy Cashier instance.
 * Does NOT spawn/kill API. Safe-ish writes use TEST-LIVE-* tags.
 *
 *   node scripts/live-full-stress-test.cjs
 *   LIVE_API=http://127.0.0.1:4001 LIVE_USER=admin LIVE_PASS=admin123 node scripts/live-full-stress-test.cjs
 */
'use strict'

const BASE = process.env.LIVE_API || 'http://127.0.0.1:4001'
const WEB = process.env.LIVE_WEB || 'http://127.0.0.1:3001'
const USER = process.env.LIVE_USER || 'admin'
const PASS = process.env.LIVE_PASS || 'admin123'
const STRESS_N = Number(process.env.STRESS_N || 40)
const STRESS_CONCURRENCY = Number(process.env.STRESS_CONCURRENCY || 8)
const TAG = `TEST-LIVE-${Date.now().toString(36).toUpperCase()}`

const results = []
const featureMap = []

function push(group, name, ok, detail, ms) {
  results.push({ group, name, ok, detail: String(detail ?? '').slice(0, 200), ms })
  const icon = ok ? 'OK' : 'FAIL'
  console.log(`  [${icon}] ${group}/${name} ${ms != null ? `(${ms}ms)` : ''} ${detail ? '— ' + String(detail).slice(0, 120) : ''}`)
}

async function req(method, path, { token, body, headers } = {}) {
  const t0 = Date.now()
  const h = { ...(headers || {}) }
  if (token) h.Authorization = `Bearer ${token}`
  if (body !== undefined) h['Content-Type'] = 'application/json'
  let res
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: h,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (e) {
    return { ok: false, status: 0, json: null, text: e.message, ms: Date.now() - t0 }
  }
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* */ }
  return { ok: res.ok, status: res.status, json, text, ms: Date.now() - t0 }
}

async function get(path, token) {
  return req('GET', path, { token })
}

async function post(path, body, token) {
  return req('POST', path, { token, body })
}

function feat(module, endpoint, status, note) {
  featureMap.push({ module, endpoint, status, note })
}

async function probe(module, name, path, token, opts = {}) {
  const r = await get(path, token)
  const accept = opts.accept || [200]
  const ok = accept.includes(r.status) || (opts.okIf && opts.okIf(r))
  push('feature', `${module}:${name}`, ok, `HTTP ${r.status}`, r.ms)
  feat(module, name, ok ? 'PASS' : `HTTP ${r.status}`, path)
  return r
}

async function mapPool(items, concurrency, worker) {
  const out = new Array(items.length)
  let i = 0
  async function run() {
    while (i < items.length) {
      const idx = i++
      out[idx] = await worker(items[idx], idx)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()))
  return out
}

async function main() {
  console.log('\n══════════════════════════════════════════════')
  console.log(' Galaxy Cashier — Live Full + Stress Test')
  console.log(` API: ${BASE}`)
  console.log(` WEB: ${WEB}`)
  console.log(` TAG: ${TAG}`)
  console.log('══════════════════════════════════════════════\n')

  // ── Health / Web ─────────────────────────────────────────
  console.log('▸ Health & Web')
  {
    const h = await get('/api/health')
    push('infra', 'api/health', h.status === 200, `HTTP ${h.status}`, h.ms)
    try {
      const t0 = Date.now()
      const w = await fetch(WEB + '/')
      push('infra', 'web/', w.ok, `HTTP ${w.status}`, Date.now() - t0)
    } catch (e) {
      push('infra', 'web/', false, e.message)
    }
  }

  // ── Auth ─────────────────────────────────────────────────
  console.log('\n▸ Auth')
  let token = null
  let user = null
  {
    const login = await post('/api/auth/login', { username: USER, password: PASS }, null)
    const ok = login.status === 200 && login.json?.success && login.json?.data?.accessToken
    push('auth', 'login', ok, ok ? `role=${login.json.data.user.role}` : `HTTP ${login.status} ${login.text}`, login.ms)
    if (!ok) {
      console.error('\nCannot continue without login.')
      process.exit(1)
    }
    token = login.json.data.accessToken
    user = login.json.data.user

    const me = await get('/api/auth/me', token)
    push('auth', 'me', me.status === 200 && me.json?.data?.user?.username === USER, `HTTP ${me.status}`, me.ms)

    const bad = await post('/api/auth/login', { username: USER, password: 'wrong-password-xyz' }, null)
    push('auth', 'login-reject-bad-password', bad.status === 401, `HTTP ${bad.status}`, bad.ms)
  }

  // ── Feature probes (GET inventory) ───────────────────────
  console.log('\n▸ Feature probes (read)')
  const today = new Date().toISOString().slice(0, 10)
  const from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)

  await probe('items', 'list', '/api/items?page=1&limit=20', token)
  await probe('items', 'categories', '/api/items/categories', token)
  const itemsList = await get('/api/items?page=1&limit=5', token)
  const firstItem = itemsList.json?.data?.items?.[0] || itemsList.json?.data?.[0] || null
  if (firstItem?.id) await probe('items', 'get-by-id', `/api/items/${firstItem.id}`, token)
  if (firstItem?.barcode) await probe('items', 'barcode', `/api/items/barcode/${encodeURIComponent(firstItem.barcode)}`, token)

  await probe('customers', 'list', '/api/customers?page=1&limit=20', token)
  const custList = await get('/api/customers?page=1&limit=5', token)
  const firstCust = custList.json?.data?.customers?.[0] || custList.json?.data?.[0] || null
  if (firstCust?.id) {
    await probe('customers', 'get', `/api/customers/${firstCust.id}`, token)
    await probe('customers', 'statement', `/api/customers/${firstCust.id}/statement?from=${from}&to=${today}`, token)
  }

  await probe('suppliers', 'list', '/api/suppliers?page=1&limit=20', token)
  const supList = await get('/api/suppliers?page=1&limit=5', token)
  const firstSup = supList.json?.data?.suppliers?.[0] || supList.json?.data?.[0] || null
  if (firstSup?.id) {
    await probe('suppliers', 'get', `/api/suppliers/${firstSup.id}`, token)
    await probe('suppliers', 'statement', `/api/suppliers/${firstSup.id}/statement?from=${from}&to=${today}`, token)
  }

  await probe('sales', 'list', '/api/sales?page=1&limit=20', token)
  await probe('sales', 'parked', '/api/sales/parked/list', token)
  const salesList = await get('/api/sales?page=1&limit=5', token)
  const firstSale = salesList.json?.data?.invoices?.[0] || salesList.json?.data?.[0] || null
  if (firstSale?.id) await probe('sales', 'get', `/api/sales/${firstSale.id}`, token)

  await probe('purchases', 'list', '/api/purchases?page=1&limit=20', token)
  await probe('expenses', 'list', '/api/expenses?page=1&limit=20', token)
  await probe('expense-cats', 'list', '/api/expense-categories', token)
  await probe('vouchers', 'list', '/api/vouchers?page=1&limit=20', token)

  await probe('stock', 'transfers', '/api/stock/transfers?page=1&limit=20', token)
  await probe('stock', 'inventory', '/api/stock/inventory?page=1&limit=20', token)
  await probe('stock', 'low-stock', '/api/stock/low-stock', token)
  await probe('stock', 'expiring', '/api/stock/expiring', token)

  await probe('cash', 'today', '/api/cash-statement/today', token)
  await probe('cash', 'range', `/api/cash-statement/range?from=${from}&to=${today}`, token)

  await probe('settings', 'all', '/api/settings', token)
  await probe('settings', 'fx-history', '/api/settings/exchange-rate/history', token)
  await probe('settings', 'users', '/api/settings/users', token)

  await probe('reports', 'today-summary', '/api/reports/today-summary', token)
  await probe('reports', 'sales', `/api/reports/sales?from=${from}&to=${today}`, token)
  await probe('reports', 'purchases', `/api/reports/purchases?from=${from}&to=${today}`, token)
  await probe('reports', 'profit', `/api/reports/profit?from=${from}&to=${today}`, token)
  await probe('reports', 'inventory', '/api/reports/inventory', token)
  await probe('reports', 'product-movement', `/api/reports/product-movement?from=${from}&to=${today}`, token)
  if (firstCust?.id) await probe('reports', 'customer-statement', `/api/reports/customer-statement/${firstCust.id}?from=${from}&to=${today}`, token)
  if (firstSup?.id) await probe('reports', 'supplier-statement', `/api/reports/supplier-statement/${firstSup.id}?from=${from}&to=${today}`, token)

  await probe('quotes', 'list', '/api/quotes?page=1&limit=20', token)
  await probe('backup', 'list', '/api/backup', token)
  await probe('backup', 'auto-status', '/api/backup/auto-status', token)
  await probe('audit', 'list', '/api/audit?page=1&limit=20', token)
  await probe('eta', 'status', '/api/eta/status', token)
  await probe('eta', 'documents', '/api/eta/documents', token)

  await probe('ops', 'warehouses', '/api/ops/warehouses', token)
  await probe('ops', 'stock-counts', '/api/ops/stock-counts', token)
  await probe('ops', 'shifts', '/api/ops/shifts', token)
  await probe('ops', 'shifts-current', '/api/ops/shifts/current', token)
  await probe('ops', 'shifts-summary', '/api/ops/shifts/current/summary', token)
  await probe('ops', 'sales-analysis', `/api/ops/sales-analysis?from=${from}&to=${today}`, token)
  await probe('ops', 'serials', '/api/ops/serials', token)
  if (firstItem?.id) await probe('ops', 'item-ledger', `/api/ops/item-ledger/${firstItem.id}`, token)

  // ── Write flow (tagged, reversible-ish) ──────────────────
  console.log('\n▸ Write flow (tagged TEST data)')
  let createdItemId = null
  let createdCustId = null
  let createdSaleId = null
  let createdQuoteId = null
  let shiftOpened = false

  {
    const openShift = await post('/api/ops/shifts/open', { openingCash: 0, notes: TAG }, token)
    // 200/201 created, or already open
    const shiftOk = openShift.status === 200 || openShift.status === 201 || openShift.status === 400 || openShift.status === 409
    push('write', 'shift-open', shiftOk, `HTTP ${openShift.status}`, openShift.ms)
    shiftOpened = openShift.status === 200 || openShift.status === 201
  }

  {
    const barcode = `9${String(Date.now()).slice(-12)}`
    const body = {
      barcode,
      name_ar: `${TAG} صنف`,
      name_en: `${TAG} Item`,
      retailPrice: 10,
      wholesalePrice: 8,
      specialPrice: 7,
      dollarPrice: 1,
      dinarPrice: 10,
      costPrice: 5,
      stockQty: 100,
      minimumStock: 1,
      unit: 'piece',
    }
    const r = await post('/api/items', body, token)
    const ok = r.status === 200 || r.status === 201
    createdItemId = r.json?.data?.id || r.json?.data?.item?.id || null
    push('write', 'create-item', ok && !!createdItemId, ok ? `id=${createdItemId}` : `HTTP ${r.status} ${r.text}`, r.ms)
  }

  {
    const body = {
      name: `${TAG} عميل`,
      phone: `01${String(Date.now()).slice(-9)}`,
      type: 'RETAIL',
      creditLimit: 1000,
    }
    const r = await post('/api/customers', body, token)
    const ok = r.status === 200 || r.status === 201
    createdCustId = r.json?.data?.id || r.json?.data?.customer?.id || null
    push('write', 'create-customer', ok && !!createdCustId, ok ? `id=${createdCustId}` : `HTTP ${r.status} ${r.text}`, r.ms)
  }

  if (createdItemId) {
    const body = {
      paymentType: 'CASH',
      priceType: 'RETAIL',
      currency: 'EGP',
      exchangeRate: 1,
      customerId: createdCustId || undefined,
      items: [{ itemId: createdItemId, quantity: 1, unitPrice: 10 }],
      notes: TAG,
    }
    const r = await post('/api/sales', body, token)
    const ok = r.status === 200 || r.status === 201
    createdSaleId = r.json?.data?.id || r.json?.data?.invoice?.id || null
    push('write', 'create-sale', ok && !!createdSaleId, ok ? `id=${createdSaleId}` : `HTTP ${r.status} ${r.text}`, r.ms)

    if (createdSaleId) {
      const c = await post(`/api/sales/${createdSaleId}/confirm`, {}, token)
      // may already be confirmed on create
      push('write', 'confirm-sale', c.status === 200 || c.status === 201 || c.status === 400, `HTTP ${c.status}`, c.ms)
    }
  } else {
    push('write', 'create-sale', false, 'skipped — no item')
  }

  if (createdItemId) {
    const body = {
      customerId: createdCustId || undefined,
      currency: 'EGP',
      priceType: 'RETAIL',
      items: [{ itemId: createdItemId, quantity: 1, unitPrice: 10 }],
      notes: TAG,
    }
    const r = await post('/api/quotes', body, token)
    const ok = r.status === 200 || r.status === 201
    createdQuoteId = r.json?.data?.id || r.json?.data?.quote?.id || null
    push('write', 'create-quote', ok && !!createdQuoteId, ok ? `id=${createdQuoteId}` : `HTTP ${r.status} ${r.text}`, r.ms)
  }

  {
    const cats = await get('/api/expense-categories', token)
    const catId = cats.json?.data?.[0]?.id || cats.json?.data?.categories?.[0]?.id
    if (catId) {
      const r = await post('/api/expenses', {
        categoryId: catId,
        amount: 1,
        currency: 'EGP',
        date: today,
        description: TAG,
      }, token)
      push('write', 'create-expense', r.status === 200 || r.status === 201, `HTTP ${r.status}`, r.ms)
    } else {
      push('write', 'create-expense', false, 'no expense category')
    }
  }

  // soft cleanup
  if (createdQuoteId) {
    const r = await req('DELETE', `/api/quotes/${createdQuoteId}`, { token })
    push('write', 'delete-quote', r.status === 200 || r.status === 204, `HTTP ${r.status}`, r.ms)
  }
  if (createdItemId) {
    const r = await req('DELETE', `/api/items/${createdItemId}`, { token })
    push('write', 'soft-delete-item', r.status === 200 || r.status === 204 || r.status === 400, `HTTP ${r.status}`, r.ms)
  }
  if (createdCustId) {
    const r = await req('DELETE', `/api/customers/${createdCustId}`, { token })
    push('write', 'soft-delete-customer', r.status === 200 || r.status === 204 || r.status === 400, `HTTP ${r.status}`, r.ms)
  }

  // ── Stress ───────────────────────────────────────────────
  console.log(`\n▸ Stress (${STRESS_N} requests × concurrency ${STRESS_CONCURRENCY})`)
  const stressPaths = [
    '/api/health',
    '/api/auth/me',
    '/api/items?page=1&limit=10',
    '/api/customers?page=1&limit=10',
    '/api/sales?page=1&limit=10',
    '/api/reports/today-summary',
    '/api/stock/inventory?page=1&limit=10',
    '/api/settings',
    '/api/ops/shifts/current',
    '/api/backup/auto-status',
  ]
  const jobs = Array.from({ length: STRESS_N }, (_, i) => ({
    i,
    path: stressPaths[i % stressPaths.length],
  }))
  const tStress = Date.now()
  const stressOut = await mapPool(jobs, STRESS_CONCURRENCY, async (job) => {
    const needAuth = job.path !== '/api/health'
    return get(job.path, needAuth ? token : null)
  })
  const stressMs = Date.now() - tStress
  const okCount = stressOut.filter((r) => r.ok || r.status === 200).length
  const failCount = stressOut.length - okCount
  const latencies = stressOut.map((r) => r.ms).sort((a, b) => a - b)
  const p50 = latencies[Math.floor(latencies.length * 0.5)]
  const p95 = latencies[Math.floor(latencies.length * 0.95)]
  const max = latencies[latencies.length - 1]
  const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
  push(
    'stress',
    `parallel-reads`,
    failCount === 0,
    `ok=${okCount}/${STRESS_N} fail=${failCount} total=${stressMs}ms avg=${avg} p50=${p50} p95=${p95} max=${max}`,
    stressMs,
  )

  // burst login (rate limit aware — few only)
  console.log('\n▸ Auth burst (5 parallel logins)')
  {
    const t0 = Date.now()
    const bursts = await Promise.all(
      Array.from({ length: 5 }, () => post('/api/auth/login', { username: USER, password: PASS })),
    )
    const okB = bursts.filter((r) => r.status === 200).length
    push('stress', 'login-burst-5', okB >= 4, `ok=${okB}/5`, Date.now() - t0)
  }

  // ── Summary ──────────────────────────────────────────────
  const pass = results.filter((r) => r.ok).length
  const fail = results.filter((r) => !r.ok).length
  console.log('\n══════════════════════════════════════════════')
  console.log(` RESULT: ${pass} passed / ${fail} failed / ${results.length} total`)
  console.log(` User: ${user?.username} (${user?.role})`)
  console.log('══════════════════════════════════════════════')

  if (fail) {
    console.log('\nFailures:')
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`  - ${r.group}/${r.name}: ${r.detail}`)
    }
  }

  console.log('\nFeature matrix:')
  const byMod = {}
  for (const f of featureMap) {
    byMod[f.module] = byMod[f.module] || { pass: 0, fail: 0 }
    if (f.status === 'PASS') byMod[f.module].pass++
    else byMod[f.module].fail++
  }
  for (const [m, s] of Object.entries(byMod)) {
    console.log(`  ${m.padEnd(14)} PASS=${s.pass} FAIL=${s.fail}`)
  }

  // machine-readable dump
  const outPath = require('path').join(__dirname, '..', 'docs', 'LIVE-STRESS-REPORT.json')
  require('fs').writeFileSync(
    outPath,
    JSON.stringify({ at: new Date().toISOString(), base: BASE, tag: TAG, pass, fail, results, featureMap, stress: { okCount, failCount, avg, p50, p95, max, stressMs } }, null, 2),
    'utf8',
  )
  console.log(`\nReport: ${outPath}`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
