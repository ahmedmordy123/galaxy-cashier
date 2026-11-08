import { Request, Response } from 'express'
import * as xlsx from 'xlsx'
import { sendRouteError } from '../utils/apiError'
import { logAudit } from '../services/audit.service'

import { prisma } from '../db/prisma'
import {
  getItems,
  getItemById,
  getItemByBarcode,
  createItem,
  updateItem,
  softDeleteItem,
  getCategories,
  importItems,
  validateImportRows,
  bulkSoftDeleteItems,
  bulkAdjustItemPrices,
} from '../services/item.service'

/** Omit costPrice for CASHIER — key must be absent, not null/0. */
function omitCostPrice<T extends Record<string, unknown>>(item: T): Omit<T, 'costPrice'> {
  const { costPrice: _costPrice, ...rest } = item
  return rest
}

function stripItemCostForCashier<T extends Record<string, unknown>>(item: T, role: string | undefined): T | Omit<T, 'costPrice'> {
  if (role === 'CASHIER') return omitCostPrice(item)
  return item
}

export async function listItems(req: Request, res: Response) {
  try {
    const { search, categoryId, lowStock, page, pageSize } = req.query
    const result = await getItems({
      search: search as string,
      categoryId: categoryId as string,
      lowStock: lowStock === 'true',
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
    })
    const role = req.user?.role
    const items = role === 'CASHIER'
      ? result.items.map((item) => omitCostPrice(item as Record<string, unknown>))
      : result.items
    res.json({ success: true, data: { ...result, items } })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch items' })
  }
}

export async function getItem(req: Request, res: Response) {
  try {
    const item = await getItemById(req.params.id)
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' })
    res.json({
      success: true,
      data: stripItemCostForCashier(item as Record<string, unknown>, req.user?.role),
    })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch item' })
  }
}

export async function lookupByBarcode(req: Request, res: Response) {
  try {
    const item = await getItemByBarcode(req.params.barcode)
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' })
    res.json({
      success: true,
      data: stripItemCostForCashier(item as Record<string, unknown>, req.user?.role),
    })
  } catch {
    res.status(500).json({ success: false, error: 'Barcode lookup failed' })
  }
}

export async function addItem(req: Request, res: Response) {
  try {
    const item = await createItem(req.body)
    res.status(201).json({ success: true, data: item })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to create item'
    if (msg.includes('Unique constraint') && msg.includes('barcode')) {
      return res.status(409).json({ success: false, error: 'Barcode already exists' })
    }
    res.status(500).json({ success: false, error: msg })
  }
}

export async function editItem(req: Request, res: Response) {
  try {
    const item = await updateItem(req.params.id, req.body)
    res.json({ success: true, data: item })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to update item' })
  }
}

export async function bulkItemsHandler(req: Request, res: Response) {
  try {
    const body = req.body as { action: string }
    if (body.action === 'delete') {
      const data = await bulkSoftDeleteItems(req.body)
      return res.json({ success: true, data })
    }
    if (body.action === 'adjustPrices') {
      const data = await bulkAdjustItemPrices(req.body)
      return res.json({ success: true, data })
    }
    return res.status(400).json({ success: false, error: 'إجراء غير معروف' })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'فشل التعديل الجماعي'
    if (msg === 'NO_ITEMS_SELECTED') {
      return res.status(400).json({ success: false, error: 'حدد صنفاً واحداً على الأقل' })
    }
    if (msg === 'NO_ITEMS_MATCH') {
      return res.status(400).json({ success: false, error: 'لا توجد أصناف مطابقة' })
    }
    if (msg === 'NO_PRICE_FIELDS') {
      return res.status(400).json({ success: false, error: 'اختر حقول الأسعار' })
    }
    res.status(500).json({ success: false, error: msg })
  }
}

export async function deleteItem(req: Request, res: Response) {
  try {
    const id = req.params.id
    await softDeleteItem(id)
    await logAudit(prisma, {
      userId: req.user!.id,
      action: 'DELETE_ITEM',
      entityType: 'ITEM',
      entityId: id,
    })
    res.json({ success: true })
  } catch (e) {
    return sendRouteError(res, e, 'فشل حذف الصنف')
  }
}

export async function listCategories(_req: Request, res: Response) {
  try {
    const categories = await getCategories()
    res.json({ success: true, data: categories })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch categories' })
  }
}

export async function validateImportHandler(req: Request, res: Response) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'لم يتم رفع ملف' })
    }
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rows = xlsx.utils.sheet_to_json(sheet) as Record<string, unknown>[]

    if (rows.length === 0) {
      return res.status(400).json({ success: false, error: 'الملف فارغ أو لا يحتوي على بيانات' })
    }
    if (rows.length > 1000) {
      return res.status(400).json({ success: false, error: 'الحد الأقصى للاستيراد 1000 صف في المرة الواحدة' })
    }

    const result = await validateImportRows(rows)
    res.json({ success: true, data: result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'فشل التحقق من الملف'
    res.status(500).json({ success: false, error: msg })
  }
}

export async function importItemsHandler(req: Request, res: Response) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'لم يتم رفع ملف' })
    }
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rows = xlsx.utils.sheet_to_json(sheet) as Record<string, unknown>[]

    if (rows.length === 0) {
      return res.status(400).json({ success: false, error: 'الملف فارغ أو لا يحتوي على بيانات' })
    }
    if (rows.length > 1000) {
      return res.status(400).json({ success: false, error: 'الحد الأقصى للاستيراد 1000 صف في المرة الواحدة' })
    }

    const result = await importItems(rows)
    res.json({ success: true, data: result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'فشل الاستيراد'
    res.status(500).json({ success: false, error: msg })
  }
}
