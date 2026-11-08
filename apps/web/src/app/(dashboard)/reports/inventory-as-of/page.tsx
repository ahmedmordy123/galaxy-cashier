'use client'

import { useState } from 'react'
import { reportsService } from '@/services/reports.service'
import { formatMoney, formatNumber } from '@/lib/currency'
import { localDateISO } from '@/lib/dates'

interface AsOfItem {
  id: string
  nameAr: string
  barcode: string | null
  currentQty: number
  asOfQty: number
  costPrice: number
  retailPrice: number
  costValue: number
  retailValue: number
  category: string
}

export default function InventoryAsOfPage() {
  const [date, setDate] = useState(localDateISO())
  const [items, setItems] = useState<AsOfItem[]>([])
  const [summary, setSummary] = useState<{ totalItems: number; totalCostValue: number; totalRetailValue: number; totalQty: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSearch() {
    setLoading(true)
    setError('')
    try {
      const res = await reportsService.getInventoryAsOf(date)
      setItems(res.data.items ?? [])
      setSummary(res.data.summary ?? null)
    } catch {
      setError('حدث خطأ أثناء تحميل البيانات')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div dir="rtl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">تقييم مخزون بتاريخ</h1>
        <p className="text-sm text-gray-500 mt-1">الكمية كما كانت في نهاية اليوم المحدد، بالقيمة حسب تكلفة اليوم</p>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 mb-5 flex flex-wrap gap-4 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">التاريخ</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border rounded-lg px-3 py-2" />
        </div>
        <button type="button" onClick={handleSearch} disabled={loading}
          className="px-5 py-2 bg-blue-600 text-white rounded-lg font-medium disabled:opacity-50">
          {loading ? 'جار التحميل...' : 'عرض'}
        </button>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="rounded-xl border bg-purple-50 p-4"><p className="text-xs text-purple-700">قيمة التكلفة</p><p className="text-xl font-bold">{formatMoney(summary.totalCostValue)}</p></div>
          <div className="rounded-xl border bg-blue-50 p-4"><p className="text-xs text-blue-700">قيمة البيع</p><p className="text-xl font-bold">{formatMoney(summary.totalRetailValue)}</p></div>
          <div className="rounded-xl border bg-gray-50 p-4"><p className="text-xs text-gray-600">إجمالي الكمية</p><p className="text-xl font-bold">{formatNumber(summary.totalQty)}</p></div>
          <div className="rounded-xl border bg-gray-50 p-4"><p className="text-xs text-gray-600">عدد الأصناف</p><p className="text-xl font-bold">{formatNumber(summary.totalItems)}</p></div>
        </div>
      )}

      {items.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-2 text-right">الصنف</th>
                <th className="p-2 text-right">بتاريخ</th>
                <th className="p-2 text-right">الحالي</th>
                <th className="p-2 text-right">قيمة التكلفة</th>
                <th className="p-2 text-right">قيمة البيع</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-t">
                  <td className="p-2">{i.nameAr} {i.barcode ? <span className="text-gray-400 font-mono text-xs">{i.barcode}</span> : null}</td>
                  <td className="p-2 font-medium">{formatNumber(i.asOfQty)}</td>
                  <td className="p-2 text-gray-500">{formatNumber(i.currentQty)}</td>
                  <td className="p-2">{formatMoney(i.costValue)}</td>
                  <td className="p-2">{formatMoney(i.retailValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
