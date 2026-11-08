'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { reportsService } from '@/services/reports.service'

function fmt(n: number): string {
  return n.toLocaleString('ar-EG', { maximumFractionDigits: 0 })
}

function defaultFrom(): string {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toISOString().slice(0, 10)
}

export function ProductMovementSummary() {
  const router = useRouter()
  const [top, setTop] = useState<{ nameAr: string; quantitySold: number }[]>([])
  const [slow, setSlow] = useState<{ nameAr: string; daysSinceSale: number | null; status: string }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const to = new Date().toISOString().slice(0, 10)
    reportsService
      .getProductMovement({ from: defaultFrom(), to, slowDays: 30, limit: 5 })
      .then((res) => {
        setTop((res.data?.topSelling ?? []).slice(0, 5))
        setSlow((res.data?.slowMoving ?? []).slice(0, 5))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return null

  if (top.length === 0 && slow.length === 0) return null

  return (
    <div className="mb-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">🔥 الأكثر مبيعاً (30 يوم)</h2>
          <button onClick={() => router.push('/reports/product-movement')} className="text-xs text-blue-600 hover:underline">
            التفاصيل
          </button>
        </div>
        {top.length === 0 ? (
          <p className="text-xs text-gray-500">لا توجد مبيعات بعد</p>
        ) : (
          <ul className="space-y-2">
            {top.map((item, i) => (
              <li key={i} className="flex justify-between text-sm">
                <span className="text-gray-800 dark:text-gray-200 truncate ml-2">
                  <span className="text-emerald-600 font-bold ml-1">{i + 1}.</span> {item.nameAr}
                </span>
                <span className="text-blue-600 font-medium shrink-0">{fmt(item.quantitySold)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-amber-700 dark:text-amber-400">⚠️ راكد / مش بيتباع</h2>
          <button onClick={() => router.push('/reports/product-movement')} className="text-xs text-blue-600 hover:underline">
            التفاصيل
          </button>
        </div>
        {slow.length === 0 ? (
          <p className="text-xs text-gray-500">لا توجد أصناف راكدة</p>
        ) : (
          <ul className="space-y-2">
            {slow.map((item, i) => (
              <li key={i} className="flex justify-between text-sm">
                <span className="text-gray-800 dark:text-gray-200 truncate ml-2">{item.nameAr}</span>
                <span className="text-amber-700 text-xs shrink-0">
                  {item.status === 'NEVER_SOLD' ? 'لم يُبَع' : `${item.daysSinceSale} يوم`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
