import { Decimal } from '@prisma/client/runtime/library'

type PriceType = 'RETAIL' | 'WHOLESALE' | 'SPECIAL' | 'DINAR' | 'DOLLAR'

export function resolvePrice(
  item: {
    retailPrice: Decimal
    wholesalePrice: Decimal
    specialPrice: Decimal
    dollarPrice: Decimal
    dinarPrice: Decimal
  },
  priceType: PriceType,
  _currency?: string,
  _exchangeRate?: Decimal
): Decimal {
  switch (priceType) {
    case 'RETAIL':
    case 'DINAR':
    case 'DOLLAR':
      return item.retailPrice
    case 'WHOLESALE':
      return item.wholesalePrice
    case 'SPECIAL':
      return item.specialPrice
    default:
      return item.retailPrice
  }
}
