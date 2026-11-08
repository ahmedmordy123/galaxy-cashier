'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { cashStatementService } from '@/services/cashStatement.service'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface StatementData {
  id?: string
  isClosed: boolean
  date: string
  openingBalanceEGP: number
  openingBalanceUSD: number
  cashSalesEGP: number
  cashSalesUSD: number
  creditSales: number
  receipts: number
  disbursements: number
  expenses: number
  closingBalanceEGP: number
  closingBalanceUSD: number
  notes?: string | null
}

interface HistoryRow {
  id: string
  date: string
  openingBalanceEGP: string | number
  openingBalanceUSD: string | number
  closingBalanceEGP: string | number
  closingBalanceUSD: string | number
  isClosed: boolean
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatEGP(val: number | string): string {
  return Number(val).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDateAr(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ar-EG')
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

// ─── Stat Card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string
  amount?: number
  highlight?: boolean
}

function StatCard({ label, amount, highlight }: StatCardProps) {
  return (
    <div
      className={`rounded-xl p-4 shadow-sm border ${
        highlight
          ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700'
          : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700'
      }`}
    >
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{label}</p>
      {amount !== undefined && (
        <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
          {formatEGP(amount)} <span className="text-xs font-normal">ج.م</span>
        </p>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CashStatementPage() {
  // Today section
  const [today, setToday] = useState<StatementData | null>(null)
  const [todayLoading, setTodayLoading] = useState(true)
  const [closeNotes, setCloseNotes] = useState('')
  const [closing, setClosing] = useState(false)
  const [closeError, setCloseError] = useState('')

  // History section
  const [historyFrom, setHistoryFrom] = useState(() => {
    const d = new Date()
    d.setDate(1)
    return d.toISOString().slice(0, 10)
  })
  const [historyTo, setHistoryTo] = useState(todayStr)
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  // Expanded row for inline detail
  const [expandedDate, setExpandedDate] = useState<string | null>(null)
  const [expandedData, setExpandedData] = useState<StatementData | null>(null)
  const [expandedLoading, setExpandedLoading] = useState(false)

  // ── Load today ────────────────────────────────────────────────────────────────

  const loadToday = useCallback(async () => {
    setTodayLoading(true)
    try {
      const res = await cashStatementService.getToday()
      setToday(res.data ?? null)
    } catch {
      setToday(null)
    } finally {
      setTodayLoading(false)
    }
  }, [])

  useEffect(() => {
    loadToday()
  }, [loadToday])

  // ── Close today ───────────────────────────────────────────────────────────────

  async function handleClose() {
    if (!confirm('هل أنت متأكد من إغلاق كشف اليوم؟ لا يمكن التراجع عن هذا الإجراء.')) return
    setClosing(true)
    setCloseError('')
    try {
      await cashStatementService.close(closeNotes || undefined)
      setCloseNotes('')
      await loadToday()
      await loadHistory()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'فشل في إغلاق الكشف'
      setCloseError(msg)
    } finally {
      setClosing(false)
    }
  }

  // ── Load history ──────────────────────────────────────────────────────────────

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const res = await cashStatementService.getRange(historyFrom, historyTo)
      setHistory(res.data ?? [])
    } catch {
      setHistory([])
    } finally {
      setHistoryLoading(false)
    }
  }, [historyFrom, historyTo])

  // ── Expand row ────────────────────────────────────────────────────────────────

  async function handleRowClick(dateStr: string) {
    const normalized = dateStr.slice(0, 10)
    if (expandedDate === normalized) {
      setExpandedDate(null)
      setExpandedData(null)
      return
    }
    setExpandedDate(normalized)
    setExpandedData(null)
    setExpandedLoading(true)
    try {
      const res = await cashStatementService.getByDate(normalized)
      setExpandedData(res.data ?? null)
    } catch {
      setExpandedData(null)
    } finally {
      setExpandedLoading(false)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div dir="rtl">
      {/* ── Page Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">كشف الصندوق اليومي</h1>
        <span className="text-sm text-gray-500 dark:text-gray-400">{formatDateAr(todayStr())}</span>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* ── Today's Statement ──────────────────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════════════════════════ */}

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-6 mb-8 border border-gray-100 dark:border-gray-700">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white">كشف اليوم</h2>
          {today && (
            <span
              className={`px-3 py-1 rounded-full text-xs font-semibold ${
                today.isClosed
                  ? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                  : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              }`}
            >
              {today.isClosed ? 'مغلق' : 'مفتوح'}
            </span>
          )}
        </div>

        {todayLoading ? (
          <div className="py-10 text-center text-gray-400">جار التحميل...</div>
        ) : today ? (
          <>
            {/* Stat cards grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
              <StatCard label="رصيد الافتتاح" amount={today.openingBalanceEGP} />
              <StatCard label="المبيعات النقدية" amount={today.cashSalesEGP} />
              <StatCard label="المبيعات الآجلة" amount={today.creditSales} />
              <StatCard label="المقبوضات" amount={today.receipts} />
              <StatCard label="المصروفات" amount={today.expenses} />
              <StatCard label="المدفوعات" amount={today.disbursements} />
              <StatCard label="رصيد الإغلاق" amount={today.closingBalanceEGP} highlight />
            </div>

            {/* Notes & close */}
            {!today.isClosed && (
              <div className="border-t border-gray-100 dark:border-gray-700 pt-5 mt-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  ملاحظات الإغلاق
                </label>
                <textarea
                  value={closeNotes}
                  onChange={(e) => setCloseNotes(e.target.value)}
                  rows={2}
                  placeholder="أدخل ملاحظات اختيارية..."
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {closeError && (
                  <p className="mt-1 text-sm text-red-600">{closeError}</p>
                )}
                <button
                  onClick={handleClose}
                  disabled={closing}
                  className="mt-3 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
                >
                  {closing ? 'جار الإغلاق...' : 'إغلاق اليوم'}
                </button>
              </div>
            )}

            {today.isClosed && today.notes && (
              <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-750 rounded-lg border border-gray-200 dark:border-gray-600">
                <p className="text-xs text-gray-500 mb-1">ملاحظات:</p>
                <p className="text-sm text-gray-700 dark:text-gray-300">{today.notes}</p>
              </div>
            )}
          </>
        ) : (
          <div className="py-10 text-center text-gray-400">تعذّر تحميل بيانات اليوم</div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* ── History Section ────────────────────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════════════════════════ */}

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-6 border border-gray-100 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-5">سجل الكشوفات</h2>

        {/* Date range filter */}
        <div className="flex flex-wrap gap-3 items-end mb-5">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">من تاريخ</label>
            <input
              type="date"
              value={historyFrom}
              onChange={(e) => setHistoryFrom(e.target.value)}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">إلى تاريخ</label>
            <input
              type="date"
              value={historyTo}
              onChange={(e) => setHistoryTo(e.target.value)}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
            />
          </div>
          <button
            onClick={loadHistory}
            disabled={historyLoading}
            className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
          >
            {historyLoading ? 'جار البحث...' : 'بحث'}
          </button>
        </div>

        {/* History table */}
        {historyLoading ? (
          <div className="py-8 text-center text-gray-400">جار التحميل...</div>
        ) : history.length === 0 ? (
          <div className="py-8 text-center text-gray-400">لا توجد كشوفات في هذه الفترة</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                <tr>
                  <th className="px-4 py-3 text-right font-medium">التاريخ</th>
                  <th className="px-4 py-3 text-right font-medium">افتتاح (ج.م)</th>
                  <th className="px-4 py-3 text-right font-medium">إغلاق (ج.م)</th>
                  <th className="px-4 py-3 text-right font-medium">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {history.map((row) => {
                  const rowDateStr = row.date.slice(0, 10)
                  const isExpanded = expandedDate === rowDateStr
                  return (
                    <React.Fragment key={row.id}>
                      <tr
                        onClick={() => handleRowClick(row.date)}
                        className="hover:bg-gray-50 dark:hover:bg-gray-750 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3 text-gray-700 dark:text-gray-300 font-medium">
                          {formatDateAr(row.date)}
                        </td>
                        <td className="px-4 py-3 text-gray-900 dark:text-white">
                          {formatEGP(row.openingBalanceEGP)} ج.م
                        </td>
                        <td className="px-4 py-3 font-semibold text-blue-700 dark:text-blue-400">
                          {formatEGP(row.closingBalanceEGP)} ج.م
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              row.isClosed
                                ? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                                : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            }`}
                          >
                            {row.isClosed ? 'مغلق' : 'مفتوح'}
                          </span>
                        </td>
                      </tr>

                      {/* Expanded detail row */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={4} className="bg-blue-50 dark:bg-blue-900/10 px-6 py-4">
                            {expandedLoading ? (
                              <p className="text-sm text-gray-500">جار التحميل...</p>
                            ) : expandedData ? (
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                <div>
                                  <p className="text-xs text-gray-500 mb-0.5">رصيد الافتتاح</p>
                                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                                    {formatEGP(expandedData.openingBalanceEGP)} ج.م
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-500 mb-0.5">المبيعات النقدية</p>
                                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                                    {formatEGP(expandedData.cashSalesEGP)} ج.م
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-500 mb-0.5">المبيعات الآجلة</p>
                                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                                    {formatEGP(expandedData.creditSales)} ج.م
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-500 mb-0.5">المقبوضات</p>
                                  <p className="text-sm font-medium text-green-700 dark:text-green-400">
                                    {formatEGP(expandedData.receipts)} ج.م
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-500 mb-0.5">المصروفات</p>
                                  <p className="text-sm font-medium text-red-600 dark:text-red-400">
                                    {formatEGP(expandedData.expenses)} ج.م
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-500 mb-0.5">المدفوعات</p>
                                  <p className="text-sm font-medium text-red-600 dark:text-red-400">
                                    {formatEGP(expandedData.disbursements)} ج.م
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-500 mb-0.5">رصيد الإغلاق</p>
                                  <p className="text-sm font-bold text-blue-700 dark:text-blue-400">
                                    {formatEGP(expandedData.closingBalanceEGP)} ج.م
                                  </p>
                                </div>
                                {expandedData.notes && (
                                  <div className="col-span-2 sm:col-span-4">
                                    <p className="text-xs text-gray-500 mb-0.5">ملاحظات</p>
                                    <p className="text-sm text-gray-700 dark:text-gray-300">
                                      {expandedData.notes}
                                    </p>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <p className="text-sm text-gray-500">تعذّر تحميل التفاصيل</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
