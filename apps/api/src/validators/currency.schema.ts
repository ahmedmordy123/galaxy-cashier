import { z } from 'zod'

/** Accept legacy values; always store EGP */
export const currencySchema = z
  .enum(['EGP', 'IQD', 'USD'])
  .default('EGP')
  .transform(() => 'EGP' as const)

export const priceTypeSchema = z
  .enum(['RETAIL', 'WHOLESALE', 'SPECIAL', 'DOLLAR', 'DINAR'])
  .transform((v) => (v === 'DOLLAR' || v === 'DINAR' ? 'RETAIL' : v) as 'RETAIL' | 'WHOLESALE' | 'SPECIAL')
