
import { prisma } from '../db/prisma'
import { setItemStockQty } from './stock-ops.service'

export async function listSerials(itemId?: string, status?: string) {
  return prisma.itemSerial.findMany({
    where: {
      ...(itemId ? { itemId } : {}),
      ...(status ? { status } : {}),
    },
    include: { item: { select: { id: true, name_ar: true, barcode: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
}

export async function addSerial(data: {
  itemId: string
  serial: string
  warrantyMonths?: number
}) {
  const item = await prisma.item.findUnique({ where: { id: data.itemId } })
  if (!item) throw new Error('ITEM_NOT_FOUND')
  return prisma.itemSerial.create({
    data: {
      itemId: data.itemId,
      serial: data.serial.trim(),
      warrantyMonths: data.warrantyMonths ?? item.warrantyMonths ?? 0,
      status: 'IN_STOCK',
    },
  })
}

export async function createVariant(data: {
  parentId: string
  size?: string
  color?: string
  barcode?: string
  retailPrice?: number
  costPrice?: number
  stockQty?: number
}) {
  const parent = await prisma.item.findUnique({ where: { id: data.parentId } })
  if (!parent) throw new Error('PARENT_NOT_FOUND')

  await prisma.item.update({
    where: { id: parent.id },
    data: { itemKind: 'PARENT' },
  })

  const nameSuffix = [data.size, data.color].filter(Boolean).join(' / ')
  const qty = Number(data.stockQty ?? 0)
  const variant = await prisma.item.create({
    data: {
      parentId: parent.id,
      itemKind: 'VARIANT',
      name_ar: `${parent.name_ar}${nameSuffix ? ` — ${nameSuffix}` : ''}`,
      name_en: `${parent.name_en}${nameSuffix ? ` - ${nameSuffix}` : ''}`,
      barcode: data.barcode || null,
      size: data.size || null,
      color: data.color || null,
      unit: parent.unit,
      categoryId: parent.categoryId,
      costPrice: data.costPrice ?? parent.costPrice,
      retailPrice: data.retailPrice ?? parent.retailPrice,
      wholesalePrice: parent.wholesalePrice,
      specialPrice: parent.specialPrice,
      stockQty: qty,
      minimumStock: parent.minimumStock,
      trackSerial: false,
    },
  })
  if (qty > 0) {
    await setItemStockQty(prisma, variant.id, qty)
  }
  return variant
}
