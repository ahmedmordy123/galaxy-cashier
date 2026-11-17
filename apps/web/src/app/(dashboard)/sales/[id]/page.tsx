'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { salesService } from '@/services/sales.service'
import api from '@/lib/api'
import { formatMoney, formatNumber } from '@/lib/currency'
import { formatDateTime } from '@/lib/dates'
import { isTaxPolicyChangedError, promptTaxPolicyChange } from '@/lib/taxPolicyConfirm'

type EtaDocStatus = 'PENDING' | 'SUBMITTED' | 'RETRY' | 'REJECTED'

const ETA_LABELS: Record<string, string> = {
  PENDING: 'في الطابور',
  SUBMITTED: 'مُرسَل للضرائب',
  RETRY: 'إعادة محاولة',
  REJECTED: 'مرفوض',
}

type InvoiceStatus = 'DRAFT' | 'PARKED' | 'CONFIRMED' | 'CANCELLED' | 'RETURNED'
type PaymentType = 'CASH' | 'CREDIT'
type PriceType = 'RETAIL' | 'WHOLESALE' | 'SPECIAL' | 'DOLLAR' | 'DINAR'
type Currency = 'USD' | 'EGP'

interface InvoiceItem {
  id: string
  quantity: number
  unitPrice: number
  subtotal: number
  currency: Currency
  item: {
    id: string
    name_ar: string
    name_en: string
    barcode: string | null
  }
}

interface Invoice {
  id: string
  invoiceNumber: string
  type: PaymentType
  priceType: PriceType
  currency: Currency
  exchangeRate: number
  subtotal: number
  discount: number
  tax: number
  total: number
  amountPaid: number
  balance: number
  notes: string | null
  status: InvoiceStatus
  createdAt: string
  customer: { id: string; name: string; currency: string } | null
  createdBy: { id: string; name: string; username: string }
  items: InvoiceItem[]
}

const STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: 'مسودة',
  PARKED: 'معلّقة',
  CONFIRMED: 'مؤكدة',
  CANCELLED: 'ملغاة',
  RETURNED: 'مرتجعة',
}

const STATUS_CLASSES: Record<InvoiceStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  PARKED: 'bg-amber-100 text-amber-800',
  CONFIRMED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-700',
  RETURNED: 'bg-amber-100 text-amber-700',
}

const PAYMENT_LABELS: Record<PaymentType, string> = {
  CASH: 'نقدي',
  CREDIT: 'آجل',
}

