'use client'

import { useState } from 'react'
import { reportsService } from '@/services/reports.service'
import { formatMoney, formatNumber } from '@/lib/currency'

function getDefaultFrom(): string {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}

function getDefaultTo(): string {
  return new Date().toISOString().slice(0, 10)
}

interface CatRow {
  categoryId: string
  categoryNameAr: string
  totalEGP: number
  count: number
}

interface DailyRow {
  date: string
  total: number
}

export default function ExpenseAnalysisPage() {
  const [from, setFrom] = useState(getDefaultFrom())
  const [to, setTo] = useState(getDefaultTo())
  const [summary, setSummary] = useState<{ totalEGP: number; count: number; dayCount: number; dailyAverage: number } | null>(null)
  const [byCategory, setByCategory] = useState<CatRow[]>([])
  const [daily, setDaily] = useState<DailyRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searched, setSearched] = useState(false)

  async function handleSearch() {
    setLoading(true)
    setError('')
    try {
      const res = await reportsService.getExpenseAnalysis({ from, to })
      setSummary(res.data.summary ?? null)
      setByCategory(res.data.byCategory ?? [])
      setDaily(res.data.daily ?? [])
      setSearched(true)
    } catch {
      setError('حدث خطأ أثناء تحميل البيانات')
    } finally {
      setLoading(false)
    }
  }

  const maxDay = daily.length ? Math.max(...daily.map((d) => d.total), 1) : 1

  return (
    <div dir="rtl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">تحليل المصروفات</h1>
        <p className="text-sm text-gray-500 mt-1">تفصيل بالفئة وسلسلة يومية للفترة المحددة</p>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 mb-5 flex flex-wrap gap-4 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">من</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border rounded-lg px-3 py-2" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">إلى</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border rounded-lg px-3 py-2" />
        </div>
        <button type="button" onClick={handleSearch} disabled={loading}
          className="px-5 py-2 bg-blue-600 text-white rounded-lg font-medium disabled:opacity-50">
          {loading ? 'جار التحميل...' : 'عرض'}
        </button>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="rounded-xl border bg-rose-50 p-4"><p className="text-xs text-rose-700">الإجمالي</p><p className="text-xl font-bold">{formatMoney(summary.totalEGP)}</p></div>
          <div className="rounded-xl border bg-gray-50 p-4"><p className="text-xs text-gray-600">عدد القيود</p><p className="text-xl font-bold">{formatNumber(summary.count)}</p></div>
          <div className="rounded-xl border bg-gray-50 p-4"><p className="text-xs text-gray-600">أيام الفترة</p><p className="text-xl font-bold">{formatNumber(summary.dayCount)}</p></div>
          <div className="rounded-xl border bg-amber-50 p-4"><p className="text-xs text-amber-700">متوسط يومي</p><p className="text-xl font-bold">{formatMoney(summary.dailyAverage)}</p></div>
        </div>
      )}

      {searched && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white dark:bg-gray-800 rounded-xl border overflow-hidden">
            <h2 className="p-3 font-semibold border-b">حسب الفئة</h2>
            <table className="w-full text-sm">
              <thead className="bg-gray-50"><tr>
                <th className="p-2 text-right">الفئة</th>
                <th className="p-2 text-right">العدد</th>
                <th className="p-2 text-right">الإجمالي</th>
              </tr></thead>
              <tbody>
                {byCategory.length === 0 ? (
                  <tr><td colSpan={3} className="p-4 text-gray-400">لا توجد مصروفات</td></tr>
                ) : byCategory.map((c) => (
                  <tr key={c.categoryId} className="border-t">
                    <td className="p-2">{c.categoryNameAr}</td>
                    <td className="p-2">{c.count}</td>
                    <td className="p-2 font-medium">{formatMoney(c.totalEGP)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border p-4">
            <h2 className="font-semibold mb-3">يومياً</h2>
            {daily.length === 0 ? (
              <p className="text-sm text-gray-400">لا بيانات</p>
            ) : (
              <div className="flex items-end gap-1 h-32">
                {daily.map((d) => (
                  <div key={d.date} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                    <div className="w-full bg-rose-500 rounded-t" style={{ height: `${Math.max(8, (d.total / maxDay) * 100)}%` }} title={`${d.date}: ${formatMoney(d.total)}`} />
                    <span className="text-[9px] text-gray-400 truncate w-full text-center">{d.date.slice(8)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
