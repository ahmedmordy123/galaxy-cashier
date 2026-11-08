import { z } from 'zod'
import { currencySchema } from './currency.schema'
import { dateOnly, idString, positiveNumber } from './zod-helpers'

export const createExpenseCategorySchema = z.object({
  nameAr: z.string().min(1).max(100),
  nameEn: z.string().min(1).max(100),
})
export const updateExpenseCategorySchema = createExpenseCategorySchema.partial()

export const createExpenseSchema = z.object({
  // Seed uses ids like expcat-salaries — not cuid
  categoryId: idString,
  amount: positiveNumber,
  currency: currencySchema,
  exchangeRate: positiveNumber.default(1),
  description: z.string().optional(),
  paidBy: z.string().optional(),
  notes: z.string().optional(),
  date: dateOnly,
})
export const updateExpenseSchema = createExpenseSchema.partial()

export type CreateExpenseCategoryInput = z.infer<typeof createExpenseCategorySchema>
export type UpdateExpenseCategoryInput = z.infer<typeof updateExpenseCategorySchema>
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>
