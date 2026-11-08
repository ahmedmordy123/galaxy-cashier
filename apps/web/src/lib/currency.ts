/** CASR — Egyptian Pound only */

export const CURRENCY_CODE = 'EGP' as const
export const CURRENCY_SYMBOL = 'ج.م'
export const LOCALE = 'en-EG'

export type Currency = typeof CURRENCY_CODE

/**
 * Format numbers for display: Latin digits, no trailing .000
 * 1000 → "1000", 1000.5 → "1000.5", 1000.567 → "1000.57"
 */
export function formatNumber(amount: number | string, decimals?: number): string {
  const n = Number(amount)
  if (!Number.isFinite(n)) return '0'

  // Explicit decimals (legacy callers) — still strip trailing zeros look by using max only when needed
  if (decimals != null && decimals > 0) {
    const fixed = n.toFixed(decimals)
    const trimmed = fixed.replace(/\.?0+$/, '')
    return trimmed
  }

  const isInt = Math.abs(n - Math.round(n)) < 1e-9
  if (isInt) return String(Math.round(n))

  // Up to 2 decimals, trim trailing zeros
  const fixed = n.toFixed(2).replace(/\.?0+$/, '')
  return fixed
}

export function formatMoney(amount: number | string, decimals?: number): string {
  return `${formatNumber(amount, decimals)} ${CURRENCY_SYMBOL}`
}

export function currencyLabel(): string {
  return 'جنيه مصري'
}

/** Map legacy IQD/USD stored values to display label */
export function displayCurrency(_code?: string): string {
  return CURRENCY_SYMBOL
}

export function displayCurrencyName(_code?: string): string {
  return currencyLabel()
}
