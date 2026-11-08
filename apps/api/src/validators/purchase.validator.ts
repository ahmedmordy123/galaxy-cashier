import { z } from 'zod'
import { currencySchema } from './currency.schema'
import {
  flexibleDateTime,
  idString,
  nonNegativeNumber,
  percentNumber,
  positiveNumber,
} from './zod-helpers'

export const purchaseLineSchema = z.object({
  itemId: idString,
  quantity: positiveNumber,
  unitCost: nonNegativeNumber,
  discount: percentNumber.default(0),
  expiryDate: flexibleDateTime,
})

export const createPurchaseInvoiceSchema = z.object({
  supplierId: idString,
  paymentType: z.enum(['CASH', 'CREDIT']).default('CREDIT'),
  currency: currencySchema,
  exchangeRate: positiveNumber.default(1),
  discount: nonNegativeNumber.default(0),
  notes: z.string().optional().nullable(),
  supplierRef: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? null : String(v).trim()),
    z.string().min(1).max(80).nullable().optional(),
  ),
  items: z.array(purchaseLineSchema).min(1),
})

export const updatePurchaseInvoiceSchema = createPurchaseInvoiceSchema.partial()

export type PurchaseLineInput = z.infer<typeof purchaseLineSchema>
export type CreatePurchaseInvoiceInput = z.infer<typeof createPurchaseInvoiceSchema>
export type UpdatePurchaseInvoiceInput = z.infer<typeof updatePurchaseInvoiceSchema>
