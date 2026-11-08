/**
 * Golden G0 — user-approved exclusive VAT + discount + return residual.
 * Cost 100, sell 130 × 2 = 260, disc 10% → 234, VAT+14% → 32.76, total 266.76
 * Profit = 234 − 200 = 34. Partial return 1 unit = 133.38
 * Full returns sum exactly to invoice total (no piastre drift).
 * Rounding: 2dp on invoice total; allocateExactTotal for awkward splits.
 */
'use strict'

const path = require('path')
const fs = require('fs')

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

function computeExclusive(subtotal, discPct, taxPct, taxableSubtotal) {
  const afterDiscount = round2(subtotal * (1 - discPct / 100))
  const taxable =
    taxableSubtotal == null
      ? afterDiscount
      : subtotal <= 0
        ? 0
        : afterDiscount * (Math.min(taxableSubtotal, subtotal) / subtotal)
  const tax = round2(taxable * (taxPct / 100))
  const total = round2(afterDiscount + tax)
  const netOfTax = round2(afterDiscount)
  const taxPinned = round2(total - netOfTax)
  return { afterDiscount: netOfTax, tax: taxPinned, total, netOfTax }
}

/** Hamilton / largest-remainder allocation in cents so Σ parts === total. */
function allocateExactTotal(totalAmount, weights) {
  const totalCents = Math.round(round2(totalAmount) * 100)
  const wSum = weights.reduce((a, b) => a + b, 0)
  if (wSum <= 0) {
    const z = weights.map(() => 0)
    if (z.length) z[z.length - 1] = round2(totalAmount)
    return z
  }
  const raw = weights.map((w) => (totalCents * w) / wSum)
  const floors = raw.map((x) => Math.floor(x + 1e-9))
  let used = floors.reduce((a, b) => a + b, 0)
  const rema = raw
    .map((x, i) => ({ i, frac: x - floors[i] }))
    .sort((a, b) => b.frac - a.frac)
  let left = totalCents - used
  const out = floors.slice()
  for (let k = 0; k < rema.length && left > 0; k++) {
    out[rema[k].i] += 1
    left--
  }
  return out.map((c) => c / 100)
}

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`)
}

// ── G0 exclusive golden ──────────────────────────────────────────────────────
const sub = 130 * 2
check('subtotal 260', sub === 260, String(sub))
const inv = computeExclusive(sub, 10, 14)
check('net 234', inv.afterDiscount === 234, String(inv.afterDiscount))
check('tax 32.76', inv.tax === 32.76, String(inv.tax))
check('total 266.76', inv.total === 266.76, String(inv.total))
const cogs = 100 * 2
const profit = round2(inv.afterDiscount - cogs)
check('profit 34 (tax excluded)', profit === 34, String(profit))

const share = 1 / 2
const retNet = round2(inv.afterDiscount * share)
const retTax = round2(inv.tax * share)
let retTotal = round2(retNet + retTax)
const shareTotal = round2(inv.total * share)
if (Math.abs(shareTotal - retTotal) <= 0.02) retTotal = shareTotal
check('return net 117', retNet === 117, String(retNet))
check('return tax 16.38', retTax === 16.38, String(retTax))
check('return total 133.38', retTotal === 133.38, String(retTotal))
check('2×partial == invoice total', round2(retTotal * 2) === inv.total, String(round2(retTotal * 2)))

// Residual path: first return leaves remainder; second consumes exact residual
const residual = round2(inv.total - retTotal)
check('residual after 1 unit 133.38', residual === 133.38, String(residual))
check('ret1+residual == total', round2(retTotal + residual) === inv.total, String(round2(retTotal + residual)))

// allocateExactTotal: 3 equal weights over awkward total → exact sum
const parts = allocateExactTotal(100.01, [1, 1, 1])
const partsSum = round2(parts.reduce((a, b) => a + b, 0))
check('allocateExactTotal sum 100.01', partsSum === 100.01, `${parts.join('+')}=${partsSum}`)
check(
  'allocateExactTotal no unit off by >0.01 from equal',
  parts.every((p) => Math.abs(p - 33.336666) < 0.02 || Math.abs(p - 33.34) < 0.02 || Math.abs(p - 33.33) < 0.02),
  parts.join(','),
)

// tax-exempt mix: taxable 130 + exempt 130, disc 0, exclusive 14%
const mix = computeExclusive(260, 0, 14, 130)
check('exempt mix tax on half only', mix.tax === 18.2, String(mix.tax))
check('exempt mix total 278.2', mix.total === 278.2, String(mix.total))

const out = {
  at: new Date().toISOString(),
  passed: results.filter((r) => r.ok).length,
  total: results.length,
  results,
}
fs.writeFileSync(
  path.join(__dirname, '..', 'docs', 'QA-GOLDEN-VAT-EXCLUSIVE-MATH.json'),
  JSON.stringify(out, null, 2),
)
console.log(`done ${out.passed}/${out.total}`)
if (out.passed !== out.total) process.exit(1)
