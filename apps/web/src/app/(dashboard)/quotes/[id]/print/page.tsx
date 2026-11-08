'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { quotesService } from '@/services/quotes.service'
import { openQuotePrintWindow } from '@/components/quotes/QuotePrintContent'
import api from '@/lib/api'

export default function QuotePrintPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      quotesService.getById(id),
      api.get('/api/settings'),
    ]).then(([quoteRes, settingsRes]) => {
      const q = quoteRes.data
      const settings = settingsRes.data?.data ?? {}
      const taxPct = Number(settings.tax_rate || 0)
      const subtotal = Number(q.subtotal)
      const discountPct = Number(q.discount)
      const discountAmount = subtotal * (discountPct / 100)
      const afterDiscount = subtotal - discountAmount
      const taxAmount = afterDiscount * (taxPct / 100)
      const total = afterDiscount + taxAmount

      openQuotePrintWindow({
        quoteNumber: q.invoiceNumber,
        createdAt: q.createdAt,
        businessNameAr: settings.business_name_ar,
        businessPhone: settings.business_phone,
        businessAddress: settings.business_address,
        customerName: q.customer?.name ?? (q.notes?.includes('العميل:') ? q.notes.split('\n')[0].replace('العميل:', '').trim() : ''),
        lines: q.items.map((row: { item: { name_ar: string; barcode: string | null }; quantity: number; unitPrice: number; subtotal: number }) => ({
          nameAr: row.item.name_ar,
          barcode: row.item.barcode ?? undefined,
          quantity: Number(row.quantity),
          unitPrice: Number(row.unitPrice),
          lineTotal: Number(row.subtotal),
        })),
        subtotal,
        discountPct,
        discountAmount,
        taxPct,
        taxAmount,
        total,
        notes: q.notes,
        marketingSettings: settings,
      })
      setTimeout(() => router.push('/quotes'), 500)
    }).catch(() => setError('فشل في تحميل عرض السعر'))
  }, [id, router])

  if (error) return <div dir="rtl" className="p-8 text-red-600">{error}</div>
  return <div dir="rtl" className="p-8 text-gray-500 text-center">جار فتح نافذة الطباعة...</div>
}
