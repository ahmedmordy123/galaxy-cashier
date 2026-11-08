import { Decimal } from '@prisma/client/runtime/library'

export type DiscountType = 'PERCENT' | 'FIXED'

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

/** Prices are tax-inclusive. Extract embedded VAT and keep total = amount customer pays. */
export function computeInclusiveInvoiceTotals(opts: {
  linesSubtotal: Decimal
  discountType: DiscountType
  discountValue: Decimal
  taxPct: Decimal
}) {
  const { linesSubtotal, discountType, discountValue, taxPct } = opts
  const subtotal = linesSubtotal

  let afterDiscount: Decimal
  if (discountType === 'FIXED') {
    afterDiscount = Decimal.max(new Decimal(0), subtotal.minus(discountValue))
  } else {
    afterDiscount = subtotal.mul(new Decimal(1).minus(discountValue.div(100)))
  }

  const divisor = new Decimal(100).plus(taxPct)
  const tax =
    taxPct.lte(0) || divisor.lte(0)
      ? new Decimal(0)
      : afterDiscount.mul(taxPct).div(divisor)

  const total = afterDiscount

  return { subtotal, afterDiscount, tax, total, discountValue }
}

export function proportionalReturnTotalInclusive(opts: {
  returnLinesSubtotal: Decimal
  invoiceSubtotal: Decimal
  discountType: DiscountType
  discountValue: Decimal
  taxPct: Decimal
}) {
  const { returnLinesSubtotal, invoiceSubtotal, discountType, discountValue, taxPct } = opts
  if (invoiceSubtotal.lte(0)) {
    return computeInclusiveInvoiceTotals({
      linesSubtotal: returnLinesSubtotal,
      discountType: 'PERCENT',
      discountValue: new Decimal(0),
      taxPct,
    }).total
  }

  let invoiceAfterDiscount: Decimal
  if (discountType === 'FIXED') {
    invoiceAfterDiscount = Decimal.max(new Decimal(0), invoiceSubtotal.minus(discountValue))
  } else {
    invoiceAfterDiscount = invoiceSubtotal.mul(new Decimal(1).minus(discountValue.div(100)))
  }

  const share = returnLinesSubtotal.div(invoiceSubtotal)
  const returnAfterDiscount =
    discountType === 'FIXED'
      ? invoiceAfterDiscount.mul(share)
      : returnLinesSubtotal.mul(new Decimal(1).minus(discountValue.div(100)))

  const divisor = new Decimal(100).plus(taxPct)
  const returnTotal = returnAfterDiscount
  return returnTotal
}

export function parseDiscountType(raw: unknown): DiscountType {
  return raw === 'FIXED' ? 'FIXED' : 'PERCENT'
}
