import { Decimal } from '@prisma/client/runtime/library'

export type DiscountType = 'PERCENT' | 'FIXED'
export type TaxMode = 'INCLUSIVE' | 'EXCLUSIVE'

export function safeDecimal(value: unknown, fallback = 0): Decimal {
  if (value === null || value === undefined) return new Decimal(fallback)
  if (typeof value === 'number' && Number.isFinite(value)) return new Decimal(value)
  if (typeof value === 'string') {
    const trimmed = value.trim().replace(/,/g, '')
    if (!trimmed) return new Decimal(fallback)
    const n = Number(trimmed)
    if (!Number.isFinite(n)) return new Decimal(fallback)
    return new Decimal(n)
  }
  try {
    return new Decimal(value as string | number)
  } catch {
    return new Decimal(fallback)
  }
}

/** Round money to 2 decimal places (piastres) — half-up. */
export function roundMoney(value: Decimal | number | string): Decimal {
  return safeDecimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
}

export function parseDiscountType(raw: unknown): DiscountType {
  return raw === 'FIXED' ? 'FIXED' : 'PERCENT'
}

export function parseTaxMode(raw: unknown): TaxMode {
  return raw === 'EXCLUSIVE' ? 'EXCLUSIVE' : 'INCLUSIVE'
}

export function applyInvoiceDiscount(
  linesSubtotal: Decimal,
  discountType: DiscountType,
  discountValue: Decimal,
): Decimal {
  if (discountType === 'FIXED') {
    return Decimal.max(new Decimal(0), linesSubtotal.minus(discountValue))
  }
  return linesSubtotal.mul(new Decimal(1).minus(discountValue.div(100)))
}

/**
 * Invoice totals.
 * - Discount first (always).
 * - INCLUSIVE: tax extracted from after-discount; customer pays afterDiscount.
 * - EXCLUSIVE: tax = afterDiscount × rate%; customer pays afterDiscount + tax.
 * - Rounding applied on final `total` (2 dp); tax adjusted so net+tax = total.
 */
export function computeInvoiceTotals(opts: {
  linesSubtotal: Decimal
  /** Subtotal of non–tax-exempt lines only. Defaults to full linesSubtotal. */
  taxableLinesSubtotal?: Decimal
  discountType: DiscountType
  discountValue: Decimal
  taxPct: Decimal
  taxMode?: TaxMode
  taxEnabled?: boolean
}) {
  const {
    linesSubtotal,
    taxableLinesSubtotal,
    discountType,
    discountValue,
    taxPct,
    taxMode = 'INCLUSIVE',
    taxEnabled = true,
  } = opts
  const subtotal = linesSubtotal
  const afterDiscount = applyInvoiceDiscount(subtotal, discountType, discountValue)
  const effectivePct = taxEnabled && taxPct.gt(0) ? taxPct : new Decimal(0)
  const taxableSub = taxableLinesSubtotal ?? linesSubtotal
  // Discount allocated proportionally — tax applies only to the taxable share
  const taxableAfterDiscount =
    subtotal.lte(0) || taxableSub.lte(0)
      ? new Decimal(0)
      : afterDiscount.mul(Decimal.min(taxableSub, subtotal)).div(subtotal)

  let tax: Decimal
  let totalRaw: Decimal
  let netOfTax: Decimal

  if (effectivePct.lte(0)) {
    tax = new Decimal(0)
    netOfTax = afterDiscount
    totalRaw = afterDiscount
  } else if (taxMode === 'EXCLUSIVE') {
    netOfTax = afterDiscount
    tax = taxableAfterDiscount.mul(effectivePct).div(100)
    totalRaw = afterDiscount.plus(tax)
  } else {
    // INCLUSIVE: afterDiscount is what customer pays; extract VAT from taxable share only
    const divisor = new Decimal(100).plus(effectivePct)
    tax = taxableAfterDiscount.mul(effectivePct).div(divisor)
    netOfTax = afterDiscount.minus(tax)
    totalRaw = afterDiscount
  }

  const total = roundMoney(totalRaw)
  // Keep identity: for exclusive, tax = total - net (rounded); for inclusive tax extracted then net = total - tax
  let taxRounded: Decimal
  let netRounded: Decimal
  if (taxMode === 'EXCLUSIVE' && effectivePct.gt(0)) {
    netRounded = roundMoney(netOfTax)
    taxRounded = roundMoney(total.minus(netRounded))
    // If rounding drifted, pin tax so net+tax=total
    if (!netRounded.plus(taxRounded).eq(total)) {
      taxRounded = total.minus(netRounded)
    }
  } else if (effectivePct.gt(0)) {
    taxRounded = roundMoney(tax)
    netRounded = roundMoney(total.minus(taxRounded))
  } else {
    taxRounded = new Decimal(0)
    netRounded = total
  }

  return {
    subtotal,
    afterDiscount: roundMoney(afterDiscount),
    netOfTax: netRounded,
    tax: taxRounded,
    total,
    discountValue,
    taxMode,
    taxEnabled: effectivePct.gt(0),
  }
}

