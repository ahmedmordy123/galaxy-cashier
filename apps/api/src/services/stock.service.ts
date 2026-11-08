import { Prisma } from '@prisma/client'
import { CreateStockTransferInput } from '../validators/stock.validator'
import { ensureDefaultWarehouse, stockIn, stockOut } from './stock-ops.service'
import { prisma } from '../db/prisma'

export async function getStockTransfers(params: {
  page?: number
  limit?: number
  itemId?: string
  type?: string
  reason?: string
  from?: string
  to?: string
}) {
  const { page = 1, limit = 20, itemId, type, reason, from, to } = params
  const skip = (page - 1) * limit

  const where: Record<string, unknown> = {}
  if (itemId) where.itemId = itemId
  if (type) where.type = type
  if (reason) where.reason = reason
  if (from || to) {
    const dateFilter: Record<string, Date> = {}
    if (from) dateFilter.gte = new Date(from)
    if (to) dateFilter.lte = new Date(to)
    where.createdAt = dateFilter
  }

  const [data, total] = await Promise.all([
    prisma.stockTransfer.findMany({
      where: where as Prisma.StockTransferWhereInput,
      include: {
        item: {
          select: { id: true, name_ar: true, name_en: true, barcode: true, unit: true },
        },
        createdBy: {
          select: { id: true, name: true },
        },
        fromWarehouse: { select: { id: true, name: true } },
        toWarehouse: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.stockTransfer.count({
      where: where as Prisma.StockTransferWhereInput,
    }),
  ])

  return { data, total, page, limit }
}

export async function createStockTransfer(data: CreateStockTransferInput, userId: string) {
  const wh = await ensureDefaultWarehouse(prisma)
  return prisma.$transaction(async (tx) => {
    if (data.type === 'IN') {
      await stockIn(tx, {
        itemId: data.itemId,
        warehouseId: wh.id,
        qty: Number(data.quantity),
        type: 'IN',
        reason: data.reason,
        userId,
        notes: data.notes,
        updateAvgCost: false,
      })
    } else {
      await stockOut(tx, {
        itemId: data.itemId,
        warehouseId: wh.id,
        qty: Number(data.quantity),
        type: 'OUT',
        reason: data.reason,
        userId,
        notes: data.notes,
      })
    }
    return tx.stockTransfer.findFirst({
      where: { itemId: data.itemId, createdById: userId },
      orderBy: { createdAt: 'desc' },
      include: {
        item: {
          select: { id: true, name_ar: true, name_en: true, barcode: true, unit: true },
        },
        createdBy: { select: { id: true, name: true } },
      },
    })
  })
}

export async function getInventory(params: {
  search?: string
  categoryId?: string
  lowStock?: boolean
}) {
  const { search, categoryId, lowStock } = params

  const where: Record<string, unknown> = { isActive: true }

  if (search) {
    where.OR = [
      { name_ar: { contains: search } },
      { name_en: { contains: search } },
      { barcode: { contains: search } },
    ]
  }

  if (categoryId) where.categoryId = categoryId

  if (lowStock) {
    const ids = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Item"
      WHERE "isActive" = true
        AND "minimumStock" > 0
        AND "stockQty" <= "minimumStock"
    `
    where.id = { in: ids.map((r) => r.id) }
  }

  const items = await prisma.item.findMany({
    where: where as Prisma.ItemWhereInput,
    include: { category: true },
    orderBy: { name_ar: 'asc' },
  })

  return items.map((item) => {
    const qty = Number(item.stockQty)
    const cost = Number(item.costPrice)
    const retail = Number(item.retailPrice)
    return {
      ...item,
      costValue: qty * cost,
      retailValue: qty * retail,
    }
  })
}

export async function getLowStockItems() {
  const ids = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Item"
    WHERE "isActive" = true
      AND "minimumStock" > 0
      AND "stockQty" <= "minimumStock"
  `

  if (ids.length === 0) return []

  return prisma.item.findMany({
    where: { id: { in: ids.map((r) => r.id) } },
    include: { category: true },
    orderBy: { stockQty: 'asc' },
  })
}

export async function getExpiringItems(days: number) {
  const threshold = new Date()
  threshold.setDate(threshold.getDate() + days)

  return prisma.item.findMany({
    where: {
      isActive: true,
      expiryDate: { not: null, lte: threshold },
    },
    include: { category: true },
    orderBy: { expiryDate: 'asc' },
  })
}
