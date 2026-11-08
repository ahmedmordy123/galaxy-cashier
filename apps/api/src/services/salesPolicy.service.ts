import { Decimal } from '@prisma/client/runtime/library'
import { prisma } from '../db/prisma'
import {
  parseTaxMode,
  safeDecimal,
  type TaxMode,
} from '../utils/salesTotals'

export type BelowCostPolicy = 'BLOCK' | 'WARN'

export interface TaxPolicySnapshot {
  vatEnabled: boolean
  taxMode: TaxMode
  taxPct: Decimal
  belowCostPolicy: BelowCostPolicy
}

export async function getTaxPolicySnapshot(): Promise<TaxPolicySnapshot> {
  const rows = await prisma.settings.findMany({
    where: { key: { in: ['vat_enabled', 'tax_mode', 'tax_rate', 'below_cost_policy'] } },
  })
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  const vatEnabled = (map.vat_enabled ?? 'true') !== 'false'
  const taxMode = parseTaxMode(map.tax_mode)
  const taxPct = vatEnabled ? safeDecimal(map.tax_rate, 14) : new Decimal(0)
  const belowCostPolicy: BelowCostPolicy =
    map.below_cost_policy === 'BLOCK' ? 'BLOCK' : 'WARN'
  return { vatEnabled, taxMode, taxPct, belowCostPolicy }
}

export function catalogUnitPrice(
  item: {
    retailPrice: unknown
    wholesalePrice?: unknown
    specialPrice?: unknown
    dollarPrice?: unknown
    dinarPrice?: unknown
  },
  priceType: string,
): number {
  const pick =
    priceType === 'WHOLESALE'
      ? item.wholesalePrice
      : priceType === 'SPECIAL'
        ? item.specialPrice
        : priceType === 'DOLLAR'
          ? item.dollarPrice
          : priceType === 'DINAR'
            ? item.dinarPrice
            : item.retailPrice
  const n = Number(pick)
  return Number.isFinite(n) ? n : Number(item.retailPrice) || 0
}

export function assertCanEditPrice(user: {
  id: string
  role: string
  canEditPrice?: boolean
}): void {
  if (user.role === 'ADMIN' || user.role === 'MANAGER') return
  if (user.canEditPrice) return
  const err = new Error('PRICE_OVERRIDE_FORBIDDEN') as Error & { statusCode: number; code?: string }
  err.statusCode = 403
  err.code = 'PRICE_OVERRIDE_FORBIDDEN'
  throw err
}

export async function userMayEditPrice(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) return false
  if (user.role === 'ADMIN' || user.role === 'MANAGER') return true
  return Boolean((user as { canEditPrice?: boolean }).canEditPrice)
}
