'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { formatMoney, formatNumber } from '@/lib/currency'

interface ReportCard {
  title: string
  description: string
  icon: string
  href: string
  color: string
}

const REPORT_CARDS: ReportCard[] = [
  {
    title: 'تحليل المبيعات',
    description: 'إيراد وتكلفة وربح حسب صنف / عميل / كاشير / يوم / شهر',
    icon: '📐',
    href: '/reports/sales-analysis',
    color: 'bg-indigo-50 border-indigo-200 hover:bg-indigo-100',
  },
  {
    title: 'حركة صنف كاملة',
    description: 'كل حركات الصنف مع متوسط التكلفة بعد كل حركة',
    icon: '📒',
    href: '/reports/item-ledger',
    color: 'bg-slate-50 border-slate-200 hover:bg-slate-100',
  },
  {
    title: 'تقرير المبيعات',
    description: 'عرض وتحليل فواتير المبيعات حسب الفترة الزمنية والعميل',
    icon: '📊',
    href: '/reports/sales',
    color: 'bg-blue-50 border-blue-200 hover:bg-blue-100',
  },
  {
    title: 'تقرير المشتريات',
    description: 'عرض وتحليل فواتير المشتريات حسب الفترة الزمنية والمورد',
    icon: '🛒',
    href: '/reports/purchases',
    color: 'bg-green-50 border-green-200 hover:bg-green-100',
  },
  {
    title: 'تقرير الأرباح',
    description: 'حساب الإيرادات والتكاليف وصافي الربح خلال فترة زمنية',
    icon: '💰',
    href: '/reports/profit',
    color: 'bg-yellow-50 border-yellow-200 hover:bg-yellow-100',
  },
  {
    title: 'حركة الأصناف',
    description: 'أكثر الأصناف مبيعاً والأصناف الراكدة أو التي لم تُبَع منذ فترة',
    icon: '📈',
    href: '/reports/product-movement',
    color: 'bg-rose-50 border-rose-200 hover:bg-rose-100',
  },
  {
    title: 'تحليل المصروفات',
    description: 'إجمالي الفترة، تفصيل بالفئة، ومتوسط يومي',
    icon: '💸',
    href: '/reports/expenses',
    color: 'bg-pink-50 border-pink-200 hover:bg-pink-100',
  },
  {
    title: 'تقرير الجرد',
    description: 'عرض المخزون الحالي مع قيم التكلفة والبيع لكل صنف',
    icon: '📦',
    href: '/reports/inventory',
    color: 'bg-purple-50 border-purple-200 hover:bg-purple-100',
  },
  {
    title: 'مخزون بتاريخ',
    description: 'تقييم الكمية والقيمة كما كانت في يوم محدد',
    icon: '📅',
    href: '/reports/inventory-as-of',
    color: 'bg-violet-50 border-violet-200 hover:bg-violet-100',
  },
  {
    title: 'مقارنة فترتين',
    description: 'صافي مبيعات ومصروفات وربح بين فترتين مع الفرق والنسبة',
    icon: '⚖️',
    href: '/reports/period-compare',
    color: 'bg-cyan-50 border-cyan-200 hover:bg-cyan-100',
  },
  {
    title: 'كشف حساب عميل',
    description: 'عرض حركات الفواتير والمدفوعات لعميل محدد',
    icon: '👤',
    href: '/reports/customer-statement',
    color: 'bg-teal-50 border-teal-200 hover:bg-teal-100',
  },
  {
    title: 'كشف حساب مورد',
    description: 'عرض حركات المشتريات والمدفوعات لمورد محدد',
    icon: '🏭',
    href: '/reports/supplier-statement',
    color: 'bg-orange-50 border-orange-200 hover:bg-orange-100',
  },
]

export default function ReportsPage() {
  const router = useRouter()
  const [summary, setSummary] = useState<{
    salesTotal: number
    returnsTotal: number
    netSales: number
    invoiceCount: number
    trend: number[]
  } | null>(null)

  useEffect(() => {
    api.get('/api/reports/today-summary').then((r) => {
      const d = r.data?.data
      if (!d) return
      setSummary({
        salesTotal: Number(d.salesTotalEGP ?? 0),
        returnsTotal: Number(d.returnsTotalEGP ?? 0),
        netSales: Number(d.netSalesEGP ?? 0),
        invoiceCount: Number(d.invoiceCount ?? d.salesCount ?? 0),
        trend: Array.isArray(d.last7Days) ? d.last7Days.map(Number) : [],
      })
    }).catch(() => {})
  }, [])

  const maxTrend = summary?.trend.length ? Math.max(...summary.trend, 1) : 1

  return (
    <div dir="rtl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">التقارير</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">
          اختر التقرير المطلوب لعرض البيانات والتحليلات
        </p>
      </div>

      {summary && (
        <div className="mb-8 space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
              <p className="text-xs text-blue-700">مبيعات اليوم (صافي)</p>
              <p className="text-2xl font-bold text-blue-900">{formatMoney(summary.netSales)}</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs text-emerald-700">إجمالي قبل المرتجع</p>
              <p className="text-2xl font-bold text-emerald-900">{formatMoney(summary.salesTotal)}</p>
            </div>
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
              <p className="text-xs text-rose-700">مرتجعات اليوم</p>
              <p className="text-2xl font-bold text-rose-900">{formatMoney(summary.returnsTotal)}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs text-gray-600">عدد الفواتير</p>
              <p className="text-2xl font-bold text-gray-900">{formatNumber(summary.invoiceCount)}</p>
            </div>
          </div>
          {summary.trend.length > 0 && (
            <div className="rounded-xl border bg-white dark:bg-gray-800 p-4">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">اتجاه المبيعات — آخر 7 أيام</p>
              <div className="flex items-end gap-2 h-24">
                {summary.trend.map((v, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full bg-blue-500 rounded-t" style={{ height: `${Math.max(8, (v / maxTrend) * 100)}%` }} title={formatMoney(v)} />
                    <span className="text-[10px] text-gray-400">{i + 1}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {REPORT_CARDS.map((card) => (
          <button
            key={card.href}
            onClick={() => router.push(card.href)}
            className={`text-right border rounded-xl p-6 transition-colors cursor-pointer ${card.color} dark:bg-gray-800 dark:border-gray-700 dark:hover:bg-gray-750 w-full`}
          >
            <div className="text-3xl mb-3">{card.icon}</div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">
              {card.title}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
              {card.description}
            </p>
          </button>
        ))}
      </div>
    </div>
  )
}
