'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import { salesService } from '@/services/sales.service'
import api from '@/lib/api'
import { formatMoney } from '@/lib/currency'
import { formatDateTime } from '@/lib/dates'
import { InvoiceMarketingFooter } from '@/components/print/InvoiceMarketingFooter'
import { resolvePaper, thermalPrintCss } from '@/components/print/thermalReceiptStyles'

type InvoiceStatus = 'DRAFT' | 'CONFIRMED' | 'CANCELLED' | 'RETURNED' | 'QUOTE'
type PaymentType = 'CASH' | 'CREDIT'
type PriceType = 'RETAIL' | 'WHOLESALE' | 'SPECIAL' | 'DOLLAR' | 'DINAR'

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'مسودة',
  PARKED: 'معلّقة',
  CONFIRMED: 'مؤكدة',
  CANCELLED: 'ملغاة',
  RETURNED: 'مرتجعة',
  QUOTE: 'عرض سعر',
}

interface InvoiceItem {
  id: string
  quantity: number
  unitPrice: number
  subtotal: number
  item: { id: string; name_ar: string; name_en: string; barcode: string | null }
}

interface Invoice {
  id: string
  invoiceNumber: string
  type: PaymentType
  priceType: PriceType
  subtotal: number
  discount: number
  tax: number
  total: number
  amountPaid: number
  balance: number
  notes: string | null
  status: InvoiceStatus
  createdAt: string
  customer: { id: string; name: string } | null
  createdBy: { id: string; name: string; username: string }
  items: InvoiceItem[]
}

