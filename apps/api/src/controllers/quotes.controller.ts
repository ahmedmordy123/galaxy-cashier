import { Request, Response } from 'express'
import { createSalesInvoiceSchema } from '../validators/sales.validator'
import {
  createQuote,
  getQuotes,
  getQuoteById,
  convertQuoteToSale,
  deleteQuote,
} from '../services/quotes.service'

export async function listQuotes(req: Request, res: Response) {
  try {
    const { page, limit, search } = req.query
    const data = await getQuotes({
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
      search: search as string | undefined,
    })
    res.json({ success: true, data })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to list quotes'
    res.status(500).json({ success: false, error: msg })
  }
}

export async function getQuote(req: Request, res: Response) {
  try {
    const data = await getQuoteById(req.params.id)
    if (!data) return res.status(404).json({ success: false, error: 'عرض السعر غير موجود' })
    res.json({ success: true, data })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to get quote'
    res.status(500).json({ success: false, error: msg })
  }
}

export async function createQuoteHandler(req: Request, res: Response) {
  try {
    const parsed = createSalesInvoiceSchema.parse({
      ...req.body,
      paymentType: 'CASH',
      currency: 'EGP',
      exchangeRate: 1,
    })
    const data = await createQuote(parsed, req.user!.id)
    res.status(201).json({ success: true, data })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to create quote'
    res.status(400).json({ success: false, error: msg })
  }
}

export async function convertQuoteHandler(req: Request, res: Response) {
  try {
    const data = await convertQuoteToSale(req.params.id)
    res.json({ success: true, data })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to convert quote'
    if (msg === 'QUOTE_NOT_FOUND') {
      return res.status(404).json({ success: false, error: 'عرض السعر غير موجود' })
    }
    res.status(400).json({ success: false, error: msg })
  }
}

export async function deleteQuoteHandler(req: Request, res: Response) {
  try {
    await deleteQuote(req.params.id)
    res.json({ success: true })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to delete quote'
    if (msg === 'QUOTE_NOT_FOUND') {
      return res.status(404).json({ success: false, error: 'عرض السعر غير موجود' })
    }
    res.status(400).json({ success: false, error: msg })
  }
}
