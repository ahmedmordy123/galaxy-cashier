'use client'

import { useState } from 'react'
import { reportsService } from '@/services/reports.service'
import { formatMoney, formatNumber } from '@/lib/currency'

function isoDaysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

interface MetricDiff {
  a: number
  b: number
  abs: number
  pct: number
}

export default function PeriodComparePage() {
  const [fromA, setFromA] = useState(isoDaysAgo(6))
  const [toA, setToA] = useState(today())
  const [fromB, setFromB] = useState(isoDaysAgo(13))
  const [toB, setToB] = useState(isoDaysAgo(7))
  const [data, setData] = useState<{
    periodA: Record<string, number | string>
    periodB: Record<string, number | string>
    diff: Record<string, MetricDiff>
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSearch() {
    setLoading(true)
    setError('')
    try {
      const res = await reportsService.getPeriodCompare({ fromA, toA, fromB, toB })
      setData(res.data)
    } catch {
      setError('حدث خطأ أثناء تحميل البيانات')
    } finally {
      setLoading(false)
    }
  }

  const rows: Array<{ key: string; label: string; money?: boolean }> = [
    { key: 'netSales', label: 'صافي المبيعات', money: true },
    { key: 'invoiceCount', label: 'عدد الفواتير' },
    { key: 'expenses', label: 'المصروفات', money: true },
    { key: 'grossProfit', label: 'الربح الإجمالي', money: true },
  ]

  function fmt(key: string, n: number, money?: boolean) {
    if (key === 'grossProfit' && data && data.diff.grossProfit == null) return '—'
    return money ? formatMoney(n) : formatNumber(n)
  }

  return (
    <div dir="rtl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">مقارنة فترتين</h1>
        <p className="text-sm text-gray-500 mt-1">الفرق = الفترة أ − الفترة ب (مبلغ ونسبة)</p>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 mb-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-sm font-semibold mb-2">الفترة أ</p>
            <div className="flex gap-2">
              <input type="date" value={fromA} onChange={(e) => setFromA(e.target.value)} className="border rounded-lg px-3 py-2 flex-1" />
              <input type="date" value={toA} onChange={(e) => setToA(e.target.value)} className="border rounded-lg px-3 py-2 flex-1" />
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold mb-2">الفترة ب</p>
            <div className="flex gap-2">
              <input type="date" value={fromB} onChange={(e) => setFromB(e.target.value)} className="border rounded-lg px-3 py-2 flex-1" />
              <input type="date" value={toB} onChange={(e) => setToB(e.target.value)} className="border rounded-lg px-3 py-2 flex-1" />
            </div>
          </div>
        </div>
        <button type="button" onClick={handleSearch} disabled={loading}
          className="px-5 py-2 bg-blue-600 text-white rounded-lg font-medium disabled:opacity-50">
          {loading ? 'جار التحميل...' : 'مقارنة'}
        </button>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

      {data && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-3 text-right">المؤشر</th>
                <th className="p-3 text-right">أ</th>
                <th className="p-3 text-right">ب</th>
                <th className="p-3 text-right">الفرق</th>
                <th className="p-3 text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const d = data.diff[row.key]
                if (!d) return null
                const up = d.abs > 0.009
                const down = d.abs < -0.009
                return (
                  <tr key={row.key} className="border-t">
                    <td className="p-3 font-medium">{row.label}</td>
                    <td className="p-3">{fmt(row.key, d.a, row.money)}</td>
                    <td className="p-3">{fmt(row.key, d.b, row.money)}</td>
                    <td className={`p-3 font-semibold ${up ? 'text-emerald-700' : down ? 'text-red-700' : ''}`}>
                      {row.money ? formatMoney(d.abs) : formatNumber(d.abs)}
                    </td>
                    <td className={`p-3 ${up ? 'text-emerald-700' : down ? 'text-red-700' : ''}`}>
                      {formatNumber(d.pct)}%
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
