import { Request, Response } from 'express'
import { createSalesInvoiceSchema } from '../validators/sales.validator'
import {
  getSalesInvoices,
  getSalesInvoiceById,
  createSalesInvoice,
  updateSalesInvoice,
  confirmInvoice,
  cancelInvoice,
  returnInvoice,
  partialReturnInvoice,
  parkInvoice,
  listParkedInvoices,
} from '../services/sales.service'
import { isCreditError, respondCreditError } from '../utils/creditErrors'

function sendCreditIfAny(res: Response, error: unknown): boolean {
  if (isCreditError(error)) {
    respondCreditError(res, error)
    return true
  }
  return false
}

export async function listInvoices(req: Request, res: Response) {
  try {
    const { page, limit, status, customerId, from, to, search } = req.query
    const result = await getSalesInvoices({
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
      status: status as string | undefined,
      customerId: customerId as string | undefined,
      from: from as string | undefined,
      to: to as string | undefined,
      search: search as string | undefined,
    })
    res.json({ success: true, data: result })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch invoices' })
  }
}

export async function getInvoice(req: Request, res: Response) {
  try {
    const invoice = await getSalesInvoiceById(req.params.id)
    if (!invoice) return res.status(404).json({ success: false, error: 'Invoice not found' })
    res.json({ success: true, data: invoice })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch invoice' })
  }
}

export async function updateInvoice(req: Request, res: Response) {
  try {
    const parsed = createSalesInvoiceSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      })
    }
    const expectedUpdatedAt =
      typeof req.body?.updatedAt === 'string' ? req.body.updatedAt : undefined
    const invoice = await updateSalesInvoice(
      req.params.id,
      parsed.data,
      req.user!.id,
      expectedUpdatedAt,
      req.user!,
    )
    res.json({ success: true, data: invoice })
  } catch (error: unknown) {
    if (sendCreditIfAny(res, error)) return
    const msg = error instanceof Error ? error.message : 'Failed to update invoice'
    const status = (error as { statusCode?: number })?.statusCode
    if (msg === 'PRICE_OVERRIDE_FORBIDDEN') {
      return res.status(403).json({ success: false, error: 'غير مسموح بتعديل سعر البيع', code: msg })
    }
    if (msg === 'BELOW_COST_BLOCKED') {
      return res.status(400).json({ success: false, error: 'البيع بأقل من التكلفة ممنوع حسب الإعدادات', code: msg })
    }
    if (msg === 'BELOW_COST_CONFIRM_REQUIRED') {
      return res.status(400).json({
        success: false,
        error: 'البيع بأقل من التكلفة يحتاج تأكيد',
        code: msg,
      })
    }
    if (msg === 'INVOICE_NOT_FOUND') {
      return res.status(404).json({ success: false, error: 'الفاتورة غير موجودة' })
    }
    if (msg === 'INVOICE_NOT_EDITABLE') {
      return res.status(400).json({ success: false, error: 'لا يمكن تعديل هذه الفاتورة' })
    }
    if (msg === 'CREDIT_REQUIRES_CUSTOMER') {
      return res.status(400).json({ success: false, error: 'الفاتورة الآجلة تتطلب تحديد عميل' })
    }
    if (msg === 'INVOICE_MODIFIED_ELSEWHERE') {
      return res.status(409).json({
        success: false,
        error: 'الفاتورة اتعدّلت من جهاز تاني — حمّلها من جديد',
      })
    }
    res.status(status && status >= 400 && status < 600 ? status : 500).json({ success: false, error: msg })
  }
}

export async function createInvoice(req: Request, res: Response) {
  try {
    const parsed = createSalesInvoiceSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      })
    }
    const invoice = await createSalesInvoice(parsed.data, req.user!.id, req.user!)
    res.status(201).json({ success: true, data: invoice })
  } catch (error: unknown) {
    if (sendCreditIfAny(res, error)) return
    const msg = error instanceof Error ? error.message : 'Failed to create invoice'
    const status = (error as { statusCode?: number })?.statusCode
    if (msg === 'PRICE_OVERRIDE_FORBIDDEN') {
      return res.status(403).json({ success: false, error: 'غير مسموح بتعديل سعر البيع', code: msg })
    }
    if (msg === 'BELOW_COST_BLOCKED') {
      return res.status(400).json({ success: false, error: 'البيع بأقل من التكلفة ممنوع حسب الإعدادات', code: msg })
    }
    if (msg === 'BELOW_COST_CONFIRM_REQUIRED') {
      return res.status(400).json({
        success: false,
        error: 'البيع بأقل من التكلفة يحتاج تأكيد',
        code: msg,
      })
    }
    if (msg === 'CREDIT_REQUIRES_CUSTOMER') {
      return res.status(400).json({ success: false, error: 'الفاتورة الآجلة تتطلب تحديد عميل' })
    }
    res.status(status && status >= 400 && status < 600 ? status : 500).json({ success: false, error: msg })
  }
}

