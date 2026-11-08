import { z } from 'zod'
import { currencySchema } from './currency.schema'
import { dateOnly, idString, positiveNumber } from './zod-helpers'

export const createStaffAdvanceSchema = z.object({
  employeeId: idString,
  amount: positiveNumber,
  currency: currencySchema,
  exchangeRate: positiveNumber.default(1),
  date: dateOnly,
  notes: z.string().max(500).optional(),
})

export type CreateStaffAdvanceInput = z.infer<typeof createStaffAdvanceSchema>
