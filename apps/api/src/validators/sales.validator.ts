import { z } from 'zod'
import { currencySchema, priceTypeSchema } from './currency.schema'
import {
  idString,
  nonNegativeNumber,
  optionalId,
  percentNumber,
  positiveNumber,
} from './zod-helpers'

export const salesLineSchema = z.object({
  itemId: idString,
  quantity: positiveNumber,
  unitPrice: nonNegativeNumber,
  discount: percentNumber.default(0),
  serialNumber: z.preprocess(
    (v) => (v === '' ? null : v),
    z.string().nullable().optional()
  ),
})

export const createSalesInvoiceSchema = z.object({
  customerId: optionalId,
  warehouseId: optionalId,
  priceType: priceTypeSchema,
  paymentType: z.enum(['CASH', 'CREDIT']),
  currency: currencySchema,
  exchangeRate: positiveNumber.default(1),
  discountType: z.enum(['PERCENT', 'FIXED']).default('PERCENT'),
  discount: nonNegativeNumber.default(0),
  notes: z.string().optional(),
  items: z.array(salesLineSchema).min(1),
})

export const updateSalesInvoiceSchema = createSalesInvoiceSchema.partial()

export type CreateSalesInvoiceInput = z.infer<typeof createSalesInvoiceSchema>
export type UpdateSalesInvoiceInput = z.infer<typeof updateSalesInvoiceSchema>
export type SalesLineInput = z.infer<typeof salesLineSchema>
