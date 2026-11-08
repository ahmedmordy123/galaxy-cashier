
import { ensureDefaultWarehouse, transferBetweenWarehouses, stockIn, stockOut } from './stock-ops.service'
import { prisma } from '../db/prisma'

export async function listWarehouses() {
  await ensureDefaultWarehouse(prisma)
  return prisma.warehouse.findMany({
    where: { isActive: true },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  })
}

export async function createWarehouse(data: { name: string; code: string; isDefault?: boolean }) {
  if (data.isDefault) {
    await prisma.warehouse.updateMany({ data: { isDefault: false } })
  }
  return prisma.warehouse.create({
    data: {
      name: data.name,
      code: data.code.toUpperCase(),
      isDefault: !!data.isDefault,
    },
  })
}

export async function warehouseTransfer(
  data: {
    itemId: string
    fromWarehouseId: string
    toWarehouseId: string
    quantity: number
    notes?: string
  },
  userId: string
) {
  return prisma.$transaction(async (tx) => {
    await transferBetweenWarehouses(tx, {
      itemId: data.itemId,
      fromWarehouseId: data.fromWarehouseId,
      toWarehouseId: data.toWarehouseId,
      qty: data.quantity,
      userId,
      notes: data.notes,
    })
    return { ok: true }
  })
}

export async function createStockCount(
  warehouseId: string,
  userId: string,
  lines: Array<{ itemId: string; countedQty: number }>
) {
  const balances = await prisma.stockBalance.findMany({
    where: { warehouseId, itemId: { in: lines.map((l) => l.itemId) } },
    include: { item: true },
  })
  const balMap = new Map(balances.map((b) => [b.itemId, b]))

  return prisma.$transaction(async (tx) => {
    const count = await tx.stockCount.create({
      data: {
        warehouseId,
        createdById: userId,
        status: 'DRAFT',
        lines: {
          create: lines.map((l) => {
            const bal = balMap.get(l.itemId)
            return {
              itemId: l.itemId,
              systemQty: bal ? Number(bal.qty) : 0,
              countedQty: l.countedQty,
              unitCostUsed: bal ? Number(bal.item.costPrice) : 0,
            }
          }),
        },
      },
      include: { lines: { include: { item: true } }, warehouse: true },
    })
    return count
  })
}

export async function confirmStockCount(countId: string, userId: string) {
  const count = await prisma.stockCount.findUnique({
    where: { id: countId },
    include: { lines: { include: { item: true } } },
  })
  if (!count) throw new Error('COUNT_NOT_FOUND')
  if (count.status !== 'DRAFT') throw new Error('ALREADY_CONFIRMED')

  await prisma.$transaction(async (tx) => {
    for (const line of count.lines) {
      const diff = Number(line.countedQty) - Number(line.systemQty)
      if (diff === 0) continue
      if (diff > 0) {
        await stockIn(tx, {
          itemId: line.itemId,
          warehouseId: count.warehouseId,
          qty: diff,
          unitCost: Number(line.unitCostUsed) || Number(line.item.costPrice),
          updateAvgCost: true,
          type: 'IN',
          reason: 'ADJUSTMENT',
          userId,
          notes: `جرد: تسوية زيادة`,
        })
      } else {
        await stockOut(tx, {
          itemId: line.itemId,
          warehouseId: count.warehouseId,
          qty: Math.abs(diff),
          type: 'OUT',
          reason: 'ADJUSTMENT',
          userId,
          notes: `جرد: تسوية نقص`,
        })
      }
    }
    await tx.stockCount.update({
      where: { id: countId },
      data: { status: 'CONFIRMED' },
    })
  })

  return prisma.stockCount.findUnique({
    where: { id: countId },
    include: { lines: { include: { item: true } }, warehouse: true },
  })
}

export async function listStockCounts() {
  return prisma.stockCount.findMany({
    include: {
      warehouse: true,
      createdBy: { select: { id: true, name: true } },
      _count: { select: { lines: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
}

export async function getItemLedger(itemId: string) {
  const transfers = await prisma.stockTransfer.findMany({
    where: { itemId },
    include: {
      fromWarehouse: { select: { id: true, name: true } },
      toWarehouse: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  const item = await prisma.item.findUnique({ where: { id: itemId } })
  const balances = await prisma.stockBalance.findMany({
    where: { itemId },
    include: { warehouse: true },
  })
  return { item, balances, movements: transfers }
}
