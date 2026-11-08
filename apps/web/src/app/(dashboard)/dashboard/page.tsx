'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { cashStatementService } from '@/services/cashStatement.service'
import { stockService } from '@/services/stock.service'
import api from '@/lib/api'
import { FinancialSummary } from '@/components/dashboard/FinancialSummary'
import { ProductMovementSummary } from '@/components/dashboard/ProductMovementSummary'
import { formatNumber } from '@/lib/currency'
import i18n from '@/lib/i18n'

interface DaySummary {
  cashSalesEGP: number
  cashSalesUSD: number
  creditSales: number
  receipts: number
  disbursements: number
  expenses: number
  closingBalanceEGP: number
  closingBalanceUSD: number
  isClosed: boolean
}

interface ShiftSummary {
  salesCount: number
  cashSales: number
  creditSales: number
  totalSales: number
  openingCash: number
  expectedCash: number
  openedAt: string
}

interface StatCardProps {
  label: string
  value: string
  sub?: string
  color: 'blue' | 'green' | 'amber' | 'red'
  href?: string
  loading?: boolean
}

function StatCard({ label, value, sub, color, href, loading }: StatCardProps) {
  const router = useRouter()
  const colors = {
    blue:  { bg: 'bg-blue-50 dark:bg-blue-900/20',   border: 'border-blue-200 dark:border-blue-700',   text: 'text-blue-700 dark:text-blue-300' },
    green: { bg: 'bg-green-50 dark:bg-green-900/20', border: 'border-green-200 dark:border-green-700', text: 'text-green-700 dark:text-green-300' },
    amber: { bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-200 dark:border-amber-700', text: 'text-amber-700 dark:text-amber-300' },
    red:   { bg: 'bg-red-50 dark:bg-red-900/20',     border: 'border-red-200 dark:border-red-700',     text: 'text-red-700 dark:text-red-300' },
  }
  const c = colors[color]

  return (
    <div
      onClick={href ? () => router.push(href) : undefined}
      className={`rounded-xl p-5 shadow-sm border ${c.bg} ${c.border} ${href ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
    >
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">{label}</p>
      {loading ? (
        <div className="h-8 w-24 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
      ) : (
        <>
          <p className={`text-2xl font-bold ${c.text}`}>{value}</p>
          {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
        </>
      )}
    </div>
  )
}

function fmt(n: number, _decimals = 0): string {
  return formatNumber(n)
}

const CASHIER_HOME_BUTTONS = [
  { href: '/sales/new', labelKey: 'home.newSale', icon: '🧾' },
  { href: '/shifts', labelKey: 'home.treasury', icon: '💰' },
  { href: '/customers', labelKey: 'home.customers', icon: '👥' },
  { href: '/items', labelKey: 'home.items', icon: '📦' },
] as const

function CashierHome({ userName }: { userName?: string }) {
  return (
    <div dir="rtl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">لوحة التحكم</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          مرحباً، {userName} — {new Date().toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-3xl">
        {CASHIER_HOME_BUTTONS.map((btn) => (
          <Link
            key={btn.href}
            href={btn.href}
            className="flex items-center gap-4 min-h-[88px] px-6 py-5 rounded-2xl border-2 border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-sm hover:border-sky-400 hover:shadow-md transition-all text-gray-900 dark:text-white"
          >
            <span className="text-4xl shrink-0" aria-hidden>{btn.icon}</span>
            <span className="text-xl font-bold">{i18n.t(btn.labelKey)}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const { user } = useAuth()
  const isCashier = user?.role === 'CASHIER'
  const isLauncherHome = user?.role === 'CASHIER' || user?.role === 'STAFF'
  const [summary, setSummary] = useState<DaySummary | null>(null)
  const [shiftSummary, setShiftSummary] = useState<ShiftSummary | null>(null)
  const [hasOpenShift, setHasOpenShift] = useState(false)
  const [lowStockCount, setLowStockCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(!isLauncherHome)

  useEffect(() => {
    if (isLauncherHome) return
    async function load() {
      setLoading(true)
      try {
        const [statRes, stockRes, shiftSumRes] = await Promise.all([
          cashStatementService.getToday().catch(() => null),
          stockService.getLowStock().catch(() => null),
          api.get('/api/ops/shifts/current/summary').catch(() => ({ data: { data: null } })),
        ])
        if (statRes?.data) setSummary(statRes.data)
        if (stockRes?.data) setLowStockCount(Array.isArray(stockRes.data) ? stockRes.data.length : 0)
        const ss = shiftSumRes.data?.data as ShiftSummary | null
        setShiftSummary(ss)
        setHasOpenShift(!!ss)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [isLauncherHome])

  if (isLauncherHome) {
    return <CashierHome userName={user?.name} />
  }

  const storeTodaySales = summary ? summary.cashSalesEGP + summary.creditSales : 0
  const storeCashBalance = summary ? summary.closingBalanceEGP : 0

  const displaySales = hasOpenShift && shiftSummary ? shiftSummary.totalSales : storeTodaySales
  const displayCash = hasOpenShift && shiftSummary ? shiftSummary.expectedCash : storeCashBalance
  const displayCashSub = hasOpenShift && shiftSummary
    ? `افتتاح: ${fmt(shiftSummary.openingCash)} + نقدي الوردية: ${fmt(shiftSummary.cashSales)} ج.م`
    : summary
      ? `نقدي: ${fmt(summary.cashSalesEGP)} | آجل: ${fmt(summary.creditSales)} ج.م · إجمالي المحل اليوم`
      : undefined
  const displaySalesSub = hasOpenShift && shiftSummary
    ? `${shiftSummary.salesCount} فاتورة في ورديتك${storeTodaySales !== shiftSummary.totalSales ? ` · المحل اليوم: ${fmt(storeTodaySales)} ج.م` : ''}`
    : !hasOpenShift
      ? 'فواتير المحل المؤكدة اليوم (كل المستخدمين)'
      : undefined

  return (
    <div dir="rtl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">لوحة التحكم</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          مرحباً، {user?.name} — {new Date().toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
        {hasOpenShift && shiftSummary && (
          <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-2">
            وردية مفتوحة منذ {new Date(shiftSummary.openedAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
            — الأرقام بالأسفل لورديتك الحالية ما لم يُذكر «المحل اليوم».
          </p>
        )}
        {!hasOpenShift && !loading && storeTodaySales > 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">
            ملخص «اليوم» يجمع كل فواتير المحل المؤكدة اليوم (حتى لو بدون فتح وردية). لرقابة الكاشير افتح وردية من صفحة وردية الكاشير.
          </p>
        )}
      </div>

      {!isCashier && <FinancialSummary />}
      {!isCashier && <ProductMovementSummary />}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label={hasOpenShift ? 'مبيعات ورديتك (نقدي + آجل)' : 'مبيعات اليوم (نقدي + آجل)'}
          value={loading ? '...' : `${fmt(displaySales)} ج.م`}
          sub={loading ? undefined : displaySalesSub}
          color="blue"
          href="/sales"
          loading={loading}
        />
        <StatCard
          label={hasOpenShift ? 'نقدية متوقعة (الوردية)' : 'رصيد الصندوق (تقدير اليوم)'}
          value={loading ? '...' : `${fmt(displayCash)} ج.م`}
          sub={loading ? undefined : displayCashSub}
          color="green"
          href={hasOpenShift ? '/shifts' : '/cash-statement'}
          loading={loading}
        />
        <StatCard
          label="المقبوضات اليوم"
          value={loading ? '...' : `${fmt(summary?.receipts ?? 0)} ج.م`}
          sub={summary ? `مدفوعات: ${fmt(summary.disbursements)} ج.م` : undefined}
          color="amber"
          href="/vouchers"
          loading={loading}
        />
        <StatCard
          label="تنبيهات المخزون"
          value={loading ? '...' : lowStockCount !== null ? String(lowStockCount) : '—'}
          sub={lowStockCount ? 'صنف تحت الحد الأدنى' : 'المخزون في وضع جيد'}
          color={lowStockCount && lowStockCount > 0 ? 'red' : 'green'}
          href="/inventory"
          loading={loading}
        />
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 border border-gray-100 dark:border-gray-700">
        <h2 className="text-base font-semibold text-gray-800 dark:text-white mb-4">روابط سريعة</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {([
            { href: '/quotes/new',       label: 'عرض سعر للعميل',     icon: '📝', roles: null },
            { href: '/sales/new',      label: 'فاتورة مبيعات جديدة',  icon: '🧾', roles: null },
            { href: '/purchases/new',  label: 'فاتورة مشتريات جديدة', icon: '🛒', roles: ['ADMIN', 'MANAGER', 'ACCOUNTANT'] },
            { href: '/vouchers/new',   label: 'سند قبض / صرف',       icon: '📋', roles: ['ADMIN', 'MANAGER', 'ACCOUNTANT'] },
            { href: '/expenses/new',   label: 'تسجيل مصروف',         icon: '💸', roles: ['ADMIN', 'MANAGER', 'ACCOUNTANT'] },
            { href: '/items/new',      label: 'إضافة منتج',           icon: '📦', roles: ['ADMIN', 'MANAGER', 'STAFF'] },
            { href: '/customers/new',  label: 'عميل جديد',           icon: '👥', roles: null },
            { href: '/reports',        label: 'التقارير',             icon: '📈', roles: ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'VIEWER'] },
            { href: '/cash-statement', label: 'كشف الصندوق',         icon: '💰', roles: ['ADMIN', 'MANAGER', 'ACCOUNTANT'] },
            { href: '/sales',          label: 'إرجاع مبيعات',        icon: '↩', roles: null },
          ] as { href: string; label: string; icon: string; roles: string[] | null }[])
            .filter(link => !link.roles || link.roles.includes(user?.role ?? ''))
            .map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm text-gray-700 dark:text-gray-300 transition-colors"
            >
              <span>{link.icon}</span>
              <span className="truncate">{link.label}</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
