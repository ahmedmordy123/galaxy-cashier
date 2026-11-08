import { z } from 'zod'
import { currencySchema } from './currency.schema'
import { idString, optionalId, positiveNumber } from './zod-helpers'

export const createVoucherSchema = z.object({
  type: z.enum(['DISBURSEMENT', 'RECEIPT']),
  entityType: z.enum(['CUSTOMER', 'SUPPLIER', 'OTHER']).default('OTHER'),
  entityId: optionalId,
  amount: positiveNumber,
  currency: currencySchema,
  exchangeRate: positiveNumber.default(1),
  description: z.string().min(1),
})

export type CreateVoucherInput = z.infer<typeof createVoucherSchema>
