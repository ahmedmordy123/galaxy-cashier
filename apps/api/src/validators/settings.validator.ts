import { z } from 'zod'
import { priceTypeSchema } from './currency.schema'

export const updateSettingsSchema = z.object({
  business_name_ar: z.string().optional(),
  business_name_en: z.string().optional(),
  business_address: z.string().optional(),
  business_phone: z.string().optional(),
  invoice_footer_ar: z.string().optional(),
  invoice_footer_en: z.string().optional(),
  default_currency: z.enum(['EGP', 'IQD', 'USD']).optional().transform(() => 'EGP'),
  default_price_type: priceTypeSchema.optional(),
  tax_rate: z.union([z.string(), z.number()]).optional().transform((v) => {
    if (v === undefined) return undefined
    const n = Number(v)
    return String(Number.isFinite(n) ? n : 0)
  }),
  /** Master switch for VAT on new invoices */
  vat_enabled: z.enum(['true', 'false']).optional(),
  /** INCLUSIVE | EXCLUSIVE — snapshot onto each invoice */
  tax_mode: z.enum(['INCLUSIVE', 'EXCLUSIVE']).optional(),
  /** BLOCK = reject below-cost sales; WARN = require belowCostConfirmed */
  below_cost_policy: z.enum(['BLOCK', 'WARN']).optional(),
  paper_width: z.enum(['58', '80', 'A4']).optional(),
  minimum_stock_alert: z.enum(['true', 'false']).optional(),
  invoice_marketing_enabled: z.enum(['true', 'false']).optional(),
  invoice_marketing_brand: z.string().optional(),
  invoice_facebook_handle: z.string().optional(),
  auto_backup_enabled: z.enum(['true', 'false']).optional(),
  auto_backup_interval_hours: z.union([z.string(), z.number()]).optional(),
  auto_backup_keep_count: z.union([z.string(), z.number()]).optional(),
  /** Absolute path for backups (empty = default Documents\\CASR-Backups) */
  backup_directory: z.string().max(500).optional(),
  /** Optional second absolute path (USB / external folder); best-effort mirror */
  backup_directory_secondary: z.string().max(500).optional(),
  /** Copy DB when the desktop app closes */
  backup_on_exit: z.enum(['true', 'false']).optional(),
  backup_path_drive_warning: z.enum(['true', 'false']).optional(),
})
export const updateExchangeRateSchema = z.object({
  rate: z.number().positive().min(1),
})

const ALL_ROLES = ['ADMIN', 'MANAGER', 'CASHIER', 'VIEWER', 'ACCOUNTANT', 'STAFF'] as const

export const createUserSchema = z.object({
  name: z.string().min(2).max(100),
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(6),
  role: z.enum(ALL_ROLES),
  language: z.enum(['ar', 'en']).default('ar'),
  canEditPrice: z.boolean().optional().default(false),
})

export const updateUserSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  role: z.enum(ALL_ROLES).optional(),
  language: z.enum(['ar', 'en']).optional(),
  isActive: z.boolean().optional(),
  canEditPrice: z.boolean().optional(),
})

export const resetPasswordSchema = z.object({
  newPassword: z.string().min(6),
})

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>
export type UpdateExchangeRateInput = z.infer<typeof updateExchangeRateSchema>
export type CreateUserInput = z.infer<typeof createUserSchema>
export type UpdateUserInput = z.infer<typeof updateUserSchema>
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>
