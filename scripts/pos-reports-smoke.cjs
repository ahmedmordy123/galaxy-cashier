/**
 * Smoke: POS park/resume path + three new reports.
 *   node scripts/pos-reports-smoke.cjs
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawn, execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SOURCE_DB = [
  path.join(ROOT, 'apps', 'desktop', 'assets', 'seed.db'),
  path.join(ROOT, 'data', 'cashier.db'),
].find((p) => fs.existsSync(p))
const TEST_DB = path.join(ROOT, 'data', 'cashier-pos-reports-smoke.db')
const API_PORT = process.env.SMOKE_PORT || '4016'
const API_BASE = process.env.INTEGRATION_API || `http://127.0.0.1:${API_PORT}`
const REPORT = path.join(ROOT, 'docs', 'POS-REPORTS-SMOKE.json')
const TAG = `POSR-${Date.now().toString(36).toUpperCase()}`

const steps = []

function nearly(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.05
}

function step(name, expected, actual, ok) {
  steps.push({ name, expected, actual, ok: !!ok })
  console.log(`  [${ok ? 'OK' : 'FAIL'}] ${name}  expected=${expected}  actual=${actual}`)
  return !!ok
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

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function waitHealth(base) {
  for (let i = 0; i < 200; i++) {
    try {
      const r = await fetch(`${base}/health`)
      if (r.ok) return
    } catch { /* */ }
    await sleep(300)
  }
  throw new Error('API health timeout')
}

let apiProcess = null

function killListenersOnPort(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' })
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes('LISTENING')) continue
      const parts = line.trim().split(/\s+/)
      const pid = parts[parts.length - 1]
      if (pid && /^\d+$/.test(pid)) {
        try { execSync(`taskkill /pid ${pid} /f /t`, { stdio: 'ignore' }) } catch { /* */ }
      }
    }
  } catch { /* */ }
}

function stopApi() {
  if (apiProcess && !apiProcess.killed) {
    try { spawn('taskkill', ['/pid', String(apiProcess.pid), '/f', '/t'], { stdio: 'ignore' }) } catch { apiProcess.kill() }
  }
}

function api(token) {
  return async (method, urlPath, body) => {
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    const r = await fetch(`${API_BASE}/api${urlPath}`, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    })
    let data = {}
    try { data = await r.json() } catch { data = {} }
    return { status: r.status, ok: r.ok, data }
  }
}

async function main() {
  console.log('\n=== POS + reports smoke ===\n')
  if (!SOURCE_DB) {
    console.error('No seed DB')
    process.exit(1)
  }
  fs.mkdirSync(path.dirname(TEST_DB), { recursive: true })
  fs.copyFileSync(SOURCE_DB, TEST_DB)
  const env = loadEnvFile()
  env.DATABASE_URL = fileUrl(TEST_DB)
  env.PORT = API_PORT
  env.JWT_SECRET = env.JWT_SECRET || 'pos-reports-smoke-secret'
  env.JWT_REFRESH_SECRET = env.JWT_REFRESH_SECRET || 'pos-reports-smoke-refresh'
  env.COOKIE_SECURE = 'false'

  if (!process.env.INTEGRATION_API) {
    killListenersOnPort(API_PORT)
    apiProcess = spawn('cmd.exe', ['/c', 'npx tsx src/index.ts'], {
      cwd: path.join(ROOT, 'apps', 'api'),
      env,
      stdio: 'ignore',
    })
    await waitHealth(API_BASE)
  }

  const login = await api(null)('POST', '/auth/login', { username: 'admin', password: 'admin123' })
  const token = login.data?.data?.accessToken
  if (!token) {
    console.error('login failed', login)
    process.exit(1)
  }
  const call = api(token)
  const date = today()

  await call('POST', '/ops/shifts/close', { closingCash: 0 })
  await call('POST', '/ops/shifts/open', { openingCash: 100 })

  const item = await call('POST', '/items', {
    barcode: `8${String(Date.now()).slice(-12)}`,
    name_ar: `${TAG} صنف`,
    name_en: `${TAG} item`,
    retailPrice: 25,
    costPrice: 10,
    stockQty: 40,
    unit: 'piece',
    isFavorite: true,
  })
  const itemId = item.data?.data?.id
  step('create-item', 'id', itemId, !!itemId)

  const fav = await call('GET', '/items?pageSize=30&search=' + encodeURIComponent(TAG))
  const found = (fav.data?.data?.items || []).some((i) => i.id === itemId)
  step('search-pageSize-30', true, found, found)

  const sale = await call('POST', '/sales', {
    paymentType: 'CASH',
    priceType: 'RETAIL',
    currency: 'EGP',
    exchangeRate: 1,
    items: [{ itemId, quantity: 2, unitPrice: 25 }],
    notes: TAG,
  })
  const saleId = sale.data?.data?.id
  step('create-draft-sale', 'id', saleId, !!saleId)
  const park = await call('POST', `/sales/${saleId}/park`, {})
  step('park-sale', 200, park.status, park.status === 200)
  const parked = await call('GET', '/sales/parked/list')
  const inList = (parked.data?.data || []).some((p) => p.id === saleId)
  step('parked-list-contains', true, inList, inList)
  const resume = await call('GET', `/sales/${saleId}`)
  step('resume-parked-status', 'PARKED', resume.data?.data?.status, resume.data?.data?.status === 'PARKED')

  const exp = await call('POST', '/expenses', {
    categoryId: 'expcat-other',
    amount: 75,
    currency: 'EGP',
    date,
    description: TAG,
  })
  step('create-expense', '201/200', exp.status, exp.status === 201 || exp.status === 200)

  const expR = await call('GET', `/reports/expenses?from=${date}&to=${date}`)
  const expTotal = Number(expR.data?.data?.summary?.totalEGP)
  step('expense-analysis-total>=75', '>=75', expTotal, expR.status === 200 && expTotal >= 75)
  step('expense-analysis-categories', 'array', Array.isArray(expR.data?.data?.byCategory), Array.isArray(expR.data?.data?.byCategory))

  const asOf = await call('GET', `/reports/inventory-as-of?date=${date}`)
  const row = (asOf.data?.data?.items || []).find((i) => i.id === itemId)
  step('inventory-as-of-200', 200, asOf.status, asOf.status === 200)
  step('inventory-as-of-qty', 40, row?.asOfQty, nearly(row?.asOfQty, 40))
  step('inventory-as-of-cost-value', 400, row?.costValue, nearly(row?.costValue, 400))

  const cmp = await call('GET', `/reports/period-compare?fromA=${date}&toA=${date}&fromB=${date}&toB=${date}`)
  step('period-compare-200', 200, cmp.status, cmp.status === 200)
  const netA = Number(cmp.data?.data?.periodA?.netSales)
  const diffAbs = Number(cmp.data?.data?.diff?.netSales?.abs)
  step('period-compare-same-range-diff-0', 0, diffAbs, nearly(diffAbs, 0) && Number.isFinite(netA))

  const pass = steps.filter((s) => s.ok).length
  const fail = steps.filter((s) => !s.ok).length
  fs.mkdirSync(path.dirname(REPORT), { recursive: true })
  fs.writeFileSync(REPORT, JSON.stringify({ at: new Date().toISOString(), tag: TAG, pass, fail, steps }, null, 2), 'utf8')
  console.log(`\nRESULT: ${pass} passed / ${fail} failed / ${steps.length} total`)
  console.log(`Report: ${REPORT}`)
  stopApi()
  await sleep(400)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  stopApi()
  process.exit(1)
})
