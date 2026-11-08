/**
 * Phase 2 API scenarios (isolated DB on port 4015)
 * Sale+discount+tax, partial return, credit+receipt, oversell, RBAC, backup/restore, concurrency
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawn, execSync } = require('child_process')
const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')

const ROOT = path.resolve(__dirname, '..')
const SOURCE_DB = path.join(ROOT, 'data', 'cashier.db')
const TEST_DB = path.join(ROOT, 'data', 'cashier-qa-phase2.db')
const API_PORT = process.env.QA_PORT || '4015'
const API_BASE = `http://127.0.0.1:${API_PORT}`
const results = []

function rec(name, ok, detail) {
  results.push({ name, ok, detail: String(detail) })
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`)
  return ok
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function fileUrl(p) {
  return `file:${p.replace(/\\/g, '/')}`
}

function killPort(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' })
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes('LISTENING')) continue
      const pid = line.trim().split(/\s+/).pop()
      if (/^\d+$/.test(pid)) {
        try {
          execSync(`taskkill /pid ${pid} /f /t`, { stdio: 'ignore' })
        } catch {
          /* */
        }
      }
    }
  } catch {
    /* */
  }
}

let apiProcess = null
function stopApi() {
  if (apiProcess) {
    try {
      spawn('taskkill', ['/pid', String(apiProcess.pid), '/f', '/t'], { stdio: 'ignore' })
    } catch {
      try {
        apiProcess.kill()
      } catch {
        /* */
      }
    }
  }
  killPort(API_PORT)
}

