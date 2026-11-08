'use client'



import { useState, useEffect } from 'react'

import { useParams, useRouter } from 'next/navigation'

import { vouchersService } from '@/services/vouchers.service'
import api from '@/lib/api'

import { formatMoney } from '@/lib/currency'
import { formatDateTime } from '@/lib/dates'
import { InvoiceMarketingFooter } from '@/components/print/InvoiceMarketingFooter'



type VoucherType = 'RECEIPT' | 'DISBURSEMENT'

type EntityType = 'CUSTOMER' | 'SUPPLIER' | 'OTHER'



interface Voucher {

  id: string

  voucherNumber: string

  type: VoucherType

  entityType: EntityType

  entityId: string | null

  entityName: string | null

  amount: string | number

  currency: string

  exchangeRate: string | number

  description: string

  createdAt: string

  createdBy: { id: string; name: string }

}



const TYPE_LABELS: Record<VoucherType, string> = {

  RECEIPT: 'سند قبض',

  DISBURSEMENT: 'سند صرف',

}



const ENTITY_LABELS: Record<EntityType, string> = {

  CUSTOMER: 'عميل',

  SUPPLIER: 'مورد',

  OTHER: 'أخرى',

}



export default function PrintVoucherPage() {

  const params = useParams()

  const router = useRouter()

  const id = params.id as string



  const [voucher, setVoucher] = useState<Voucher | null>(null)
  const [businessName, setBusinessName] = useState('')
  const [printSettings, setPrintSettings] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      vouchersService.getById(id),
      api.get('/api/settings'),
    ])
      .then(([res, setRes]: [{ data: Voucher }, { data?: { data?: Record<string, string> } }]) => {
        setVoucher(res.data)
        setBusinessName(setRes.data?.data?.business_name_ar ?? '')
        setPrintSettings(setRes.data?.data ?? {})
        setTimeout(() => window.print(), 500)
      })
      .catch(() => setError('فشل في تحميل السند'))
  }, [id])



  if (error) {

    return <div dir="rtl" className="p-8 text-red-600">{error}</div>

  }



  if (!voucher) {

    return <div dir="rtl" className="p-8 text-gray-500 text-center">جار التحميل...</div>

  }



  return (

    <>

      <style>{`

        @media print {
          html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
          .no-print { display: none !important; }
          @page { margin: 10mm; size: A4; }
        }

        body { font-family: 'Segoe UI', Tahoma, sans-serif; }

      `}</style>



      <div className="no-print fixed top-4 left-4 flex gap-2 z-10">

        <button

          onClick={() => window.print()}

          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"

        >

          🖨️ طباعة

        </button>

        <button

          onClick={() => router.back()}

          className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50"

        >

          رجوع

        </button>

      </div>



      <div dir="rtl" className="max-w-lg mx-auto p-8 bg-white text-gray-900">

        <div className="text-center mb-6 border-b-2 border-gray-800 pb-4">

          <h1 className="text-2xl font-bold">{businessName || '—'}</h1>

          <p className="text-xl font-semibold mt-1">

            {TYPE_LABELS[voucher.type]}

          </p>

        </div>



        <div className="flex justify-between text-sm mb-6">

          <div className="space-y-1">

            <div>

              <span className="text-gray-500">رقم السند: </span>

              <span className="font-bold font-mono">{voucher.voucherNumber}</span>

            </div>

            <div>

              <span className="text-gray-500">التاريخ: </span>

              <span>{formatDateTime(voucher.createdAt)}</span>

            </div>

          </div>

          <div className="space-y-1 text-left">

            <div>

              <span className="text-gray-500">المحرر: </span>

              <span className="font-medium">{voucher.createdBy.name}</span>

            </div>

            {voucher.entityType !== 'OTHER' && (

              <div>

                <span className="text-gray-500">{ENTITY_LABELS[voucher.entityType]}: </span>

                <span className="font-medium">{voucher.entityName ?? '—'}</span>

              </div>

            )}

          </div>

        </div>



        <div className="border-2 border-gray-800 rounded-lg p-6 text-center mb-6">

          <p className="text-sm text-gray-500 mb-2">المبلغ</p>

          <p className="text-4xl font-bold text-gray-900">

            {formatMoney(voucher.amount)}

          </p>

          <p className="text-sm text-gray-500 mt-2">جنيه مصري</p>

        </div>



        <div className="border border-gray-300 rounded p-4 mb-8 text-sm">

          <span className="text-gray-500 font-medium">البيان: </span>

          <span>{voucher.description}</span>

        </div>



        <div className="grid grid-cols-2 gap-8 text-sm text-center">

          <div>

            <p className="text-gray-500 mb-8">توقيع المُسلِّم</p>

            <div className="border-t border-gray-400 pt-1">المُسلِّم</div>

          </div>

          <div>

            <p className="text-gray-500 mb-8">توقيع المُستلِم</p>

            <div className="border-t border-gray-400 pt-1">المُستلِم</div>

          </div>

        </div>



        <div className="border-t border-gray-200 pt-4 mt-6 text-center text-xs text-gray-400">
          {printSettings.invoice_footer_ar || 'شكراً لتعاملكم معنا'}
        </div>
        <InvoiceMarketingFooter settings={printSettings} />

      </div>

    </>

  )

}

