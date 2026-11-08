'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { quotesService } from '@/services/quotes.service'
import { formatMoney } from '@/lib/currency'

export default function QuotesListPage() {
  const router = useRouter()
  const [quotes, setQuotes] = useState<Array<{
    id: string
    invoiceNumber: string
    total: number
    createdAt: string
    customer: { name: string } | null
    _count: { items: number }
  }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    quotesService.getAll({ limit: 50 })
      .then((res) => setQuotes(res.data?.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function convert(id: string) {
    if (!confirm('تحويل عرض السعر لفاتورة مبيعات (مسودة)؟')) return
    try {
      const res = await quotesService.convertToSale(id)
      router.push(`/sales/${res.data.id}`)
    } catch {
      alert('فشل التحويل')
    }
  }

  return (
    <div dir="rtl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">عروض الأسعار</h1>
        <button onClick={() => router.push('/quotes/new')}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
          + عرض سعر جديد
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <p className="p-8 text-center text-gray-500">جار التحميل...</p>
        ) : quotes.length === 0 ? (
          <p className="p-8 text-center text-gray-500">لا توجد عروض أسعار محفوظة</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700 text-gray-600">
              <tr>
                <th className="px-4 py-3 text-right">رقم العرض</th>
                <th className="px-4 py-3 text-right">العميل</th>
                <th className="px-4 py-3 text-right">الأصناف</th>
                <th className="px-4 py-3 text-right">الإجمالي</th>
                <th className="px-4 py-3 text-right">التاريخ</th>
                <th className="px-4 py-3 text-right">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-gray-700">
              {quotes.map((q) => (
                <tr key={q.id} className="hover:bg-gray-50 dark:hover:bg-gray-750">
                  <td className="px-4 py-3 font-mono font-medium">{q.invoiceNumber}</td>
                  <td className="px-4 py-3">{q.customer?.name ?? '—'}</td>
                  <td className="px-4 py-3">{q._count.items}</td>
                  <td className="px-4 py-3 font-bold text-blue-700">{formatMoney(Number(q.total))}</td>
                  <td className="px-4 py-3 text-gray-500">{new Date(q.createdAt).toLocaleDateString('ar-EG')}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => router.push(`/quotes/${q.id}/print`)}
                        className="text-xs px-2 py-1 bg-slate-100 rounded hover:bg-slate-200">طباعة</button>
                      <button onClick={() => convert(q.id)}
                        className="text-xs px-2 py-1 bg-green-100 text-green-800 rounded hover:bg-green-200">→ فاتورة</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
