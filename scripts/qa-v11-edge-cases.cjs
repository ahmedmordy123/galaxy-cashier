/**
 * v1.1 edge API tests (against running API on :4001):
 * (أ) tax settings change while DRAFT open + shift open
 * (ب) tax-exempt + taxable + invoice discount
 * (ج) price 0 / below-cost with below_cost_policy=BLOCK via API
 *
 *   node scripts/qa-v11-edge-cases.cjs
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawn, execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'docs', 'QA-V11-EDGE-CASES.json')
const API = 'http://127.0.0.1:4001'
const DATA_DIR = path.join(process.env.USERPROFILE, 'Documents', 'CASR', 'data')
const DB = path.join(DATA_DIR, 'cashier.db')
const UNPACKED = path.join(ROOT, 'apps', 'desktop', 'dist', 'win-unpacked', 'Galaxy Cashier.exe')
const STAGING_API = path.join(ROOT, 'apps', 'desktop', 'staging', 'api')
const STAGING_NODE = path.join(ROOT, 'apps', 'desktop', 'staging', 'node', 'node.exe')

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`)
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}
function nearly(a, b, eps = 0.02) {
  return Math.abs(Number(a) - Number(b)) <= eps
}
function fileUrl(p) {
  return `file:${p.replace(/\\/g, '/')}`
}

function killPorts() {
  for (const im of ['Galaxy Cashier.exe', 'Galaxy Cashier 1.1.0.exe']) {
    try {
      execSync(`taskkill /IM "${im}" /F`, { stdio: 'ignore' })
    } catch {
      /* */
    }
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

async function waitHealth(sec = 90) {
  for (let i = 0; i < sec; i++) {
    try {
      const r = await fetch(`${API}/health`)
      if (r.ok) return true
    } catch {
      /* */
    }
    await sleep(1000)
  }
  return false
}

async function startApi() {
  // Reuse already-running API if healthy (e.g. staging started by operator)
  if (await waitHealth(3)) return
  killPorts()
  await sleep(800)
  if (fs.existsSync(UNPACKED)) {
    spawn(UNPACKED, [], { detached: true, stdio: 'ignore' }).unref()
  } else {
    const nodeExe = fs.existsSync(STAGING_NODE) ? STAGING_NODE : 'node'
    spawn(nodeExe, ['server.js'], {
      cwd: STAGING_API,
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        DATABASE_URL: fileUrl(DB),
        PORT: '4001',
        JWT_SECRET: 'edge-v11',
        NODE_ENV: 'production',
      },
    }).unref()
  }
  if (!(await waitHealth())) throw new Error('health timeout')
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

async function login() {
  const r = await req(null, 'POST', '/auth/login', { username: 'admin', password: 'admin123' })
  if (!r.ok) throw new Error('login failed')
  return r.data.data.accessToken
}

