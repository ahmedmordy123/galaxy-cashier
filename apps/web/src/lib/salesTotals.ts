export type DiscountType = 'PERCENT' | 'FIXED'
export type TaxMode = 'INCLUSIVE' | 'EXCLUSIVE'

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function computeInvoiceTotals(
  subtotal: number,
  discountType: DiscountType,
  discountValue: number,
  taxPct: number,
  opts?: { taxMode?: TaxMode; taxEnabled?: boolean; taxableSubtotal?: number },
) {
  const taxMode = opts?.taxMode ?? 'INCLUSIVE'
  const taxEnabled = opts?.taxEnabled !== false && taxPct > 0

  let afterDiscount = subtotal
  if (discountType === 'FIXED') {
    afterDiscount = Math.max(0, subtotal - discountValue)
  } else {
    afterDiscount = subtotal * (1 - discountValue / 100)
  }

  const taxableSub = Math.max(0, Math.min(opts?.taxableSubtotal ?? subtotal, subtotal))
  const taxableAfterDiscount =
    subtotal <= 0 || taxableSub <= 0 ? 0 : afterDiscount * (taxableSub / subtotal)

  let tax = 0
  let netOfTax = afterDiscount
  let total = afterDiscount

  if (taxEnabled) {
    if (taxMode === 'EXCLUSIVE') {
      netOfTax = afterDiscount
      tax = taxableAfterDiscount * (taxPct / 100)
      total = afterDiscount + tax
    } else {
      tax = taxableAfterDiscount * (taxPct / (100 + taxPct))
      netOfTax = afterDiscount - tax
      total = afterDiscount
    }
  }

  total = round2(total)
  if (taxMode === 'EXCLUSIVE' && taxEnabled) {
    netOfTax = round2(netOfTax)
    tax = round2(total - netOfTax)
  } else {
    tax = round2(tax)
    netOfTax = round2(total - tax)
  }

  return {
    subtotal,
    afterDiscount: round2(afterDiscount),
    netOfTax,
    tax,
    total,
    discountAmount: round2(subtotal - afterDiscount),
    taxMode,
    taxEnabled,
  }
}

/** @deprecated */
export function computeInclusiveTotals(
  subtotal: number,
  discountType: DiscountType,
  discountValue: number,
  taxPct: number,
) {
  return computeInvoiceTotals(subtotal, discountType, discountValue, taxPct, {
    taxMode: 'INCLUSIVE',
    taxEnabled: taxPct > 0,
  })
}
