'use client'

import { useCallback, useEffect, useState } from 'react'
import api from '@/lib/api'
import { formatMoney } from '@/lib/currency'

type GroupBy = 'item' | 'customer' | 'cashier' | 'day' | 'month' | 'warehouse'

export default function SalesAnalysisPage() {
  const [groupBy, setGroupBy] = useState<GroupBy>('item')
  const [from, setFrom] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
  })
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [data, setData] = useState<{
    totals: { revenue: number; cost: number; profit: number; margin: number; qty: number }
    rows: Array<{ key: string; label: string; qty: number; revenue: number; cost: number; profit: number; invoices: number }>
    invoiceCount: number
  } | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/api/ops/sales-analysis', { params: { groupBy, from, to } })
      setData(res.data.data)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [groupBy, from, to])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div dir="rtl" className="space-y-4">
      <h1 className="text-2xl font-bold">تحليل المبيعات</h1>
      <p className="text-sm text-gray-500">إيرادات وتكلفة وربح — مثل تقرير سهل</p>

      <div className="flex flex-wrap gap-3 items-end bg-white dark:bg-gray-800 p-4 rounded-xl border">
        <label className="text-sm">من
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="block mt-1 border rounded px-2 py-1" />
        </label>
        <label className="text-sm">إلى
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="block mt-1 border rounded px-2 py-1" />
        </label>
        <label className="text-sm">تجميع
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} className="block mt-1 border rounded px-2 py-1">
            <option value="item">صنف</option>
            <option value="customer">عميل</option>
            <option value="cashier">كاشير</option>
            <option value="warehouse">مخزن</option>
            <option value="day">يوم</option>
            <option value="month">شهر</option>
          </select>
        </label>
        <button onClick={load} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">عرض</button>
      </div>

      {loading && <p>جار التحميل...</p>}
      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-4 rounded-xl bg-blue-50 border"><div className="text-xs text-gray-500">إيراد</div><div className="font-bold text-lg">{formatMoney(data.totals.revenue)}</div></div>
            <div className="p-4 rounded-xl bg-amber-50 border"><div className="text-xs text-gray-500">تكلفة</div><div className="font-bold text-lg">{formatMoney(data.totals.cost)}</div></div>
            <div className="p-4 rounded-xl bg-green-50 border"><div className="text-xs text-gray-500">ربح</div><div className="font-bold text-lg">{formatMoney(data.totals.profit)}</div></div>
            <div className="p-4 rounded-xl bg-purple-50 border"><div className="text-xs text-gray-500">هامش %</div><div className="font-bold text-lg">{data.totals.margin.toFixed(1)}%</div></div>
          </div>
          <p className="text-sm text-gray-500">عدد الفواتير: {data.invoiceCount}</p>
          <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="p-3 text-right">البند</th>
                  <th className="p-3 text-right">كمية</th>
                  <th className="p-3 text-right">إيراد</th>
                  <th className="p-3 text-right">تكلفة</th>
                  <th className="p-3 text-right">ربح</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.key} className="border-t">
                    <td className="p-3">{r.label}</td>
                    <td className="p-3">{r.qty}</td>
                    <td className="p-3">{formatMoney(r.revenue)}</td>
                    <td className="p-3">{formatMoney(r.cost)}</td>
                    <td className="p-3 font-medium text-green-700">{formatMoney(r.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
