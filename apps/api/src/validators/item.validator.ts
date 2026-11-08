import { z } from 'zod'
import {
  flexibleDateTime,
  nonNegativeNumber,
  optionalId,
} from './zod-helpers'

export const createItemSchema = z
  .object({
    barcode: z.string().optional().nullable(),
    name_ar: z.string().min(1),
    name_en: z.string().optional().nullable(),
    unit: z.string().default('piece'),
    categoryId: optionalId,
    costPrice: nonNegativeNumber.default(0),
    retailPrice: nonNegativeNumber.default(0),
    wholesalePrice: nonNegativeNumber.default(0),
    specialPrice: nonNegativeNumber.default(0),
    dollarPrice: nonNegativeNumber.default(0),
    dinarPrice: nonNegativeNumber.default(0),
    stockQty: nonNegativeNumber.default(0),
    minimumStock: nonNegativeNumber.default(0),
    expiryDate: flexibleDateTime,
    supplierId: optionalId,
    isFavorite: z.boolean().optional().default(false),
    trackSerial: z.boolean().optional().default(false),
    warrantyMonths: z.coerce.number().int().min(0).optional().default(0),
    size: z.string().optional().nullable(),
    color: z.string().optional().nullable(),
    parentId: optionalId,
  })
  .transform((data) => ({
    ...data,
    name_en: data.name_en?.trim() ? data.name_en : data.name_ar,
  }))

export const updateItemSchema = z
  .object({
    barcode: z.string().optional().nullable(),
    name_ar: z.string().min(1).optional(),
    name_en: z.string().optional().nullable(),
    unit: z.string().optional(),
    categoryId: optionalId,
    costPrice: nonNegativeNumber.optional(),
    retailPrice: nonNegativeNumber.optional(),
    wholesalePrice: nonNegativeNumber.optional(),
    specialPrice: nonNegativeNumber.optional(),
    dollarPrice: nonNegativeNumber.optional(),
    dinarPrice: nonNegativeNumber.optional(),
    stockQty: nonNegativeNumber.optional(),
    minimumStock: nonNegativeNumber.optional(),
    expiryDate: flexibleDateTime,
    supplierId: optionalId,
    isFavorite: z.boolean().optional(),
    trackSerial: z.boolean().optional(),
    warrantyMonths: z.coerce.number().int().min(0).optional(),
    size: z.string().optional().nullable(),
    color: z.string().optional().nullable(),
    parentId: optionalId,
  })
  .transform((data) => {
    if (data.name_en !== undefined && (!data.name_en || !String(data.name_en).trim())) {
      if (data.name_ar) return { ...data, name_en: data.name_ar }
    }
    return data
  })

export type CreateItemInput = z.infer<typeof createItemSchema>
export type UpdateItemInput = z.infer<typeof updateItemSchema>

const priceFieldEnum = z.enum(['costPrice', 'retailPrice', 'wholesalePrice', 'specialPrice'])

export const bulkItemsSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('delete'),
    scope: z.enum(['selected', 'filtered', 'all']),
    itemIds: z.array(z.string().min(1)).optional(),
    search: z.string().optional(),
    categoryId: optionalId,
  }),
  z.object({
    action: z.literal('adjustPrices'),
    scope: z.enum(['selected', 'filtered', 'all']),
    itemIds: z.array(z.string().min(1)).optional(),
    search: z.string().optional(),
    categoryId: optionalId,
    fields: z.array(priceFieldEnum).min(1),
    mode: z.enum(['percent', 'amount', 'set']),
    value: z.coerce.number(),
  }),
])
