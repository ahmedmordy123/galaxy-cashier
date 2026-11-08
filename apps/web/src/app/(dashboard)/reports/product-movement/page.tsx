'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { reportsService } from '@/services/reports.service'
import { formatNumber } from '@/lib/currency'

interface TopItem {
  itemId: string
  nameAr: string
  nameEn: string
  barcode: string | null
  category: string
  stockQty: number
  quantitySold: number
  revenue: number
}

interface SlowItem {
  itemId: string
  nameAr: string
  nameEn: string
  barcode: string | null
  category: string
  stockQty: number
  stockValue: number
  lastSaleAt: string | null
  daysSinceSale: number | null
  soldInPeriod: number
  status: 'NEVER_SOLD' | 'STALE' | 'OK'
}

function getDefaultFrom(): string {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toISOString().slice(0, 10)
}

function getDefaultTo(): string {
  return new Date().toISOString().slice(0, 10)
}

function fmt(n: number): string {
  return formatNumber(n)
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('ar-EG')
}

export default function ProductMovementReportPage() {
  const router = useRouter()
  const [from, setFrom] = useState(getDefaultFrom())
  const [to, setTo] = useState(getDefaultTo())
  const [slowDays, setSlowDays] = useState(30)
  const [topSelling, setTopSelling] = useState<TopItem[]>([])
  const [slowMoving, setSlowMoving] = useState<SlowItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searched, setSearched] = useState(false)

  async function handleSearch() {
    if (!from || !to) {
      setError('يجب تحديد تاريخ البداية والنهاية')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await reportsService.getProductMovement({ from, to, slowDays, limit: 15 })
      setTopSelling(res.data.topSelling ?? [])
      setSlowMoving(res.data.slowMoving ?? [])
      setSearched(true)
    } catch {
      setError('حدث خطأ أثناء تحميل البيانات')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div dir="rtl">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700 text-sm">← رجوع</button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">حركة الأصناف</h1>
          <p className="text-sm text-gray-500 mt-1">أكثر الأصناف مبيعاً والأصناف الراكدة في المخزون</p>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 mb-5 flex flex-wrap gap-4 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">من تاريخ</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">إلى تاريخ</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">راكد منذ (يوم)</label>
          <select value={slowDays} onChange={(e) => setSlowDays(Number(e.target.value))}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm">
            <option value={15}>15 يوم</option>
            <option value={30}>30 يوم</option>
            <option value={60}>60 يوم</option>
            <option value={90}>90 يوم</option>
          </select>
        </div>
        <button onClick={handleSearch} disabled={loading}
          className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium">
          {loading ? 'جار البحث...' : 'عرض التقرير'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">{error}</div>
      )}

      {searched && !loading && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Top selling */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden border border-gray-100 dark:border-gray-700">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 bg-emerald-50 dark:bg-emerald-900/20">
              <h2 className="font-bold text-emerald-800 dark:text-emerald-300">🔥 الأكثر مبيعاً</h2>
              <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">حسب الكمية المباعة في الفترة</p>
            </div>
            {topSelling.length === 0 ? (
              <p className="p-6 text-center text-gray-500 text-sm">لا توجد مبيعات في هذه الفترة</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                    <tr>
                      <th className="px-4 py-2 text-right">#</th>
                      <th className="px-4 py-2 text-right">الصنف</th>
                      <th className="px-4 py-2 text-right">الكمية</th>
                      <th className="px-4 py-2 text-right">الإيراد (ج.م)</th>
                      <th className="px-4 py-2 text-right">المخزون</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {topSelling.map((item, idx) => (
                      <tr key={item.itemId} className="hover:bg-gray-50 dark:hover:bg-gray-750">
                        <td className="px-4 py-3 font-bold text-emerald-600">{idx + 1}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900 dark:text-white">{item.nameAr}</div>
                          <div className="text-xs text-gray-500">{item.category || item.barcode || '—'}</div>
                        </td>
                        <td className="px-4 py-3 font-bold text-blue-600">{fmt(item.quantitySold)}</td>
                        <td className="px-4 py-3">{fmt(item.revenue)}</td>
                        <td className="px-4 py-3 text-gray-600">{fmt(item.stockQty)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Slow moving */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden border border-gray-100 dark:border-gray-700">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 bg-amber-50 dark:bg-amber-900/20">
              <h2 className="font-bold text-amber-800 dark:text-amber-300">⚠️ راكد / مش بيتباع</h2>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                أصناف في المخزون بدون بيع منذ {slowDays}+ يوم أو لم تُبَع أبداً
              </p>
            </div>
            {slowMoving.length === 0 ? (
              <p className="p-6 text-center text-gray-500 text-sm">لا توجد أصناف راكدة — ممتاز!</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                    <tr>
                      <th className="px-4 py-2 text-right">الصنف</th>
                      <th className="px-4 py-2 text-right">المخزون</th>
                      <th className="px-4 py-2 text-right">قيمة المخزون</th>
                      <th className="px-4 py-2 text-right">آخر بيع</th>
                      <th className="px-4 py-2 text-right">الحالة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {slowMoving.map((item) => (
                      <tr key={item.itemId} className="bg-amber-50/50 dark:bg-amber-900/10 hover:bg-amber-50 dark:hover:bg-amber-900/20">
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900 dark:text-white">{item.nameAr}</div>
                          <div className="text-xs text-gray-500">{item.category || '—'}</div>
                        </td>
                        <td className="px-4 py-3 font-bold text-amber-700">{fmt(item.stockQty)}</td>
                        <td className="px-4 py-3">{fmt(item.stockValue)} ج.م</td>
                        <td className="px-4 py-3 text-xs">
                          {item.status === 'NEVER_SOLD' ? (
                            <span className="text-red-600 font-medium">لم يُبَع أبداً</span>
                          ) : (
                            <>
                              <div>{formatDate(item.lastSaleAt)}</div>
                              <div className="text-gray-500">منذ {item.daysSinceSale} يوم</div>
                            </>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            item.status === 'NEVER_SOLD'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-amber-100 text-amber-800'
                          }`}>
                            {item.status === 'NEVER_SOLD' ? 'بدون مبيعات' : 'راكد'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
