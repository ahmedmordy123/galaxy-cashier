/**
 * Accounting proof: staff advances deduct from the drawer and stay isolated per employee.
 *
 *   node scripts/accounting-advances-stress.cjs
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
const TEST_DB = path.join(ROOT, 'data', 'cashier-advances-acct.db')
const API_PORT = process.env.ADVANCE_PORT || '4015'
const API_BASE = process.env.INTEGRATION_API || `http://127.0.0.1:${API_PORT}`
const REPORT = path.join(ROOT, 'docs', 'ACCOUNTING-ADVANCES-REPORT.json')

const steps = []
const TAG = `ADV-${Date.now().toString(36).toUpperCase()}`

function nearly(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.01
}

function step(name, expected, actual, ok) {
  const row = { name, expected, actual: actual == null ? String(actual) : actual, ok: !!ok }
  steps.push(row)
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
    const pids = new Set()
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes('LISTENING')) continue
      const parts = line.trim().split(/\s+/)
      const pid = parts[parts.length - 1]
      if (pid && /^\d+$/.test(pid)) pids.add(pid)
    }
    for (const pid of pids) {
      try { execSync(`taskkill /pid ${pid} /f /t`, { stdio: 'ignore' }) } catch { /* */ }
    }
  } catch { /* */ }
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

async function expectedCash(call) {
  const s = await call('GET', '/ops/shifts/current/summary')
  return Number(s.data?.data?.expectedCash)
}

async function breakdown(call) {
  const s = await call('GET', '/ops/shifts/current/summary')
  return s.data?.data?.cashBreakdown || {}
}

