import { Prisma } from '@prisma/client'
import { CreateItemInput, UpdateItemInput } from '../validators/item.validator'
import { setItemStockQty } from './stock-ops.service'
import { notFoundError, isPlausibleId } from '../utils/apiError'
import { prisma } from '../db/prisma'

function generateBarcode(): string {
  const timestamp = Date.now().toString().slice(-8)
  return `IMS-${timestamp}`
}

// ─── Bulk import ──────────────────────────────────────────────────────────────

interface ImportRow {
  name_ar?: unknown
  name_en?: unknown
  barcode?: unknown
  unit?: unknown
  costPrice?: unknown
  retailPrice?: unknown
  wholesalePrice?: unknown
  specialPrice?: unknown
  dollarPrice?: unknown
  dinarPrice?: unknown
  stockQty?: unknown
  minimumStock?: unknown
}

export interface ImportResult {
  created: number
  updated: number
  skipped: number
  errors: string[]
}

function toNum(v: unknown): number {
  const n = Number(v)
  return isNaN(n) || n < 0 ? 0 : n
}

export async function importItems(rows: ImportRow[]): Promise<ImportResult> {
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const label = `الصف ${i + 2}`

    const nameAr = row.name_ar?.toString().trim() ?? ''
    const nameEn = row.name_en?.toString().trim() ?? ''

    if (!nameAr) {
      result.errors.push(`${label}: الاسم العربي (name_ar) مطلوب`)
      result.skipped++
      continue
    }
    if (!nameEn) {
      result.errors.push(`${label}: الاسم الإنجليزي (name_en) مطلوب`)
      result.skipped++
      continue
    }

    const barcode = row.barcode?.toString().trim() || null

    const data = {
      name_ar: nameAr,
      name_en: nameEn,
      unit: row.unit?.toString().trim() || 'piece',
      costPrice: toNum(row.costPrice),
      retailPrice: toNum(row.retailPrice),
      wholesalePrice: toNum(row.wholesalePrice),
      specialPrice: toNum(row.specialPrice),
      dollarPrice: toNum(row.dollarPrice),
      dinarPrice: toNum(row.dinarPrice),
      stockQty: toNum(row.stockQty),
      minimumStock: toNum(row.minimumStock),
    }

    try {
      let itemId: string
      if (barcode) {
        const existing = await prisma.item.findFirst({ where: { barcode } })
        if (existing) {
          await prisma.item.update({ where: { id: existing.id }, data: { ...data, barcode } })
          itemId = existing.id
          result.updated++
        } else {
          const created = await prisma.item.create({ data: { ...data, barcode } })
          itemId = created.id
          result.created++
        }
      } else {
        const created = await prisma.item.create({ data: { ...data, barcode: generateBarcode() } })
        itemId = created.id
        result.created++
      }

      const qty = data.stockQty
      if (qty > 0) {
        await setItemStockQty(prisma, itemId, qty)
      }
    } catch (err) {
      result.errors.push(`${label}: ${err instanceof Error ? err.message : 'خطأ'}`)
      result.skipped++
    }
  }

  return result
}

export interface ValidationResult {
  toCreate: { row: number; name_ar: string; name_en: string; barcode: string | null }[]
  toUpdate: { row: number; name_ar: string; name_en: string; barcode: string; existingId: string }[]
  invalid: { row: number; errors: string[] }[]
  summary: { total: number; willCreate: number; willUpdate: number; invalid: number }
}

export async function validateImportRows(rows: ImportRow[]): Promise<ValidationResult> {
  const result: ValidationResult = {
    toCreate: [],
    toUpdate: [],
    invalid: [],
    summary: { total: rows.length, willCreate: 0, willUpdate: 0, invalid: 0 },
  }

  const seenBarcodes = new Map<string, number>()

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNum = i + 2
    const errors: string[] = []

    const nameAr = row.name_ar?.toString().trim() ?? ''
    const nameEn = row.name_en?.toString().trim() ?? ''
    if (!nameAr) errors.push('الاسم العربي (name_ar) مطلوب')
    if (!nameEn) errors.push('الاسم الإنجليزي (name_en) مطلوب')

    const barcode = row.barcode?.toString().trim() || null

    if (barcode) {
      if (seenBarcodes.has(barcode)) {
        errors.push(`الباركود ${barcode} مكرر في الملف (صف ${seenBarcodes.get(barcode)})`)
      } else {
        seenBarcodes.set(barcode, rowNum)
      }
    }

    if (errors.length > 0) {
      result.invalid.push({ row: rowNum, errors })
      result.summary.invalid++
      continue
    }

    if (barcode) {
      const existing = await prisma.item.findFirst({ where: { barcode } })
      if (existing) {
        result.toUpdate.push({ row: rowNum, name_ar: nameAr, name_en: nameEn, barcode, existingId: existing.id })
        result.summary.willUpdate++
      } else {
        result.toCreate.push({ row: rowNum, name_ar: nameAr, name_en: nameEn, barcode })
        result.summary.willCreate++
      }
    } else {
      result.toCreate.push({ row: rowNum, name_ar: nameAr, name_en: nameEn, barcode: null })
      result.summary.willCreate++
    }
  }

  return result
}

