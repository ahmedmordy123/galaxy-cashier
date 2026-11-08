import { Prisma, PrismaClient } from '@prisma/client'

type Tx = Prisma.TransactionClient | PrismaClient

export async function ensureDefaultWarehouse(tx: Tx) {
  let wh = await tx.warehouse.findFirst({ where: { isDefault: true, isActive: true } })
  if (!wh) {
    wh = await tx.warehouse.findFirst({ where: { isActive: true } })
  }
  if (!wh) {
    wh = await tx.warehouse.create({
      data: { name: 'المخزن الرئيسي', code: 'MAIN', isDefault: true },
    })
  }
  return wh
}

export async function getOrCreateBalance(tx: Tx, itemId: string, warehouseId: string) {
  const existing = await tx.stockBalance.findUnique({
    where: { itemId_warehouseId: { itemId, warehouseId } },
  })
  if (existing) return existing
  return tx.stockBalance.create({
    data: { itemId, warehouseId, qty: 0 },
  })
}

export async function syncItemStockQty(tx: Tx, itemId: string) {
  const rows = await tx.stockBalance.findMany({ where: { itemId } })
  const total = rows.reduce((s, r) => s + Number(r.qty), 0)
  await tx.item.update({
    where: { id: itemId },
    data: { stockQty: new Prisma.Decimal(total) },
  })
  return total
}

export function weightedAverageCost(
  oldQty: number,
  oldCost: number,
  addQty: number,
  addCost: number
): number {
  const totalQty = oldQty + addQty
  if (totalQty <= 0) return addCost
  return (oldQty * oldCost + addQty * addCost) / totalQty
}

/** Increase stock in warehouse + optional avg cost update on item */
export async function stockIn(
  tx: Tx,
  opts: {
    itemId: string
    warehouseId: string
    qty: number
    unitCost?: number
    updateAvgCost?: boolean
    type: string
    reason: string
    userId: string
    notes?: string
  }
) {
  const item = await tx.item.findUnique({ where: { id: opts.itemId } })
  if (!item) throw new Error(`ITEM_NOT_FOUND:${opts.itemId}`)

  await getOrCreateBalance(tx, opts.itemId, opts.warehouseId)
  await tx.stockBalance.update({
    where: { itemId_warehouseId: { itemId: opts.itemId, warehouseId: opts.warehouseId } },
    data: { qty: { increment: opts.qty } },
  })

  let avgCost = Number(item.costPrice)
  if (opts.updateAvgCost && opts.unitCost != null) {
    const oldQty = Number(item.stockQty)
    avgCost = weightedAverageCost(oldQty, avgCost, opts.qty, opts.unitCost)
    await tx.item.update({
      where: { id: opts.itemId },
      data: { costPrice: new Prisma.Decimal(avgCost) },
    })
  }

  await syncItemStockQty(tx, opts.itemId)

  await tx.stockTransfer.create({
    data: {
      type: opts.type,
      reason: opts.reason,
      itemId: opts.itemId,
      quantity: opts.qty,
      toWarehouseId: opts.warehouseId,
      avgCostAfter: avgCost,
      notes: opts.notes,
      createdById: opts.userId,
    },
  })

  return avgCost
}

/** Decrease stock in warehouse */
export async function stockOut(
  tx: Tx,
  opts: {
    itemId: string
    warehouseId: string
    qty: number
    type: string
    reason: string
    userId: string
    notes?: string
  }
) {
  const item = await tx.item.findUnique({ where: { id: opts.itemId } })
  if (!item) throw new Error(`ITEM_NOT_FOUND:${opts.itemId}`)

  await getOrCreateBalance(tx, opts.itemId, opts.warehouseId)

  const decremented = await tx.stockBalance.updateMany({
    where: {
      itemId: opts.itemId,
      warehouseId: opts.warehouseId,
      qty: { gte: opts.qty },
    },
    data: { qty: { decrement: opts.qty } },
  })
  if (decremented.count === 0) {
    throw new Error(`INSUFFICIENT_STOCK:${item.name_ar}:${item.name_en}`)
  }

  await syncItemStockQty(tx, opts.itemId)
  const avgCost = Number(item.costPrice)

  await tx.stockTransfer.create({
    data: {
      type: opts.type,
      reason: opts.reason,
      itemId: opts.itemId,
      quantity: opts.qty,
      fromWarehouseId: opts.warehouseId,
      avgCostAfter: avgCost,
      notes: opts.notes,
      createdById: opts.userId,
    },
  })

  return avgCost
}

export async function transferBetweenWarehouses(
  tx: Tx,
  opts: {
    itemId: string
    fromWarehouseId: string
    toWarehouseId: string
    qty: number
    userId: string
    notes?: string
  }
) {
  if (opts.fromWarehouseId === opts.toWarehouseId) {
    throw new Error('SAME_WAREHOUSE')
  }
  await stockOut(tx, {
    itemId: opts.itemId,
    warehouseId: opts.fromWarehouseId,
    qty: opts.qty,
    type: 'OUT',
    reason: 'TRANSFER',
    userId: opts.userId,
    notes: opts.notes || 'تحويل مخازن',
  })
  await stockIn(tx, {
    itemId: opts.itemId,
    warehouseId: opts.toWarehouseId,
    qty: opts.qty,
    type: 'IN',
    reason: 'TRANSFER',
    userId: opts.userId,
    notes: opts.notes || 'تحويل مخازن',
    updateAvgCost: false,
  })
}