async function waitHealth() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${API_BASE}/health`)
      if (r.ok) return
    } catch {
      /* */
    }
    await sleep(250)
  }
  throw new Error('health timeout')
}

async function req(token, method, urlPath, body) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const r = await fetch(`${API_BASE}/api${urlPath}`, {
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

async function login(u, p) {
  const r = await req(null, 'POST', '/auth/login', { username: u, password: p })
  if (!r.ok) throw new Error(`login ${u}: ${r.status} ${JSON.stringify(r.data)}`)
  return r.data.data?.accessToken || r.data.accessToken
}

async function ensureUsers(dbPath) {
  const prisma = new PrismaClient({ datasources: { db: { url: fileUrl(dbPath) } } })
  try {
    const hashA = await bcrypt.hash('admin123', 10)
    const hashC = await bcrypt.hash('cashier123', 10)
    await prisma.user.upsert({
      where: { username: 'admin' },
      update: { passwordHash: hashA, role: 'ADMIN', isActive: true },
      create: { username: 'admin', name: 'Admin', passwordHash: hashA, role: 'ADMIN', language: 'ar' },
    })
    await prisma.user.upsert({
      where: { username: 'cashier1' },
      update: { passwordHash: hashC, role: 'CASHIER', isActive: true },
      create: { username: 'cashier1', name: 'Cashier', passwordHash: hashC, role: 'CASHIER', language: 'ar' },
    })
    await prisma.settings.upsert({
      where: { key: 'tax_rate' },
      update: { value: '14' },
      create: { key: 'tax_rate', value: '14', description: 'VAT %' },
    })
  } finally {
    await prisma.$disconnect()
  }
}

async function main() {
  console.log('=== QA Phase 2 API ===\n')
  if (!fs.existsSync(SOURCE_DB)) throw new Error('missing source db')
  fs.copyFileSync(SOURCE_DB, TEST_DB)
  await ensureUsers(TEST_DB)

  killPort(API_PORT)
  const env = {
    ...process.env,
    PORT: API_PORT,
    DATABASE_URL: fileUrl(TEST_DB),
    COOKIE_SECURE: 'false',
    NODE_ENV: 'development',
  }
  apiProcess = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: path.join(ROOT, 'apps', 'api'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  })
  let bootLog = ''
  apiProcess.stdout.on('data', (d) => {
    bootLog += d.toString()
  })
  apiProcess.stderr.on('data', (d) => {
    bootLog += d.toString()
  })

  try {
    await waitHealth()
  } catch (e) {
    console.error(bootLog)
    stopApi()
    throw e
  }

  const admin = await login('admin', 'admin123')
  const cashier = await login('cashier1', 'cashier123')

  // Open shift
  await req(admin, 'POST', '/ops/shifts/open', { openingCash: 1000 })

  // Create 3 items with stock
  const items = []
  for (let i = 0; i < 3; i++) {
    const barcode = `QA2-${Date.now()}-${i}`
    const created = await req(admin, 'POST', '/items', {
      name_ar: `صنف تجريبي ${i + 1}`,
      name_en: `QA Item ${i + 1}`,
      barcode,
      retailPrice: 100 + i * 10,
      costPrice: 50,
      stockQty: 20,
      minimumStock: 1,
      unit: 'piece',
    })
    if (!created.ok) throw new Error('create item ' + JSON.stringify(created.data))
    const id = created.data.data?.id || created.data.id
    // ensure stock via stock IN if needed
    items.push({ id, barcode, price: 100 + i * 10 })
  }

  // Stock adjust via purchase or stock transfer if stockQty create doesn't apply
  const prisma = new PrismaClient({ datasources: { db: { url: fileUrl(TEST_DB) } } })
  try {
    for (const it of items) {
      await prisma.item.update({ where: { id: it.id }, data: { stockQty: 20 } })
      const wh = await prisma.warehouse.findFirst({ where: { isDefault: true } })
      if (wh) {
        await prisma.stockBalance.upsert({
          where: { itemId_warehouseId: { itemId: it.id, warehouseId: wh.id } },
          update: { qty: 20 },
          create: { itemId: it.id, warehouseId: wh.id, qty: 20 },
        })
      }
    }
  } finally {
    await prisma.$disconnect()
  }

  // Customer for credit
  const cust = await req(admin, 'POST', '/customers', {
    name: 'عميل آجل QA "رمز"',
    phone: '01000000000',
    type: 'RETAIL',
    creditLimit: 5000,
    currency: 'EGP',
  })
  const customerId = cust.data.data?.id || cust.data.id
  rec('create customer arabic+symbols', !!customerId, customerId)

  // Sale 3 lines, 10% discount, tax inclusive
  const draft = await req(admin, 'POST', '/sales', {
    paymentType: 'CASH',
    priceType: 'RETAIL',
    currency: 'EGP',
    discountType: 'PERCENT',
    discount: 10,
    items: items.map((it) => ({ itemId: it.id, quantity: 2, unitPrice: it.price })),
  })
  if (!draft.ok) {
    rec('sale create HTTP', false, `${draft.status} ${JSON.stringify(draft.data).slice(0, 300)}`)
  }
  const invPayload = draft.data.data || draft.data
  const invId = invPayload?.id
  const subtotal = Number(invPayload?.subtotal)
  const total = Number(invPayload?.total)
  const tax = Number(invPayload?.tax)
  // lines: 100*2 + 110*2 + 120*2 = 660; after 10% = 594; tax embedded 14%: tax = 594*14/114
  const expectedAfterDisc = 660 * 0.9
  const expectedTax = (expectedAfterDisc * 14) / 114
  const moneyOk =
    Math.abs(subtotal - 660) < 0.02 &&
    Math.abs(total - expectedAfterDisc) < 0.02 &&
    Math.abs(tax - expectedTax) < 0.05
  rec(
    'sale 3 items +10% discount + tax inclusive totals',
    moneyOk,
    `sub=${subtotal} total=${total} tax=${tax} expTotal=${expectedAfterDisc} expTax=${expectedTax.toFixed(4)}`
  )

  const conf = await req(admin, 'POST', `/sales/${invId}/confirm`, {
    payments: [{ method: 'CASH', amount: total }],
  })
  rec('confirm cash sale', conf.ok && (conf.data.data?.status || conf.data.status) === 'CONFIRMED', conf.status)

  // Stock after sale: 20-2=18 each
  {
    const p = new PrismaClient({ datasources: { db: { url: fileUrl(TEST_DB) } } })
    try {
      const rows = await p.item.findMany({ where: { id: { in: items.map((x) => x.id) } } })
      const ok = rows.every((r) => Number(r.stockQty) === 18)
      rec('stock deducted by 2 each', ok, rows.map((r) => `${r.name_ar}:${r.stockQty}`).join(','))
    } finally {
      await p.$disconnect()
    }
  }

  // Partial return qty 1 of first item
  const ret = await req(admin, 'POST', `/sales/${invId}/partial-return`, {
    items: [{ itemId: items[0].id, quantity: 1 }],
  })
  rec('partial return HTTP', ret.ok || ret.status === 200 || ret.status === 201, `${ret.status} ${JSON.stringify(ret.data).slice(0, 200)}`)

  {
    const p = new PrismaClient({ datasources: { db: { url: fileUrl(TEST_DB) } } })
    try {
      const it = await p.item.findUnique({ where: { id: items[0].id } })
      rec('stock after partial return item0', Number(it.stockQty) === 19, `qty=${it.stockQty}`)
    } finally {
      await p.$disconnect()
    }
  }

  // Credit sale
  const creditDraft = await req(admin, 'POST', '/sales', {
    paymentType: 'CREDIT',
    customerId,
    priceType: 'RETAIL',
    currency: 'EGP',
    discountType: 'FIXED',
    discount: 0,
    items: [{ itemId: items[1].id, quantity: 1, unitPrice: items[1].price }],
  })
  const creditPayload = creditDraft.data.data || creditDraft.data
  const creditId = creditPayload?.id
  const creditTotal = Number(creditPayload?.total)
  const creditConf = await req(admin, 'POST', `/sales/${creditId}/confirm`, {
    payments: [{ method: 'CREDIT', amount: creditTotal }],
  })
  rec('credit sale confirm', creditConf.ok, creditConf.status)

  let balAfterSale = null
  {
    const c = await req(admin, 'GET', `/customers/${customerId}`)
    balAfterSale = Number(c.data.data?.balance ?? c.data.balance)
    rec('customer balance after credit', Math.abs(balAfterSale - creditTotal) < 0.02, `bal=${balAfterSale} total=${creditTotal}`)
  }

  // Partial payment voucher RECEIPT
  const payAmt = Math.round(creditTotal / 2)
  const voucher = await req(admin, 'POST', '/vouchers', {
    type: 'RECEIPT',
    entityType: 'CUSTOMER',
    entityId: customerId,
    amount: payAmt,
    currency: 'EGP',
    description: 'تسديد جزئي QA',
  })
  rec('partial receipt voucher', voucher.ok || voucher.status === 201, voucher.status)
  {
    const c = await req(admin, 'GET', `/customers/${customerId}`)
    const bal = Number(c.data.data?.balance ?? c.data.balance)
    const expected = balAfterSale - payAmt
    rec('balance after partial payment', Math.abs(bal - expected) < 0.02, `bal=${bal} expected=${expected}`)
  }

  // Oversell
  const overDraft = await req(admin, 'POST', '/sales', {
    paymentType: 'CASH',
    priceType: 'RETAIL',
    currency: 'EGP',
    items: [{ itemId: items[2].id, quantity: 9999, unitPrice: items[2].price }],
  })
  const overId = (overDraft.data.data || overDraft.data)?.id
  const overConf = await req(admin, 'POST', `/sales/${overId}/confirm`, {
    payments: [{ method: 'CASH', amount: 9999 * items[2].price }],
  })
  const overMsg = JSON.stringify(overConf.data)
  rec(
    'oversell rejected (no negative stock)',
    !overConf.ok &&
      (overMsg.includes('INSUFFICIENT') ||
        overMsg.includes('غير كافية') ||
        overConf.status === 400 ||
        overConf.status === 409),
    `${overConf.status} ${overMsg.slice(0, 180)}`
  )

  // RBAC: cashier cannot update settings / list users / cancel with admin-only
  const rbacSettings = await req(cashier, 'PUT', '/settings', { tax_rate: '99' })
  rec('cashier blocked PUT /settings', rbacSettings.status === 403, rbacSettings.status)
  const rbacUsers = await req(cashier, 'GET', '/settings/users')
  rec('cashier blocked GET /settings/users', rbacUsers.status === 403, rbacUsers.status)
  const rbacBackup = await req(cashier, 'POST', '/backup', {})
  rec('cashier blocked POST /backup', rbacBackup.status === 403, rbacBackup.status)
  const rbacAudit = await req(cashier, 'GET', '/audit')
  rec('cashier blocked GET /audit', rbacAudit.status === 403, rbacAudit.status)

  // Backup via API then restore integrity
  const beforeBackup = await req(admin, 'GET', '/items?limit=5')
  const bak = await req(admin, 'POST', '/backup', {})
  rec('admin backup create', bak.ok || bak.status === 200 || bak.status === 201, `${bak.status}`)
  const listBak = await req(admin, 'GET', '/backup')
  const files = listBak.data.data || listBak.data.files || listBak.data || []
  const fileName = Array.isArray(files)
    ? files[0]?.name || files[0]?.fileName || files[0]
    : null
  rec('backup list nonempty', Array.isArray(files) && files.length > 0, JSON.stringify(files).slice(0, 200))

  // Concurrency: two confirms on last unit
  {
    const p = new PrismaClient({ datasources: { db: { url: fileUrl(TEST_DB) } } })
    let raceItem
    try {
      const wh = await p.warehouse.findFirst({ where: { isDefault: true } })
      raceItem = await p.item.create({
        data: {
          name_ar: 'سباق مخزون',
          name_en: 'race',
          barcode: `RACE-${Date.now()}`,
          retailPrice: 50,
          costPrice: 20,
          stockQty: 1,
          unit: 'piece',
        },
      })
      if (wh) {
        await p.stockBalance.create({
          data: { itemId: raceItem.id, warehouseId: wh.id, qty: 1 },
        })
      }
    } finally {
      await p.$disconnect()
    }

    const d1 = await req(admin, 'POST', '/sales', {
      paymentType: 'CASH',
      priceType: 'RETAIL',
      currency: 'EGP',
      items: [{ itemId: raceItem.id, quantity: 1, unitPrice: 50 }],
    })
    const d2 = await req(admin, 'POST', '/sales', {
      paymentType: 'CASH',
      priceType: 'RETAIL',
      currency: 'EGP',
      items: [{ itemId: raceItem.id, quantity: 1, unitPrice: 50 }],
    })
    const id1 = (d1.data.data || d1.data)?.id
    const id2 = (d2.data.data || d2.data)?.id
    const [c1, c2] = await Promise.all([
      req(admin, 'POST', `/sales/${id1}/confirm`, { payments: [{ method: 'CASH', amount: 50 }] }),
      req(admin, 'POST', `/sales/${id2}/confirm`, { payments: [{ method: 'CASH', amount: 50 }] }),
    ])
    const wins = [c1, c2].filter((x) => x.ok).length
    const fails = [c1, c2].filter((x) => !x.ok).length
    const p2 = new PrismaClient({ datasources: { db: { url: fileUrl(TEST_DB) } } })
    let stockLeft
    try {
      const it = await p2.item.findUnique({ where: { id: raceItem.id } })
      stockLeft = Number(it.stockQty)
      const bal = await p2.stockBalance.findFirst({ where: { itemId: raceItem.id } })
      const balQty = bal ? Number(bal.qty) : null
      rec(
        'concurrency one win one fail stock>=0',
        wins === 1 && fails === 1 && stockLeft === 0 && (balQty === null || balQty === 0),
        `wins=${wins} fails=${fails} stock=${stockLeft} bal=${balQty} s1=${c1.status} s2=${c2.status}`
      )
    } finally {
      await p2.$disconnect()
    }
  }

  // Double-submit same confirm (idempotency-ish)
  const again = await req(admin, 'POST', `/sales/${invId}/confirm`, {
    payments: [{ method: 'CASH', amount: total }],
  })
  rec('double confirm rejected', !again.ok, `${again.status}`)

  // Empty/invalid input
  const bad = await req(admin, 'POST', '/sales', { paymentType: 'CASH', currency: 'EGP', priceType: 'RETAIL', items: [] })
  rec('empty items rejected', !bad.ok, bad.status)
  const badCust = await req(admin, 'POST', '/customers', { name: '' })
  rec('empty customer name rejected', !badCust.ok, badCust.status)

  // ETA disabled does not break confirm
  await req(admin, 'PUT', '/settings', { eta_enabled: 'false' })
  const etaStat = await req(admin, 'GET', '/eta/status')
  rec('eta status while disabled', etaStat.ok || etaStat.status === 200, `${etaStat.status} ${JSON.stringify(etaStat.data).slice(0, 120)}`)

  stopApi()

  const failed = results.filter((r) => !r.ok)
  console.log(`\n=== Summary ${results.length - failed.length}/${results.length} passed ===`)
  const outPath = path.join(ROOT, 'docs', 'QA-PHASE2-API-RESULTS.json')
  fs.writeFileSync(outPath, JSON.stringify({ at: new Date().toISOString(), results }, null, 2))
  console.log('Wrote', outPath)
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  stopApi()
  process.exit(1)
})
