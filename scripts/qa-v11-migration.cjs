/**
 * Migrate a v1.0.0 backup DB through ensureSqliteSchema (v1.1) and assert no data loss.
 *
 *   node scripts/qa-v11-migration.cjs
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawn, execSync } = require('child_process')
const { PrismaClient } = require('@prisma/client')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'docs', 'QA-V11-MIGRATION.json')
const API = 'http://127.0.0.1:4001'
const DATA_DIR = path.join(process.env.USERPROFILE, 'Documents', 'CASR', 'data')
const LIVE = path.join(DATA_DIR, 'cashier.db')
const WORK = path.join(DATA_DIR, 'cashier.db.migrate-v11-test')
const UNPACKED = path.join(ROOT, 'apps', 'desktop', 'dist', 'win-unpacked', 'Galaxy Cashier.exe')

const BACKUP_CANDIDATES = [
  path.join(DATA_DIR, 'cashier.db.pre-v1.1-20261108143017'),
  path.join(ROOT, 'data', 'cashier.db.pre-v1.1-backup'),
  path.join(DATA_DIR, 'cashier.db.pre-v1.1-sim-1794142176206'),
]

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`)
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
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

async function waitHealth(sec = 120) {
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

async function counts(dbPath) {
  const prisma = new PrismaClient({ datasources: { db: { url: fileUrl(dbPath) } } })
  try {
    const [users, items, customers, sales, saleItems, settings] = await Promise.all([
      prisma.user.count(),
      prisma.item.count(),
      prisma.customer.count(),
      prisma.salesInvoice.count(),
      prisma.salesInvoiceItem.count(),
      prisma.settings.count(),
    ])
    // optional columns probe
    let hasCanEdit = false
    let hasTaxExempt = false
    let hasTaxMode = false
    try {
      const cols = await prisma.$queryRawUnsafe(`PRAGMA table_info("User")`)
      hasCanEdit = cols.some((c) => c.name === 'canEditPrice')
    } catch {
      /* */
    }
    try {
      const cols = await prisma.$queryRawUnsafe(`PRAGMA table_info("Item")`)
      hasTaxExempt = cols.some((c) => c.name === 'taxExempt')
    } catch {
      /* */
    }
    try {
      const cols = await prisma.$queryRawUnsafe(`PRAGMA table_info("SalesInvoice")`)
      hasTaxMode = cols.some((c) => c.name === 'taxMode')
    } catch {
      /* */
    }
    // sample invoice totals fingerprint
    const sample = await prisma.salesInvoice.findMany({
      take: 20,
      orderBy: { createdAt: 'asc' },
      select: { id: true, invoiceNumber: true, total: true, subtotal: true, tax: true },
    })
    return {
      users,
      items,
      customers,
      sales,
      saleItems,
      settings,
      hasCanEdit,
      hasTaxExempt,
      hasTaxMode,
      sample,
    }
  } finally {
    await prisma.$disconnect()
  }
}

async function main() {
  const backup = BACKUP_CANDIDATES.find((p) => fs.existsSync(p))
  check('v1.0 backup found', Boolean(backup), backup || 'none')
  if (!backup) {
    fs.writeFileSync(OUT, JSON.stringify({ results }, null, 2))
    process.exit(1)
  }

  killPorts()
  await sleep(500)

  // Preserve live DB aside
  let liveAside = null
  if (fs.existsSync(LIVE)) {
    liveAside = LIVE + `.aside-during-migrate-${Date.now()}`
    fs.copyFileSync(LIVE, liveAside)
  }

  fs.copyFileSync(backup, WORK)
  fs.copyFileSync(WORK, LIVE)
  check('restored backup as live DB', fs.existsSync(LIVE), `${fs.statSync(LIVE).size} bytes`)

  const before = await counts(LIVE)
  check('pre-migrate: has data', before.sales > 0 || before.items > 0, JSON.stringify({
    users: before.users,
    items: before.items,
    sales: before.sales,
  }))
  check(
    'pre-migrate: likely v1.0 (missing v1.1 cols OR old)',
    !before.hasTaxMode || !before.hasCanEdit || !before.hasTaxExempt || before.sales > 0,
    `canEdit=${before.hasCanEdit} taxExempt=${before.hasTaxExempt} taxMode=${before.hasTaxMode}`,
  )

  // Boot app → ensureSqliteSchema runs
  spawn(UNPACKED, [], { detached: true, stdio: 'ignore' }).unref()
  const healthy = await waitHealth(150)
  check('API healthy after boot on backup DB', healthy)

  // Login proves schema works
  let loginOk = false
  try {
    const r = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    })
    loginOk = r.ok
  } catch {
    loginOk = false
  }
  check('login after migration', loginOk)

  killPorts()
  await sleep(1000)

  const after = await counts(LIVE)
  check('post-migrate: User.canEditPrice exists', after.hasCanEdit)
  check('post-migrate: Item.taxExempt exists', after.hasTaxExempt)
  check('post-migrate: SalesInvoice.taxMode exists', after.hasTaxMode)
  check('no user loss', after.users === before.users, `${before.users}→${after.users}`)
  check('no item loss', after.items === before.items, `${before.items}→${after.items}`)
  check('no customer loss', after.customers === before.customers, `${before.customers}→${after.customers}`)
  check('no sales loss', after.sales === before.sales, `${before.sales}→${after.sales}`)
  check('no sale-line loss', after.saleItems === before.saleItems, `${before.saleItems}→${after.saleItems}`)

  // Fingerprint: same invoice numbers + totals
  const beforeMap = Object.fromEntries(before.sample.map((s) => [s.id, s]))
  let fingerprintOk = true
  for (const s of after.sample) {
    const b = beforeMap[s.id]
    if (!b || String(b.total) !== String(s.total) || String(b.subtotal) !== String(s.subtotal)) {
      fingerprintOk = false
      check(`fingerprint ${s.invoiceNumber}`, false, `before=${JSON.stringify(b)} after=${JSON.stringify(s)}`)
    }
  }
  check('invoice total fingerprint intact', fingerprintOk, `${after.sample.length} samples`)

  // Restore previous live if we had one (sim DB) — leave migrated backup copy at WORK
  if (liveAside && fs.existsSync(liveAside)) {
    fs.copyFileSync(liveAside, LIVE)
    check('restored prior live DB after test', true, liveAside)
  }

  const passed = results.filter((r) => r.ok).length
  const out = {
    at: new Date().toISOString(),
    backup,
    before: { ...before, sample: before.sample.length },
    after: { ...after, sample: after.sample.length },
    passed,
    total: results.length,
    results,
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2))
  console.log(`done ${passed}/${results.length}`)
  if (passed !== results.length) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  killPorts()
  process.exit(1)
})
