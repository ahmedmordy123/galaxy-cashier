import { z } from 'zod'
import { idString, positiveNumber } from './zod-helpers'

export const createStockTransferSchema = z.object({
  itemId: idString,
  type: z.enum(['IN', 'OUT']),
  reason: z.enum(['DAMAGE', 'ADJUSTMENT', 'TRANSFER', 'RETURN', 'EXPIRED']),
  quantity: positiveNumber,
  notes: z.string().optional(),
})

export type CreateStockTransferInput = z.infer<typeof createStockTransferSchema>
