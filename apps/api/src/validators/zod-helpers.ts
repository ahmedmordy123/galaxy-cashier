import { z } from 'zod'

/** "" / undefined → null for optional relation IDs */
export function emptyToNull(value: unknown): unknown {
  if (value === '' || value === undefined) return null
  return value
}

/** Accept seed IDs (expcat-*) and Prisma cuids alike */
export const idString = z.string().min(1)

export const optionalId = z.preprocess(
  emptyToNull,
  z.string().min(1).nullable().optional()
)

export const positiveNumber = z.coerce.number().positive()
export const nonNegativeNumber = z.coerce.number().nonnegative()
export const percentNumber = z.coerce.number().min(0).max(100)

/** Accept YYYY-MM-DD or full ISO datetime; normalize date-only to ISO midnight UTC */
export const flexibleDateTime = z.preprocess((value) => {
  if (value === '' || value === null || value === undefined) return null
  if (typeof value !== 'string') return value
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00.000Z`
  return value
}, z.string().datetime().nullable().optional())

/** Strict calendar day YYYY-MM-DD */
export const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ غير صالح')
