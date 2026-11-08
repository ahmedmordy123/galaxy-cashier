/** CASR — Egyptian Pound only */

export const CURRENCY_CODE = 'EGP' as const
export const DEFAULT_EXCHANGE_RATE = 1

export function normalizeCurrency(_value?: string): typeof CURRENCY_CODE {
  return CURRENCY_CODE
}