export async function confirmInvoiceHandler(req: Request, res: Response) {
  try {
    const amountPaid = req.body?.amountPaid != null ? Number(req.body.amountPaid) : undefined
    const payments = Array.isArray(req.body?.payments) ? req.body.payments : undefined
    const expectedUpdatedAt =
      typeof req.body?.updatedAt === 'string' ? req.body.updatedAt : undefined
    const ackTaxPolicyChange = req.body?.ackTaxPolicyChange === true
    const invoice = await confirmInvoice(
      req.params.id,
      req.user!.id,
      amountPaid,
      payments,
      expectedUpdatedAt,
      { ackTaxPolicyChange },
    )
    res.json({ success: true, data: invoice })
  } catch (error: unknown) {
    if (sendCreditIfAny(res, error)) return
    if (
      error instanceof Error &&
      error.message === 'TAX_POLICY_CHANGED' &&
      'details' in error
    ) {
      const details = (error as { details: unknown }).details
      return res.status(409).json({
        success: false,
        code: 'TAX_POLICY_CHANGED',
        error:
          'إعدادات الضريبة تغيّرت أثناء المسودة — راجع الإجمالي الجديد قبل التأكيد',
        details,
      })
    }
    const msg = error instanceof Error ? error.message : 'Failed to confirm invoice'
    if (msg === 'INVOICE_NOT_FOUND') {
      return res.status(404).json({ success: false, error: 'الفاتورة غير موجودة' })
    }
    if (msg === 'INVOICE_NOT_DRAFT') {
      return res.status(400).json({ success: false, error: 'لا يمكن تأكيد فاتورة ليست في حالة مسودة' })
    }
    if (msg === 'INVOICE_ALREADY_CONFIRMED') {
      return res.status(409).json({ success: false, error: 'تم تأكيد هذه الفاتورة مسبقاً' })
    }
    if (msg === 'INVOICE_MODIFIED_ELSEWHERE') {
      return res.status(409).json({
        success: false,
        error: 'الفاتورة اتعدّلت من جهاز تاني — حمّلها من جديد',
      })
    }
    if (msg.startsWith('INSUFFICIENT_STOCK:')) {
      const parts = msg.split(':')
      const itemName = parts[1] || 'المنتج'
      return res.status(400).json({ success: false, error: `الكمية غير كافية للمنتج: ${itemName}` })
    }
    if (msg.startsWith('SERIAL_REQUIRED:')) {
      return res.status(400).json({ success: false, error: `مطلوب سيريال للصنف: ${msg.split(':')[1]}` })
    }
    if (msg.startsWith('SERIAL_QTY_ONE:')) {
      return res.status(400).json({
        success: false,
        error: `الصنف ${msg.split(':')[1]} يتطلب كمية 1 لكل سيريال — أضف سطراً لكل قطعة`,
      })
    }
    if (msg.startsWith('SERIAL_NOT_FOUND:')) {
      return res.status(400).json({ success: false, error: `السيريال غير موجود: ${msg.split(':')[1]}` })
    }
    res.status(500).json({ success: false, error: msg })
  }
}

export async function parkInvoiceHandler(req: Request, res: Response) {
  try {
    const invoice = await parkInvoice(req.params.id)
    res.json({ success: true, data: invoice })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to park'
    res.status(400).json({ success: false, error: msg })
  }
}

export async function listParkedHandler(_req: Request, res: Response) {
  try {
    const data = await listParkedInvoices()
    res.json({ success: true, data })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to list parked' })
  }
}

export async function cancelInvoiceHandler(req: Request, res: Response) {
  try {
    const invoice = await cancelInvoice(req.params.id, req.user!.id)
    res.json({ success: true, data: invoice })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to cancel invoice'
    if (msg === 'INVOICE_NOT_FOUND') {
      return res.status(404).json({ success: false, error: 'الفاتورة غير موجودة' })
    }
    if (msg === 'ALREADY_CANCELLED') {
      return res.status(400).json({ success: false, error: 'الفاتورة ملغاة بالفعل' })
    }
    res.status(500).json({ success: false, error: 'Failed to cancel invoice' })
  }
}

export async function returnInvoiceHandler(req: Request, res: Response) {
  try {
    const invoice = await returnInvoice(req.params.id, req.user!.id)
    res.json({ success: true, data: invoice })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to return invoice'
    if (msg === 'INVOICE_NOT_FOUND') {
      return res.status(404).json({ success: false, error: 'الفاتورة غير موجودة' })
    }
    if (msg === 'ONLY_CONFIRMED_CAN_BE_RETURNED') {
      return res.status(400).json({ success: false, error: 'يمكن إرجاع الفواتير المؤكدة فقط' })
    }
    res.status(500).json({ success: false, error: 'Failed to return invoice' })
  }
}

export async function partialReturnHandler(req: Request, res: Response) {
  try {
    const { items } = req.body as { items?: { itemId: string; quantity: number }[] }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'يجب تحديد أصناف للإرجاع' })
    }
    const invoice = await partialReturnInvoice(req.params.id, items, req.user!.id)
    res.json({ success: true, data: invoice })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to process return'
    if (msg === 'INVOICE_NOT_FOUND') {
      return res.status(404).json({ success: false, error: 'الفاتورة غير موجودة' })
    }
    if (msg === 'ONLY_CONFIRMED_CAN_BE_RETURNED') {
      return res.status(400).json({ success: false, error: 'يمكن إرجاع الفواتير المؤكدة فقط' })
    }
    if (msg.startsWith('ITEM_NOT_IN_INVOICE:')) {
      return res.status(400).json({ success: false, error: 'صنف غير موجود في الفاتورة' })
    }
    if (msg.startsWith('RETURN_QTY_EXCEEDS_SOLD:')) {
      return res.status(400).json({ success: false, error: 'كمية الإرجاع تتجاوز الكمية المباعة' })
    }
    res.status(500).json({ success: false, error: 'Failed to process return' })
  }
}
