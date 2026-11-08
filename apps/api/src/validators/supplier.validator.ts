import { z } from 'zod'
import { currencySchema } from './currency.schema'

export const createSupplierSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  currency: currencySchema,
  notes: z.string().optional().nullable(),
})

export const updateSupplierSchema = createSupplierSchema.partial()
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>
