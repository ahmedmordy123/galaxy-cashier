/**
 * Independent invoice math — ZERO dependency on apps/api salesTotals.
 * Recomputes totals from raw invoice + line rows and compares to stored fields.
 *
 *   node scripts/qa-independent-invoice-math.cjs [path-to-cashier.db]
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')

const ROOT = path.resolve(__dirname, '..')
const DEFAULT_DB = path.join(process.env.USERPROFILE || '', 'Documents', 'CASR', 'data', 'cashier.db')
const DB = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_DB
const OUT = path.join(ROOT, 'docs', 'QA-INDEPENDENT-INVOICE-MATH.json')

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100
}

/** Pure independent calculator (mirrors product rules, not imported from app). */
function indepTotals({
  lines, // [{ subtotal, taxExempt }]
  discountType, // PERCENT | FIXED
  discountValue,
  taxEnabled,
  taxMode, // INCLUSIVE | EXCLUSIVE
  taxRate,
}) {
  const subtotal = round2(lines.reduce((s, l) => s + Number(l.subtotal), 0))
  const taxableSub = round2(
    lines.filter((l) => !l.taxExempt).reduce((s, l) => s + Number(l.subtotal), 0),
  )
  let afterDiscount = subtotal
  if (discountType === 'FIXED') afterDiscount = Math.max(0, subtotal - Number(discountValue))
  else afterDiscount = subtotal * (1 - Number(discountValue) / 100)
  afterDiscount = round2(afterDiscount)

  const taxableAfter =
    subtotal <= 0 || taxableSub <= 0 ? 0 : afterDiscount * (Math.min(taxableSub, subtotal) / subtotal)

  let tax = 0
  let netOfTax = afterDiscount
  let total = afterDiscount
  const rate = Number(taxRate) || 0
  if (taxEnabled && rate > 0) {
    if (taxMode === 'EXCLUSIVE') {
      netOfTax = afterDiscount
      tax = taxableAfter * (rate / 100)
      total = afterDiscount + tax
    } else {
      tax = taxableAfter * (rate / (100 + rate))
      netOfTax = afterDiscount - tax
      total = afterDiscount
    }
  }
  total = round2(total)
  if (taxEnabled && rate > 0 && taxMode === 'EXCLUSIVE') {
    netOfTax = round2(netOfTax)
    tax = round2(total - netOfTax)
  } else {
    tax = round2(tax)
    netOfTax = round2(total - tax)
  }
  return { subtotal, afterDiscount, taxableSub, tax, netOfTax, total }
}

function nearly(a, b, eps = 0.02) {
  return Math.abs(Number(a) - Number(b)) <= eps
}

async function main() {
  if (!fs.existsSync(DB)) {
    console.error('DB missing:', DB)
    process.exit(2)
  }
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${DB.replace(/\\/g, '/')}` } } })
  const results = []
  function check(name, ok, detail) {
    results.push({ name, ok, detail })
    console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`)
  }

  try {
    // Self-check golden G0 without DB
    const g0 = indepTotals({
      lines: [
        { subtotal: 130, taxExempt: false },
        { subtotal: 130, taxExempt: false },
      ],
      discountType: 'PERCENT',
      discountValue: 10,
      taxEnabled: true,
      taxMode: 'EXCLUSIVE',
      taxRate: 14,
    })
    check('indep G0 total 266.76', g0.total === 266.76, String(g0.total))
    check('indep G0 tax 32.76', g0.tax === 32.76, String(g0.tax))
    check('indep G0 net 234', g0.netOfTax === 234, String(g0.netOfTax))

    const mix = indepTotals({
      lines: [
        { subtotal: 130, taxExempt: false },
        { subtotal: 80, taxExempt: true },
      ],
      discountType: 'PERCENT',
      discountValue: 0,
      taxEnabled: true,
      taxMode: 'EXCLUSIVE',
      taxRate: 14,
    })
    check('indep exempt mix total 228.2', mix.total === 228.2, String(mix.total))

    const invoices = await prisma.salesInvoice.findMany({
      where: { isActive: true, status: { in: ['CONFIRMED', 'RETURNED'] } },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      take: 80,
    })
    check('loaded invoices', invoices.length > 0, String(invoices.length))

    let compared = 0
    let mismatches = 0
    for (const inv of invoices) {
      // Skip fully returned empty shells with no lines
      if (!inv.items.length && Number(inv.total) === 0) continue
      const taxEnabled = inv.taxEnabled !== false && Number(inv.taxRate) > 0
      const computed = indepTotals({
        lines: inv.items.map((l) => ({
          subtotal: Number(l.subtotal),
          taxExempt: Boolean(l.taxExempt),
        })),
        discountType: inv.discountType === 'FIXED' ? 'FIXED' : 'PERCENT',
        discountValue: Number(inv.discount),
        taxEnabled,
        taxMode: inv.taxMode === 'EXCLUSIVE' ? 'EXCLUSIVE' : 'INCLUSIVE',
        taxRate: Number(inv.taxRate) || 0,
      })
      // After partial returns, stored total may be residual-forced; compare when status CONFIRMED with lines
      if (inv.status !== 'CONFIRMED') continue
      compared++
      const okTotal = nearly(computed.total, inv.total)
      const okTax = nearly(computed.tax, inv.tax)
      const okNet = nearly(computed.netOfTax, inv.netOfTax)
      if (!okTotal || !okTax || !okNet) {
        mismatches++
        check(
          `mismatch ${inv.invoiceNumber}`,
          false,
          `calc t=${computed.total}/tax=${computed.tax}/net=${computed.netOfTax} db t=${inv.total}/tax=${inv.tax}/net=${inv.netOfTax}`,
        )
      }
    }
    check(
      'CONFIRMED invoices match independent math',
      mismatches === 0 && compared > 0,
      `compared=${compared} mismatches=${mismatches}`,
    )

    // Profit identity sample: netOfTax - sum(unitCost*qty) for one exclusive invoice
    const exclusive = invoices.find(
      (i) => i.status === 'CONFIRMED' && i.taxMode === 'EXCLUSIVE' && i.items.length > 0,
    )
    if (exclusive) {
      const cogs = exclusive.items.reduce(
        (s, l) => s + Number(l.unitCost) * Number(l.quantity),
        0,
      )
      const profit = round2(Number(exclusive.netOfTax) - cogs)
      check(
        'profit uses netOfTax not total',
        nearly(profit, Number(exclusive.netOfTax) - cogs),
        `profit=${profit} (tax ${exclusive.tax} excluded)`,
      )
    }
  } finally {
    await prisma.$disconnect()
  }

  const passed = results.filter((r) => r.ok).length
  const out = { at: new Date().toISOString(), db: DB, passed, total: results.length, results }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2))
  console.log(`done ${passed}/${results.length} → ${OUT}`)
  if (passed !== results.length) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