export default function SalesInvoiceDetailPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [showPayModal, setShowPayModal] = useState(false)
  const [paidAmount, setPaidAmount] = useState(0)
  const [etaDoc, setEtaDoc] = useState<{ status: string; uuid?: string | null; lastError?: string | null } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await salesService.getById(id)
      setInvoice(res.data)
      if (res.data?.status === 'CONFIRMED' || res.data?.status === 'RETURNED') {
        try {
          const er = await api.get(`/api/eta/invoice/${id}`)
          setEtaDoc(er.data?.data ?? null)
        } catch {
          setEtaDoc(null)
        }
      } else {
        setEtaDoc(null)
      }
    } catch {
      setError('فشل في تحميل الفاتورة')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  async function doConfirm(amountPaid?: number, ackTaxPolicyChange = false) {
    setShowPayModal(false)
    setActionLoading(true)
    setActionError('')
    try {
      const inv = invoice!
      const total = Number(inv.total)
      const payments: Array<{ method: string; amount: number }> = []
      if (inv.type === 'CREDIT') {
        payments.push({ method: 'CREDIT', amount: total })
      } else {
        const paid = amountPaid ?? total
        payments.push({ method: 'CASH', amount: paid })
      }
      await salesService.confirm(id, {
        amountPaid: inv.type === 'CASH' ? (amountPaid ?? total) : 0,
        payments,
        ...(ackTaxPolicyChange ? { ackTaxPolicyChange: true } : {}),
      })
      await load()
    } catch (err: unknown) {
      const taxChange = isTaxPolicyChangedError(err)
      if (taxChange && !ackTaxPolicyChange) {
        setActionLoading(false)
        if (promptTaxPolicyChange(taxChange.details)) {
          const nextTotal = Number(taxChange.details.next.total)
          const nextPaid =
            invoice?.type === 'CASH' ? (amountPaid != null ? amountPaid : nextTotal) : amountPaid
          await doConfirm(nextPaid, true)
          return
        }
        setActionError(
          `تم إلغاء التأكيد — الإجمالي كان سيتغيّر من ${Number(taxChange.details.previous.total).toFixed(2)} إلى ${Number(taxChange.details.next.total).toFixed(2)}`,
        )
        return
      }
      const axiosErr = err as { response?: { data?: { error?: string } } }
      setActionError(axiosErr.response?.data?.error ?? 'فشل في تأكيد الفاتورة')
    } finally {
      setActionLoading(false)
    }
  }

  function handleConfirmClick() {
    if (!invoice) return
    setActionError('')
    if (invoice.type === 'CASH') {
      setPaidAmount(Math.ceil(Number(invoice.total)))
      setShowPayModal(true)
    } else {
      doConfirm()
    }
  }

  async function handleCancel() {
    if (!confirm('هل أنت متأكد من إلغاء هذه الفاتورة؟')) return
    setActionLoading(true)
    setActionError('')
    try {
      await salesService.cancel(id)
      await load()
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } }
      setActionError(axiosErr.response?.data?.error ?? 'فشل في إلغاء الفاتورة')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleReturn() {
    if (!confirm('هل أنت متأكد من إرجاع هذه الفاتورة؟')) return
    setActionLoading(true)
    setActionError('')
    try {
      await salesService.returnInvoice(id)
      await load()
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } }
      setActionError(axiosErr.response?.data?.error ?? 'فشل في إرجاع الفاتورة')
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) {
    return (
      <div dir="rtl" className="flex items-center justify-center min-h-64">
        <div className="text-gray-500">جار التحميل...</div>
      </div>
    )
  }

  if (error || !invoice) {
    return (
      <div dir="rtl">
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4">
          {error || 'الفاتورة غير موجودة'}
        </div>
        <button onClick={() => router.push('/sales')} className="mt-4 text-blue-600 hover:underline text-sm">
          ← العودة إلى قائمة الفواتير
        </button>
      </div>
    )
  }

  const discountAmount = Number(invoice.subtotal) * (Number(invoice.discount) / 100)
  const isEditable = invoice.status === 'DRAFT' || invoice.status === 'PARKED'
  const statusKey = (STATUS_LABELS as Record<string, string>)[invoice.status]
    ? (invoice.status as InvoiceStatus)
    : 'DRAFT'
  const change = paidAmount - Number(invoice.total)

  return (
    <div dir="rtl" className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push('/sales')} className="text-gray-500 hover:text-gray-700 text-sm">
            ← رجوع
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white font-mono">
              {invoice.invoiceNumber}
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              {formatDateTime(invoice.createdAt)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_CLASSES[statusKey] ?? STATUS_CLASSES.DRAFT}`}>
            {STATUS_LABELS[statusKey] ?? invoice.status}
          </span>
          {etaDoc && (
            <span
              className="px-3 py-1 rounded-full text-xs font-medium bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200"
              title={etaDoc.lastError ?? undefined}
            >
              ETA: {ETA_LABELS[etaDoc.status as EtaDocStatus] ?? etaDoc.status}
            </span>
          )}
          <button
            onClick={() => router.push(`/sales/${invoice.id}/print?next=${encodeURIComponent('/sales/new')}`)}
            className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-sm flex items-center gap-1"
          >
            🖨️ طباعة
          </button>
        </div>
      </div>

      {/* Action error */}
      {actionError && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          {actionError}
        </div>
      )}

      {/* Invoice info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700 pb-2">
            معلومات الفاتورة
          </h2>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">نوع الدفع</span>
            <span className="font-medium text-gray-900 dark:text-white">{PAYMENT_LABELS[invoice.type]}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">أنشأ بواسطة</span>
            <span className="font-medium text-gray-900 dark:text-white">{invoice.createdBy.name}</span>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700 pb-2">
            العميل والمبالغ
          </h2>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">العميل</span>
            <span className="font-medium text-gray-900 dark:text-white">{invoice.customer?.name ?? 'بدون عميل'}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">المجموع الفرعي</span>
            <span className="font-medium text-gray-900 dark:text-white">
              {formatMoney(invoice.subtotal)}
            </span>
          </div>
          {Number(invoice.discount) > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">الخصم ({Number(invoice.discount)}%)</span>
              <span className="font-medium text-red-500">
                - {formatMoney(discountAmount)}
              </span>
            </div>
          )}
          {invoice.tax != null && Number(invoice.tax) > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">ض.ق.م</span>
              <span className="font-medium text-gray-900 dark:text-white">
                {formatMoney(invoice.tax)}
              </span>
            </div>
          )}
          <div className="flex justify-between text-base font-bold border-t border-gray-100 dark:border-gray-700 pt-2">
            <span className="text-gray-700 dark:text-gray-300">الإجمالي</span>
            <span className="text-gray-900 dark:text-white">
              {formatMoney(invoice.total)}
            </span>
          </div>
          {invoice.status === 'CONFIRMED' && invoice.type === 'CASH' && Number(invoice.amountPaid) > 0 && (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">المبلغ المستلم</span>
                <span className="font-medium text-green-600 dark:text-green-400">
                  {formatMoney(invoice.amountPaid)}
                </span>
              </div>
              {Number(invoice.amountPaid) > Number(invoice.total) && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">الباقي للعميل</span>
                  <span className="font-medium text-blue-600 dark:text-blue-400">
                    {formatMoney(Number(invoice.amountPaid) - Number(invoice.total), 3)}
                  </span>
                </div>
              )}
            </>
          )}
          {invoice.type === 'CREDIT' && invoice.status === 'CONFIRMED' && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">الرصيد المتبقي</span>
              <span className={`font-medium ${Number(invoice.balance) > 0 ? 'text-red-500' : 'text-green-600'}`}>
                {formatMoney(invoice.balance)}
              </span>
            </div>
          )}
          {invoice.notes && (
            <div className="text-xs text-gray-500 bg-gray-50 dark:bg-gray-700 rounded p-2 mt-2">
              {invoice.notes}
            </div>
          )}
        </div>
      </div>

      {/* Items table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            الأصناف ({invoice.items.length})
          </h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
            <tr>
              <th className="px-4 py-3 text-right font-medium">الصنف</th>
              <th className="px-4 py-3 text-right font-medium">الباركود</th>
              <th className="px-4 py-3 text-center font-medium">الكمية</th>
              <th className="px-4 py-3 text-center font-medium">سعر الوحدة</th>
              <th className="px-4 py-3 text-center font-medium">الإجمالي</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {invoice.items.map((line) => (
              <tr key={line.id}>
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900 dark:text-white">{line.item.name_ar}</div>
                  <div className="text-xs text-gray-400">{line.item.name_en}</div>
                </td>
                <td className="px-4 py-3 text-gray-500 font-mono text-xs">{line.item.barcode ?? '—'}</td>
                <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300">
                  {formatNumber(line.quantity)}
                </td>
                <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300">
                  {formatMoney(line.unitPrice)}
                </td>
                <td className="px-4 py-3 text-center font-medium text-gray-900 dark:text-white">
                  {formatMoney(line.subtotal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Action buttons */}
      {isEditable && (
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={handleConfirmClick}
            disabled={actionLoading}
            className="px-6 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium text-sm"
          >
            {actionLoading ? 'جار التأكيد...' : 'إكمال البيع / تأكيد'}
          </button>
          <button
            onClick={() => router.push(`/sales/new?resumeId=${invoice.id}`)}
            disabled={actionLoading}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium text-sm"
          >
            تعديل الفاتورة
          </button>
          <button
            onClick={handleCancel}
            disabled={actionLoading}
            className="px-6 py-2.5 bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50 font-medium text-sm"
          >
            {actionLoading ? 'جار الإلغاء...' : 'إلغاء الفاتورة'}
          </button>
        </div>
      )}

      {showPayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div dir="rtl" className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">تسوية الدفع النقدي</h2>
            <div className="space-y-3 mb-5">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">المبلغ المستحق</span>
                <span className="font-bold text-gray-900 dark:text-white">{formatMoney(invoice.total)}</span>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">المبلغ المستلم</label>
                <input
                  type="number"
                  min={Number(invoice.total)}
                  step="1"
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(Number(e.target.value))}
                  autoFocus
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-lg font-bold text-center"
                />
              </div>
              {change > 0 && (
                <div className="flex justify-between text-sm text-blue-600">
                  <span>الباقي للعميل</span>
                  <span className="font-bold">{formatMoney(change)}</span>
                </div>
              )}
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowPayModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 text-sm"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={paidAmount < Number(invoice.total) || actionLoading}
                onClick={() => doConfirm(paidAmount)}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg text-sm disabled:opacity-50"
              >
                تأكيد الدفع
              </button>
            </div>
          </div>
        </div>
      )}

      {invoice.status === 'CONFIRMED' && (
        <div className="flex gap-3">
          <button
            onClick={handleReturn}
            disabled={actionLoading}
            className="px-6 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 font-medium text-sm"
          >
            {actionLoading ? 'جار الإرجاع...' : 'إرجاع الفاتورة'}
          </button>
          <button
            onClick={handleCancel}
            disabled={actionLoading}
            className="px-6 py-2.5 bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50 font-medium text-sm"
          >
            {actionLoading ? 'جار الإلغاء...' : 'إلغاء الفاتورة'}
          </button>
        </div>
      )}
    </div>
  )
}
