export type DiscountType = 'PERCENT' | 'FIXED'

export function computeInclusiveTotals(
  subtotal: number,
  discountType: DiscountType,
  discountValue: number,
  taxPct: number,
) {
  let afterDiscount = subtotal
  if (discountType === 'FIXED') {
    afterDiscount = Math.max(0, subtotal - discountValue)
  } else {
    afterDiscount = subtotal * (1 - discountValue / 100)
  }
  const tax =
    taxPct <= 0 ? 0 : afterDiscount * (taxPct / (100 + taxPct))
  const total = afterDiscount
  return { subtotal, afterDiscount, tax, total, discountAmount: subtotal - afterDiscount }
}