export async function getItems(params: {
  search?: string
  categoryId?: string
  isActive?: boolean
  lowStock?: boolean
  page?: number
  pageSize?: number
}) {
  const { search, categoryId, isActive = true, lowStock, page = 1, pageSize = 20 } = params
  const skip = (page - 1) * pageSize

  // Build base where
  const where: Record<string, unknown> = { isActive }
  if (search) {
    const term = search.trim()
    const tokens = term.split(/\s+/).filter(Boolean)
    const matchToken = (token: string) => [
      { name_ar: { contains: token } },
      { name_en: { contains: token } },
      { barcode: { contains: token } },
    ]
    if (tokens.length <= 1) {
      where.OR = matchToken(term)
    } else {
      where.OR = tokens.flatMap((token) => matchToken(token))
    }
  }
  if (categoryId) where.categoryId = categoryId

  if (lowStock) {
    const lowStockIds = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Item" WHERE "isActive" = true AND "minimumStock" > 0 AND "stockQty" <= "minimumStock"
    `
    where.id = { in: lowStockIds.map((i) => i.id) }
  }

  const [items, total] = await Promise.all([
    prisma.item.findMany({
      where: where as Prisma.ItemWhereInput,
      include: { category: true, supplier: { select: { id: true, name: true } } },
      skip,
      take: pageSize,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.item.count({ where: where as Prisma.ItemWhereInput }),
  ])

  return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
}

export async function getItemById(id: string) {
  return prisma.item.findFirst({
    where: { id, isActive: true },
    include: { category: true, supplier: { select: { id: true, name: true } } },
  })
}

export async function getItemByBarcode(barcode: string) {
  return prisma.item.findFirst({
    where: { barcode, isActive: true },
    include: { category: true },
  })
}

export async function createItem(data: CreateItemInput) {
  const item = await prisma.item.create({
    data: {
      barcode: data.barcode || generateBarcode(),
      name_ar: data.name_ar,
      name_en: data.name_en,
      unit: data.unit ?? 'piece',
      categoryId: data.categoryId ?? null,
      supplierId: data.supplierId ?? null,
      costPrice: data.costPrice ?? 0,
      retailPrice: data.retailPrice ?? 0,
      wholesalePrice: data.wholesalePrice ?? 0,
      specialPrice: data.specialPrice ?? 0,
      dollarPrice: data.dollarPrice ?? 0,
      dinarPrice: data.dinarPrice ?? 0,
      stockQty: data.stockQty ?? 0,
      minimumStock: data.minimumStock ?? 0,
      expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
      isFavorite: data.isFavorite ?? false,
      trackSerial: data.trackSerial ?? false,
      taxExempt: data.taxExempt ?? false,
      warrantyMonths: data.warrantyMonths ?? 0,
      size: data.size ?? null,
      color: data.color ?? null,
      parentId: data.parentId ?? null,
      itemKind: data.parentId ? 'VARIANT' : 'SIMPLE',
    },
    include: { category: true },
  })
  const qty = Number(data.stockQty ?? 0)
  if (qty > 0) {
    await setItemStockQty(prisma, item.id, qty)
  }
  return item
}

export async function updateItem(id: string, data: UpdateItemInput) {
  const {
    categoryId,
    supplierId,
    parentId,
    barcode,
    name_ar,
    name_en,
    unit,
    costPrice,
    retailPrice,
    wholesalePrice,
    specialPrice,
    dollarPrice,
    dinarPrice,
    stockQty,
    minimumStock,
    expiryDate,
    isFavorite,
    trackSerial,
    taxExempt,
    warrantyMonths,
    size,
    color,
  } = data

  const dataOut: Prisma.ItemUncheckedUpdateInput = {
    ...(barcode !== undefined ? { barcode } : {}),
    ...(name_ar !== undefined ? { name_ar } : {}),
    ...(name_en !== undefined ? { name_en: name_en ?? '' } : {}),
    ...(unit !== undefined ? { unit } : {}),
    ...(categoryId !== undefined ? { categoryId } : {}),
    ...(supplierId !== undefined ? { supplierId } : {}),
    ...(parentId !== undefined ? { parentId } : {}),
    ...(costPrice !== undefined ? { costPrice } : {}),
    ...(retailPrice !== undefined ? { retailPrice } : {}),
    ...(wholesalePrice !== undefined ? { wholesalePrice } : {}),
    ...(specialPrice !== undefined ? { specialPrice } : {}),
    ...(dollarPrice !== undefined ? { dollarPrice } : {}),
    ...(dinarPrice !== undefined ? { dinarPrice } : {}),
    // stockQty is applied via StockBalance below (sale path reads balances)
    ...(minimumStock !== undefined ? { minimumStock } : {}),
    ...(expiryDate !== undefined ? { expiryDate: expiryDate ? new Date(expiryDate) : null } : {}),
    ...(isFavorite !== undefined ? { isFavorite } : {}),
    ...(trackSerial !== undefined ? { trackSerial } : {}),
    ...(taxExempt !== undefined ? { taxExempt } : {}),
    ...(warrantyMonths !== undefined ? { warrantyMonths } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(color !== undefined ? { color } : {}),
  }

  const updated = await prisma.item.update({
    where: { id },
    data: dataOut,
    include: { category: true },
  })

  if (stockQty !== undefined) {
    await setItemStockQty(prisma, id, Number(stockQty))
    return prisma.item.findUniqueOrThrow({
      where: { id },
      include: { category: true },
    })
  }

  return updated
}

export async function softDeleteItem(id: string) {
  if (!isPlausibleId(id)) throw notFoundError()
  const result = await prisma.item.updateMany({
    where: { id, isActive: true },
    data: { isActive: false },
  })
  if (result.count === 0) throw notFoundError()
}

export type PriceField = 'costPrice' | 'retailPrice' | 'wholesalePrice' | 'specialPrice'

function adjustPrice(current: number, mode: 'percent' | 'amount' | 'set', value: number): number {
  let next = current
  if (mode === 'percent') next = current * (1 + value / 100)
  else if (mode === 'amount') next = current + value
  else next = value
  return Math.max(0, Math.round(next * 100) / 100)
}

function buildItemsWhere(params: {
  search?: string
  categoryId?: string
  isActive?: boolean
}): Prisma.ItemWhereInput {
  const { search, categoryId, isActive = true } = params
  const where: Prisma.ItemWhereInput = { isActive }
  if (search) {
    const term = search.trim()
    const tokens = term.split(/\s+/).filter(Boolean)
    const matchToken = (token: string) => [
      { name_ar: { contains: token } },
      { name_en: { contains: token } },
      { barcode: { contains: token } },
    ]
    where.OR = tokens.length <= 1 ? matchToken(term) : tokens.flatMap((token) => matchToken(token))
  }
  if (categoryId) where.categoryId = categoryId
  return where
}

export async function bulkSoftDeleteItems(params: {
  itemIds?: string[]
  search?: string
  categoryId?: string
  scope: 'selected' | 'filtered' | 'all'
}) {
  const where = buildItemsWhere({
    search: params.scope === 'filtered' ? params.search : undefined,
    categoryId: params.scope === 'filtered' ? params.categoryId : undefined,
  })
  if (params.scope === 'selected') {
    if (!params.itemIds?.length) throw new Error('NO_ITEMS_SELECTED')
    where.id = { in: params.itemIds }
  }

  const result = await prisma.item.updateMany({
    where,
    data: { isActive: false },
  })
  return { updated: result.count }
}

export async function bulkAdjustItemPrices(params: {
  itemIds?: string[]
  search?: string
  categoryId?: string
  scope: 'selected' | 'filtered' | 'all'
  fields: PriceField[]
  mode: 'percent' | 'amount' | 'set'
  value: number
}) {
  if (!params.fields.length) throw new Error('NO_PRICE_FIELDS')

  const where = buildItemsWhere({
    search: params.scope === 'filtered' ? params.search : undefined,
    categoryId: params.scope === 'filtered' ? params.categoryId : undefined,
  })
  if (params.scope === 'selected') {
    if (!params.itemIds?.length) throw new Error('NO_ITEMS_SELECTED')
    where.id = { in: params.itemIds }
  }

  const items = await prisma.item.findMany({
    where,
    select: {
      id: true,
      costPrice: true,
      retailPrice: true,
      wholesalePrice: true,
      specialPrice: true,
    },
    take: 5000,
  })

  if (items.length === 0) throw new Error('NO_ITEMS_MATCH')

  let updated = 0
  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      const data: Partial<Record<PriceField, number>> = {}
      for (const field of params.fields) {
        const current = Number(item[field])
        data[field] = adjustPrice(current, params.mode, params.value)
      }
      await tx.item.update({ where: { id: item.id }, data })
      updated++
    }
  })

  return { updated, matched: items.length }
}

export async function getCategories() {
  return prisma.category.findMany({ orderBy: { name_ar: 'asc' } })
}