/** @deprecated use computeInvoiceTotals — kept for call sites during migration */
export function computeInclusiveInvoiceTotals(opts: {
  linesSubtotal: Decimal
  discountType: DiscountType
  discountValue: Decimal
  taxPct: Decimal
}) {
  return computeInvoiceTotals({ ...opts, taxMode: 'INCLUSIVE', taxEnabled: opts.taxPct.gt(0) })
}

/**
 * Proportional return of one share of an invoice (by line-subtotal share).
 * Returns { returnNet, returnTax, returnTotal } rounded; caller should
 * settle remainder on the last return so full returns == invoice.total.
 */
export function proportionalReturnShare(opts: {
  returnLinesSubtotal: Decimal
  invoiceSubtotal: Decimal
  invoiceNetOfTax: Decimal
  invoiceTax: Decimal
  invoiceTotal: Decimal
  discountType: DiscountType
  discountValue: Decimal
  taxPct: Decimal
  taxMode: TaxMode
  taxEnabled: boolean
}) {
  const {
    returnLinesSubtotal,
    invoiceSubtotal,
    invoiceNetOfTax,
    invoiceTax,
    invoiceTotal,
  } = opts

  if (invoiceSubtotal.lte(0) || invoiceTotal.lte(0)) {
    return {
      returnNet: new Decimal(0),
      returnTax: new Decimal(0),
      returnTotal: new Decimal(0),
      share: new Decimal(0),
    }
  }

  const share = returnLinesSubtotal.div(invoiceSubtotal)
  const returnNet = roundMoney(invoiceNetOfTax.mul(share))
  const returnTax = roundMoney(invoiceTax.mul(share))
  let returnTotal = roundMoney(returnNet.plus(returnTax))
  // Prefer exact share of invoice total when it matches (exclusive golden case)
  const shareTotal = roundMoney(invoiceTotal.mul(share))
  if (shareTotal.minus(returnTotal).abs().lte(new Decimal('0.02'))) {
    returnTotal = shareTotal
  }

  return { returnNet, returnTax, returnTotal, share }
}

/** Legacy wrapper — returns returnTotal only (inclusive-era callers). */
export function proportionalReturnTotalInclusive(opts: {
  returnLinesSubtotal: Decimal
  invoiceSubtotal: Decimal
  discountType: DiscountType
  discountValue: Decimal
  taxPct: Decimal
}) {
  const after = applyInvoiceDiscount(opts.invoiceSubtotal, opts.discountType, opts.discountValue)
  const computed = computeInvoiceTotals({
    linesSubtotal: opts.invoiceSubtotal,
    discountType: opts.discountType,
    discountValue: opts.discountValue,
    taxPct: opts.taxPct,
    taxMode: 'INCLUSIVE',
    taxEnabled: opts.taxPct.gt(0),
  })
  const share = opts.invoiceSubtotal.lte(0)
    ? new Decimal(0)
    : opts.returnLinesSubtotal.div(opts.invoiceSubtotal)
  // Inclusive: customer-paid total == afterDiscount
  return roundMoney(computed.total.mul(share))
}

/**
 * Allocate `totalAmount` across `weights` (e.g. line shares) so sum(parts) === totalAmount
 * exactly (largest remainder / Hamilton method on cents).
 */
export function allocateExactTotal(totalAmount: Decimal, weights: Decimal[]): Decimal[] {
  const n = weights.length
  if (n === 0) return []
  const totalCents = roundMoney(totalAmount).mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()
  const wSum = weights.reduce((a, b) => a.plus(b), new Decimal(0))
  if (wSum.lte(0)) {
    const zeros = weights.map(() => new Decimal(0))
    zeros[n - 1] = roundMoney(totalAmount)
    return zeros
  }
  const raw = weights.map((w) => (totalCents * w.toNumber()) / wSum.toNumber())
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
  return out.map((c) => new Decimal(c).div(100))
}