async function mkItem(token, name, cost, retail, extra = {}) {
  const r = await req(token, 'POST', '/items', {
    name_ar: name,
    name_en: name,
    unit: 'piece',
    costPrice: cost,
    retailPrice: retail,
    wholesalePrice: retail,
    specialPrice: retail,
    stockQty: 200,
    minimumStock: 1,
    barcode: `E${Date.now()}${Math.floor(Math.random() * 999)}`,
    ...extra,
  })
  if (!r.ok) throw new Error(`item ${name}: ${JSON.stringify(r.data)}`)
  return r.data.data
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  // Use current Documents DB (already v1.1 schema from sim) — ensure API up
  await startApi()
  const token = await login()

  // Ensure shift
  await req(token, 'POST', '/ops/shifts/open', { openingCash: 100 })

  // ── (أ) tax change while DRAFT + open shift ────────────────────────────────
  await req(token, 'PUT', '/settings', {
    vat_enabled: 'true',
    tax_mode: 'INCLUSIVE',
    tax_rate: '14',
    below_cost_policy: 'WARN',
  })
  const itemA = await mkItem(token, 'EDGE-A taxable', 50, 100)
  const draft = await req(token, 'POST', '/sales', {
    paymentType: 'CASH',
    priceType: 'RETAIL',
    currency: 'EGP',
    discountType: 'PERCENT',
    discount: 0,
    items: [{ itemId: itemA.id, quantity: 1, unitPrice: 100, originalUnitPrice: 100 }],
  })
  check('(أ) DRAFT create under INCLUSIVE', draft.ok, String(draft.status))
  const draftInv = draft.data.data
  const draftTaxMode = draftInv.taxMode
  const draftTotal = Number(draftInv.total)
  check('(أ) DRAFT snapshotted INCLUSIVE', draftTaxMode === 'INCLUSIVE', String(draftTaxMode))
  check('(أ) DRAFT inclusive total==100', nearly(draftTotal, 100), String(draftTotal))

  // Change settings to EXCLUSIVE while draft open
  const setEx = await req(token, 'PUT', '/settings', {
    vat_enabled: 'true',
    tax_mode: 'EXCLUSIVE',
    tax_rate: '14',
  })
  check('(أ) settings → EXCLUSIVE while DRAFT open', setEx.ok, String(setEx.status))

  // Confirm WITHOUT re-saving: must keep DRAFT snapshot (not live settings)
  const conf = await req(token, 'POST', `/sales/${draftInv.id}/confirm`, {
    payments: [{ method: 'CASH', amount: draftTotal }],
  })
  check('(أ) confirm DRAFT ok after settings change', conf.ok, String(conf.status))
  if (conf.ok) {
    const c = conf.data.data
    check(
      '(أ) confirmed keeps INCLUSIVE snapshot (not live EXCLUSIVE)',
      c.taxMode === 'INCLUSIVE' && nearly(Number(c.total), 100),
      `mode=${c.taxMode} total=${c.total}`,
    )
  }

  // New draft after change should be EXCLUSIVE
  const draft2 = await req(token, 'POST', '/sales', {
    paymentType: 'CASH',
    priceType: 'RETAIL',
    currency: 'EGP',
    discountType: 'PERCENT',
    discount: 0,
    items: [{ itemId: itemA.id, quantity: 1, unitPrice: 100, originalUnitPrice: 100 }],
  })
  check(
    '(أ) new DRAFT uses EXCLUSIVE live settings',
    draft2.ok && draft2.data.data.taxMode === 'EXCLUSIVE' && nearly(Number(draft2.data.data.total), 114),
    draft2.ok ? `mode=${draft2.data.data.taxMode} total=${draft2.data.data.total}` : String(draft2.status),
  )
  // cancel/park cleanup
  if (draft2.ok) {
    await req(token, 'POST', `/sales/${draft2.data.data.id}/cancel`).catch(() => null)
  }

  // ── (ب) exempt + taxable + invoice discount ────────────────────────────────
  await req(token, 'PUT', '/settings', {
    vat_enabled: 'true',
    tax_mode: 'EXCLUSIVE',
    tax_rate: '14',
  })
  const taxable = await mkItem(token, 'EDGE-taxable', 40, 200)
  const exempt = await mkItem(token, 'EDGE-exempt', 20, 100, { taxExempt: true })
  // subtotal 300, disc 10% → after=270; taxable share=200/300 → taxableAfter=180; tax=25.2; total=295.2
  const mix = await req(token, 'POST', '/sales', {
    paymentType: 'CASH',
    priceType: 'RETAIL',
    currency: 'EGP',
    discountType: 'PERCENT',
    discount: 10,
    items: [
      { itemId: taxable.id, quantity: 1, unitPrice: 200, originalUnitPrice: 200 },
      { itemId: exempt.id, quantity: 1, unitPrice: 100, originalUnitPrice: 100 },
    ],
  })
  check('(ب) mixed exempt+taxable create', mix.ok, String(mix.status))
  if (mix.ok) {
    const m = mix.data.data
    check('(ب) net after disc 270', nearly(Number(m.netOfTax), 270), String(m.netOfTax))
    check('(ب) tax on taxable share only 25.2', nearly(Number(m.tax), 25.2), String(m.tax))
    check('(ب) total 295.2', nearly(Number(m.total), 295.2), String(m.total))
    check('(ب) exempt line flagged', m.items.some((l) => l.taxExempt === true), '')
    await req(token, 'POST', `/sales/${m.id}/confirm`, {
      payments: [{ method: 'CASH', amount: Number(m.total) }],
    })
  }

  // ── (ج) below-cost BLOCK via API ───────────────────────────────────────────
  await req(token, 'PUT', '/settings', { below_cost_policy: 'BLOCK' })
  const costly = await mkItem(token, 'EDGE-costly', 80, 100)
  const below = await req(token, 'POST', '/sales', {
    paymentType: 'CASH',
    priceType: 'RETAIL',
    currency: 'EGP',
    discountType: 'PERCENT',
    discount: 0,
    belowCostConfirmed: true, // even with confirm flag, BLOCK must reject
    items: [
      {
        itemId: costly.id,
        quantity: 1,
        unitPrice: 50,
        originalUnitPrice: 100,
        priceOverridden: true,
      },
    ],
  })
  check(
    '(ج) below-cost BLOCK rejects (even with confirm)',
    !below.ok && (below.status === 400 || below.data?.code === 'BELOW_COST_BLOCKED' || String(below.data?.error || '').includes('تكلفة')),
    `status=${below.status} code=${below.data?.code || below.data?.error}`,
  )

  const zero = await req(token, 'POST', '/sales', {
    paymentType: 'CASH',
    priceType: 'RETAIL',
    currency: 'EGP',
    discountType: 'PERCENT',
    discount: 0,
    belowCostConfirmed: true,
    items: [
      {
        itemId: costly.id,
        quantity: 1,
        unitPrice: 0,
        originalUnitPrice: 100,
        priceOverridden: true,
      },
    ],
  })
  check(
    '(ج) price 0 BLOCK rejects',
    !zero.ok && zero.status === 400,
    `status=${zero.status} code=${zero.data?.code || zero.data?.error}`,
  )

  // restore WARN for leftover DB
  await req(token, 'PUT', '/settings', { below_cost_policy: 'WARN', tax_mode: 'EXCLUSIVE' })

  const passed = results.filter((r) => r.ok).length
  const out = { at: new Date().toISOString(), passed, total: results.length, results }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2))
  console.log(`done ${passed}/${results.length}`)
  // Leave API up if it was pre-started; only kill if we spawned (env flag)
  if (process.env.QA_KILL_API === '1') killPorts()
  if (passed !== results.length) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  if (process.env.QA_KILL_API === '1') killPorts()
  process.exit(1)
})