async function main() {
  console.log('\n=== Accounting — staff advances vs drawer ===\n')
  if (!SOURCE_DB) {
    console.error('No seed/source DB found')
    process.exit(1)
  }
  fs.mkdirSync(path.dirname(TEST_DB), { recursive: true })
  fs.copyFileSync(SOURCE_DB, TEST_DB)
  const env = loadEnvFile()
  env.DATABASE_URL = fileUrl(TEST_DB)
  env.PORT = API_PORT
  env.JWT_SECRET = env.JWT_SECRET || 'advance-acct-test-secret'
  env.JWT_REFRESH_SECRET = env.JWT_REFRESH_SECRET || 'advance-acct-test-refresh'
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

  const loginRes = await api(null)('POST', '/auth/login', { username: 'admin', password: 'admin123' })
  const token = loginRes.data?.data?.accessToken
  const adminId = loginRes.data?.data?.user?.id
  if (!token) {
    console.error('Login failed', loginRes)
    process.exit(1)
  }
  const call = api(token)
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const date = today()

  await call('POST', '/ops/shifts/close', { closingCash: 0 })

  const empA = await call('POST', '/settings/users', {
    name: `${TAG} موظف أ`,
    username: `empa_${Date.now().toString(36)}`,
    password: 'staff123',
    role: 'STAFF',
    language: 'ar',
  })
  const empB = await call('POST', '/settings/users', {
    name: `${TAG} موظف ب`,
    username: `empb_${Date.now().toString(36)}`,
    password: 'staff123',
    role: 'STAFF',
    language: 'ar',
  })
  const idA = empA.data?.data?.id
  const idB = empB.data?.data?.id
  step('create-employee-A', 'id', idA, !!idA)
  step('create-employee-B', 'id', idB, !!idB)

  const opened = await call('POST', '/ops/shifts/open', { openingCash: 1000 })
  step('open-shift', 201, opened.status, opened.status === 201 || opened.status === 200)
  let exp = await expectedCash(call)
  step('1 expected == opening', 1000, exp, nearly(exp, 1000))

  const a1 = await call('POST', '/staff-advances', {
    employeeId: idA, amount: 100, date, notes: `${TAG}-A1`,
  })
  step('create-advance-A1', 201, a1.status, a1.status === 201)
  exp = await expectedCash(call)
  step('2 expected after A=100', 900, exp, nearly(exp, 900))

  const a2 = await call('POST', '/staff-advances', {
    employeeId: idA, amount: 50, date, notes: `${TAG}-A2`,
  })
  step('create-advance-A2', 201, a2.status, a2.status === 201)
  exp = await expectedCash(call)
  step('3 expected after A+50', 850, exp, nearly(exp, 850))

  const ledgerA = await call('GET', `/staff-advances/employees/${idA}/ledger?year=${year}&month=${month}`)
  const aTotal = Number(ledgerA.data?.data?.total)
  const aDay = ledgerA.data?.data?.days?.find((d) => d.date === date)
  step('3 A month total', 150, aTotal, nearly(aTotal, 150))
  step('3 A same-day total', 150, aDay?.total, nearly(aDay?.total, 150))

  const expn = await call('POST', '/expenses', {
    categoryId: 'expcat-other',
    amount: 20,
    currency: 'EGP',
    date,
    description: TAG,
  })
  step('create-expense-20', '201/200', expn.status, expn.status === 201 || expn.status === 200)
  exp = await expectedCash(call)
  const br4 = await breakdown(call)
  step('4 expected after expense 20', 830, exp, nearly(exp, 830))
  step('4 advances still 150', 150, br4.staffAdvances, nearly(br4.staffAdvances, 150))
  step('4 expenses 20', 20, br4.expenses, nearly(br4.expenses, 20))

  const item = await call('POST', '/items', {
    barcode: `9${String(Date.now()).slice(-12)}`,
    name_ar: `${TAG} صنف`,
    name_en: `${TAG} item`,
    retailPrice: 10,
    costPrice: 5,
    stockQty: 20,
    unit: 'piece',
  })
  const itemId = item.data?.data?.id || item.data?.data?.item?.id
  step('create-item', 'id', itemId, !!itemId)
  const sale = await call('POST', '/sales', {
    paymentType: 'CASH',
    priceType: 'RETAIL',
    currency: 'EGP',
    exchangeRate: 1,
    items: [{ itemId, quantity: 1, unitPrice: 10 }],
    notes: TAG,
  })
  const saleId = sale.data?.data?.id || sale.data?.data?.invoice?.id
  if (saleId) await call('POST', `/sales/${saleId}/confirm`, {})
  exp = await expectedCash(call)
  step('5 expected after cash sale 10', 840, exp, nearly(exp, 840))
  const br5 = await breakdown(call)
  step('5 advances still deducted', 150, br5.staffAdvances, nearly(br5.staffAdvances, 150))

  const b1 = await call('POST', '/staff-advances', {
    employeeId: idB, amount: 30, date, notes: `${TAG}-B1`,
  })
  step('create-advance-B', 201, b1.status, b1.status === 201)
  exp = await expectedCash(call)
  step('8 expected after B=30', 810, exp, nearly(exp, 810))
  const ledgerA2 = await call('GET', `/staff-advances/employees/${idA}/ledger?year=${year}&month=${month}`)
  const ledgerB = await call('GET', `/staff-advances/employees/${idB}/ledger?year=${year}&month=${month}`)
  step('8 A ledger isolated', 150, ledgerA2.data?.data?.total, nearly(ledgerA2.data?.data?.total, 150))
  step('8 B ledger isolated', 30, ledgerB.data?.data?.total, nearly(ledgerB.data?.data?.total, 30))

  const a2id = a2.data?.data?.id
  const del = await call('DELETE', `/staff-advances/${a2id}`)
  step('6 delete A2', 200, del.status, del.status === 200)
  exp = await expectedCash(call)
  step('6 expected restored +50', 860, exp, nearly(exp, 860))
  const ledgerA3 = await call('GET', `/staff-advances/employees/${idA}/ledger?year=${year}&month=${month}`)
  step('6 A month after delete', 100, ledgerA3.data?.data?.total, nearly(ledgerA3.data?.data?.total, 100))

  const closed = await call('POST', '/ops/shifts/close', { closingCash: 860 })
  const diff = Number(closed.data?.data?.cashDifference)
  const closedExpected = Number(closed.data?.data?.expectedCash ?? closed.data?.data?.cashBreakdown?.expectedCash)
  step('7 close expected', 860, closedExpected, nearly(closedExpected, 860))
  step('7 cashDifference == 0', 0, diff, nearly(diff, 0))

  const summary = await call('GET', `/staff-advances/summary?year=${year}&month=${month}`)
  const rows = summary.data?.data?.employees || []
  const rowA = rows.find((r) => r.employeeId === idA)
  const rowB = rows.find((r) => r.employeeId === idB)
  step('summary A', 100, rowA?.total, nearly(rowA?.total, 100))
  step('summary B', 30, rowB?.total, nearly(rowB?.total, 30))

  const pass = steps.filter((s) => s.ok).length
  const fail = steps.filter((s) => !s.ok).length
  const report = {
    at: new Date().toISOString(),
    tag: TAG,
    formula: 'expected = opening + cashIn - refunds + receipts - disbursements - expenses - staffAdvances',
    pass,
    fail,
    total: steps.length,
    adminId,
    steps,
  }
  fs.mkdirSync(path.dirname(REPORT), { recursive: true })
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8')
  console.log(`\nRESULT: ${pass} passed / ${fail} failed / ${steps.length} total`)
  console.log(`Report: ${REPORT}`)
  if (fail) {
    for (const s of steps.filter((x) => !x.ok)) {
      console.log(`  - ${s.name}: expected ${s.expected} actual ${s.actual}`)
    }
  }
  stopApi()
  await sleep(400)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  stopApi()
  process.exit(1)
})
