'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { stockService } from '@/services/stock.service'
import { formatDateTime } from '@/lib/dates'

interface CountItem {
  id: string
  barcode: string | null
  name_ar: string
  name_en: string
  unit: string
  stockQty: number | string
  category?: { name_ar: string; name_en: string } | null
}

function CountSheetInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const showQty = searchParams.get('showQty') === '1'
  const categoryId = searchParams.get('categoryId') || ''
  const search = searchParams.get('search') || ''

  const [items, setItems] = useState<CountItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const params: Record<string, string> = {}
        if (search) params.search = search
        if (categoryId) params.categoryId = categoryId
        const res = await stockService.getInventory(params)
        if (!cancelled) setItems(res.data ?? [])
      } catch {
        if (!cancelled) setError('فشل تحميل الأصناف')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [search, categoryId])

  useEffect(() => {
    if (!loading && items.length > 0) {
      const t = setTimeout(() => window.print(), 400)
      return () => clearTimeout(t)
    }
  }, [loading, items.length])

  if (loading) {
    return (
      <div dir="rtl" className="p-8 text-center text-gray-500">
        جار تجهيز ورقة الجرد...
      </div>
    )
  }

  if (error) {
    return (
      <div dir="rtl" className="p-8 text-red-600">
        {error}
      </div>
    )
  }

  return (
    <>
      <style>{`
        @media print {
          @page { margin: 10mm; size: A4; }
          .no-print { display: none !important; }
          body { background: white !important; }
        }
      `}</style>

      <div className="no-print fixed top-4 left-4 flex gap-2 z-10">
        <button
          onClick={() => window.print()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          🖨️ طباعة
        </button>
        <button
          onClick={() => router.push('/inventory')}
          className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50"
        >
          رجوع
        </button>
      </div>

      <div dir="rtl" className="mx-auto max-w-4xl bg-white text-gray-900 p-6">
        <div className="text-center border-b-2 border-gray-800 pb-3 mb-4">
          <h1 className="text-xl font-bold">ورقة جرد مخزون</h1>
          <p className="text-sm text-gray-600 mt-1">
            {showQty
              ? 'مع كمية النظام — للمطابقة بعد العدّ الفعلي'
              : 'بدون أرقام نظام — سجّل الكمية الفعلية ثم طابق مع النظام'}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            التاريخ: {formatDateTime(new Date().toISOString())} — عدد الأصناف: {items.length}
          </p>
        </div>

        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-100 border border-gray-400">
              <th className="px-2 py-2 text-center border border-gray-400 w-10">#</th>
              <th className="px-2 py-2 text-right border border-gray-400">الباركود</th>
              <th className="px-2 py-2 text-right border border-gray-400">الصنف</th>
              <th className="px-2 py-2 text-right border border-gray-400 w-20">الوحدة</th>
              {showQty && (
                <th className="px-2 py-2 text-center border border-gray-400 w-24">كمية النظام</th>
              )}
              <th className="px-2 py-2 text-center border border-gray-400 w-24">الكمية الفعلية</th>
              <th className="px-2 py-2 text-center border border-gray-400 w-28">ملاحظات / فرق</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={item.id} className="border border-gray-300">
                <td className="px-2 py-2.5 text-center border border-gray-300">{idx + 1}</td>
                <td className="px-2 py-2.5 text-right border border-gray-300 font-mono text-xs">
                  {item.barcode || '—'}
                </td>
                <td className="px-2 py-2.5 text-right border border-gray-300">
                  <div className="font-medium">{item.name_ar}</div>
                  {item.category?.name_ar && (
                    <div className="text-xs text-gray-500">{item.category.name_ar}</div>
                  )}
                </td>
                <td className="px-2 py-2.5 text-center border border-gray-300">{item.unit}</td>
                {showQty && (
                  <td className="px-2 py-2.5 text-center border border-gray-300 font-medium">
                    {Number(item.stockQty).toLocaleString('en-EG')}
                  </td>
                )}
                <td className="px-2 py-2.5 border border-gray-300 h-9">&nbsp;</td>
                <td className="px-2 py-2.5 border border-gray-300">&nbsp;</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-6 grid grid-cols-2 gap-6 text-sm">
          <div className="border-t border-gray-400 pt-2">
            توقيع المسؤول: ________________
          </div>
          <div className="border-t border-gray-400 pt-2">
            توقيع الجرد: ________________
          </div>
        </div>
      </div>
    </>
  )
}

export default function InventoryCountSheetPage() {
  return (
    <Suspense
      fallback={
        <div dir="rtl" className="p-8 text-center text-gray-500">
          جار التحميل...
        </div>
      }
    >
      <CountSheetInner />
    </Suspense>
  )
}