export default function PrintInvoicePage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const id = params.id as string
  const nextPath = searchParams.get('next') || '/sales/new'
  const returnedRef = useRef(false)
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  const goNext = useCallback(() => {
    if (returnedRef.current) return
    returnedRef.current = true
    if (window.opener && !window.opener.closed) {
      try {
        window.opener.location.href = nextPath
      } catch { /* cross-origin — ignore */ }
      window.close()
      return
    }
    router.replace(nextPath)
  }, [nextPath, router])

  useEffect(() => {
    const onAfterPrint = () => goNext()
    window.addEventListener('afterprint', onAfterPrint)
    return () => window.removeEventListener('afterprint', onAfterPrint)
  }, [goNext])

  useEffect(() => {
    Promise.all([
      salesService.getById(id),
      api.get('/api/settings'),
    ])
      .then(([invRes, setRes]) => {
        setInvoice(invRes.data)
        setSettings(setRes.data?.data ?? {})
        setTimeout(() => window.print(), 500)
      })
      .catch(() => setError('فشل في تحميل الفاتورة'))
  }, [id])

  if (error) {
    return <div dir="rtl" className="p-8 text-red-600">{error}</div>
  }

  if (!invoice) {
    return <div dir="rtl" className="p-8 text-gray-500 text-center">جار التحميل...</div>
  }

  const discountAmount = Number(invoice.subtotal) * (Number(invoice.discount) / 100)
  const invDiscountType = (invoice as { discountType?: string }).discountType === 'FIXED' ? 'FIXED' : 'PERCENT'
  const discountAmountDisplay =
    invDiscountType === 'FIXED' ? Number(invoice.discount) : Number(invoice.subtotal) * (Number(invoice.discount) / 100)
  const taxAmount = Number(invoice.tax ?? 0)
  const taxPct = Number(settings.tax_rate || 0)
  const change = Number(invoice.amountPaid) - Number(invoice.total)
  const paper = resolvePaper(settings, searchParams.get('paper'))
  const isThermal = paper === '58' || paper === '80'
  const pageSize = isThermal ? `${paper}mm auto` : 'A4'
  const maxW = paper === '80' ? '80mm' : paper === '58' ? '58mm' : '42rem'

  return (
    <>
      <style>{thermalPrintCss(paper as '58' | '80' | 'A4')}</style>
      <style>{`
        @media print {
          @page { margin: ${isThermal ? '1.5mm' : '8mm'}; size: ${pageSize}; }
        }
      `}</style>

      <div className="no-print fixed top-4 left-4 flex gap-2 z-10">
        <button onClick={() => window.print()} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
          🖨️ طباعة
        </button>
        <a href={`?paper=58&next=${encodeURIComponent(nextPath)}`} className="px-3 py-2 border rounded-lg text-xs bg-white">معاينة 58</a>
        <a href={`?paper=80&next=${encodeURIComponent(nextPath)}`} className="px-3 py-2 border rounded-lg text-xs bg-white">معاينة 80</a>
        <button onClick={goNext} className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
          فاتورة جديدة
        </button>
      </div>

      <div
        dir="rtl"
        className={`receipt-root mx-auto bg-white text-gray-900 ${isThermal ? `thermal-narrow p-2` : 'p-6'}`}
        style={{ maxWidth: maxW }}
      >
        <div className={`text-center mb-4 border-b border-dashed border-gray-600 pb-3 ${isThermal ? '' : 'border-b-2 border-gray-800 pb-4 mb-6'}`}>
          <h1 className="receipt-title">{settings.business_name_ar || '—'}</h1>
          {!settings.business_name_ar && (
            <p className="text-xs text-amber-600 mt-1">أضف اسم النشاط من الإعدادات ليظهر على الفاتورة</p>
          )}
          {settings.business_address && <p className="text-sm text-gray-500 mt-1">{settings.business_address}</p>}
          {settings.business_phone && <p className="text-sm text-gray-500">ت: {settings.business_phone}</p>}
          <p className="text-sm text-blue-800 mt-2 font-medium">فاتورة مبيعات</p>
        </div>

        <div className="flex justify-between items-start mb-6 gap-4">
          <div className="space-y-1 text-sm">
            <div><span className="text-gray-500">رقم الفاتورة: </span><span className="font-bold font-mono">{invoice.invoiceNumber}</span></div>
            <div><span className="text-gray-500">التاريخ: </span><span>{formatDateTime(invoice.createdAt)}</span></div>
            <div><span className="text-gray-500">الحالة: </span><span className="font-medium">{STATUS_LABELS[invoice.status] ?? invoice.status}</span></div>
          </div>
          <div className="space-y-1 text-sm text-left">
            <div><span className="text-gray-500">العميل: </span><span className="font-medium">{invoice.customer?.name ?? 'عميل'}</span></div>
            <div><span className="text-gray-500">طريقة الدفع: </span><span>{invoice.type === 'CASH' ? 'نقدي' : 'آجل'}</span></div>
            <div><span className="text-gray-500">المحرر: </span><span>{invoice.createdBy?.name}</span></div>
          </div>
        </div>

        {isThermal ? (
          <div className="space-y-2 mb-4 text-xs">
            {invoice.items.map((line, idx) => (
              <div key={line.id} className="border-b border-dashed border-gray-300 pb-1">
                <div className="item-name font-medium">{line.item.name_ar}</div>
                <div className="receipt-line text-gray-600">
                  <span>{Number(line.quantity)} × {formatMoney(line.unitPrice)}</span>
                  <span>{formatMoney(line.subtotal)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
        <table className="w-full text-sm mb-6 border-collapse receipt-items">
          <thead>
            <tr className="bg-gray-100 border border-gray-300">
              <th className="px-2 py-2 text-right font-medium border border-gray-300">#</th>
              <th className="px-2 py-2 text-right font-medium border border-gray-300">الصنف</th>
              <th className="px-2 py-2 text-center font-medium border border-gray-300">الكمية</th>
              <th className="px-2 py-2 text-center font-medium border border-gray-300">السعر</th>
              <th className="px-2 py-2 text-center font-medium border border-gray-300">الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((line, idx) => (
              <tr key={line.id} className="border border-gray-300">
                <td className="px-2 py-2 text-center border border-gray-300 text-gray-500">{idx + 1}</td>
                <td className="px-2 py-2 border border-gray-300">
                  <div className="font-medium">{line.item.name_ar}</div>
                  {line.item.barcode && <div className="text-xs text-gray-400 font-mono">{line.item.barcode}</div>}
                </td>
                <td className="px-2 py-2 text-center border border-gray-300">{Number(line.quantity).toLocaleString("en-EG", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</td>
                <td className="px-2 py-2 text-center border border-gray-300">{formatMoney(line.unitPrice)}</td>
                <td className="px-2 py-2 text-center border border-gray-300 font-medium">{formatMoney(line.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        )}

        <div className={`mb-4 ${isThermal ? '' : 'flex justify-end mb-6'}`}>
          <div className={`space-y-1 ${isThermal ? 'text-xs' : 'w-64 text-sm'}`}>
            <div className="flex justify-between">
              <span className="text-gray-500">المجموع الفرعي</span>
              <span>{formatMoney(invoice.subtotal)}</span>
            </div>
            {Number(invoice.discount) > 0 && (
              <div className="flex justify-between text-red-600">
                <span>الخصم {invDiscountType === 'FIXED' ? '(مبلغ)' : `(${Number(invoice.discount)}%)`}</span>
                <span>- {formatMoney(discountAmountDisplay)}</span>
              </div>
            )}
            {taxAmount > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-500">ض.ق.م متضمنة{taxPct ? ` (${taxPct}%)` : ''}</span>
                <span>{formatMoney(taxAmount)}</span>
              </div>
            )}
            <div className="receipt-line receipt-total border-t border-gray-800 pt-2 mt-2">
              <span>الإجمالي</span>
              <span>{formatMoney(invoice.total)}</span>
            </div>
            {invoice.type === 'CASH' && Number(invoice.amountPaid) > 0 && (
              <>
                <div className="flex justify-between text-green-700">
                  <span>المبلغ المستلم</span>
                  <span>{formatMoney(invoice.amountPaid)}</span>
                </div>
                {change > 0 && (
                  <div className="flex justify-between text-blue-700">
                    <span>الباقي للعميل</span>
                    <span>{formatMoney(change)}</span>
                  </div>
                )}
              </>
            )}
            {invoice.type === 'CREDIT' && (
              <div className="flex justify-between text-red-600">
                <span>الرصيد المتبقي</span>
                <span>{formatMoney(invoice.balance)}</span>
              </div>
            )}
          </div>
        </div>

        {invoice.notes && (
          <div className="border border-gray-300 rounded p-3 text-sm text-gray-600 mb-6">
            <span className="font-medium">ملاحظات: </span>{invoice.notes}
          </div>
        )}

        <div className="border-t border-gray-300 pt-4 text-center text-xs text-gray-400">
          {settings.invoice_footer_ar || 'شكراً لتعاملكم معنا'}
        </div>
        <InvoiceMarketingFooter settings={settings} />
      </div>
    </>
  )
}
