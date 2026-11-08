'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { expensesService } from '@/services/expenses.service'
import { formatMoney } from '@/lib/currency'
import { formatDate } from '@/lib/dates'

interface ExpenseCategory {
  id: string
  name_ar: string
  name_en: string
}

interface Expense {
  id: string
  date: string
  amount: string | number
  currency: string
  exchangeRate: number
  description: string
  paidBy?: string
  category: ExpenseCategory
}

interface SummaryRow {
  categoryId: string
  categoryNameAr: string
  categoryNameEn: string
  totalEGP: number
  count: number
}

function getCurrentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

export default function ExpensesPage() {
  const router = useRouter()

  // Summary state
  const [summaryMonth, setSummaryMonth] = useState<string>(getCurrentMonth())
  const [summary, setSummary] = useState<SummaryRow[]>([])
  const [summaryLoading, setSummaryLoading] = useState(false)

  // List state
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [listLoading, setListLoading] = useState(true)

  // Filters
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [filterCategory, setFilterCategory] = useState('')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')

  const limit = 20

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true)
    try {
      const res = await expensesService.getSummary(summaryMonth)
      setSummary(res.data ?? [])
    } catch {
      setSummary([])
    } finally {
      setSummaryLoading(false)
    }
  }, [summaryMonth])

  const loadExpenses = useCallback(async () => {
    setListLoading(true)
    try {
      const params: Record<string, string | number> = { page, limit }
      if (filterCategory) params.categoryId = filterCategory
      if (filterFrom) params.from = filterFrom
      if (filterTo) params.to = filterTo
      const res = await expensesService.getAll(params)
      setExpenses(res.data?.data ?? [])
      setTotal(res.data?.total ?? 0)
    } catch {
      setExpenses([])
    } finally {
      setListLoading(false)
    }
  }, [page, filterCategory, filterFrom, filterTo])

  const loadCategories = useCallback(async () => {
    try {
      const res = await expensesService.getCategories()
      setCategories(res.data ?? [])
    } catch {
      setCategories([])
    }
  }, [])

  useEffect(() => { loadSummary() }, [loadSummary])
  useEffect(() => { loadExpenses() }, [loadExpenses])
  useEffect(() => { loadCategories() }, [loadCategories])

  async function handleDelete(id: string) {
    if (!confirm('هل أنت متأكد من حذف هذا المصروف؟')) return
    try {
      await expensesService.delete(id)
      loadExpenses()
      loadSummary()
    } catch {
      alert('فشل في حذف المصروف')
    }
  }

  const grandTotal = summary.reduce((sum, row) => sum + row.totalEGP, 0)
  const totalPages = Math.ceil(total / limit)

  return (
    <div dir="rtl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">المصاريف</h1>
        <button
          onClick={() => router.push('/expenses/new')}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
        >
          + إضافة مصروف
        </button>
      </div>

      {/* ── Monthly Summary ─────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5 mb-6">
        <div className="flex items-center gap-4 mb-4">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white">ملخص شهري</h2>
          <input
            type="month"
            value={summaryMonth}
            onChange={(e) => setSummaryMonth(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
          />
        </div>

        {summaryLoading ? (
          <div className="text-center text-gray-500 py-4">جار التحميل...</div>
        ) : summary.length === 0 ? (
          <div className="text-center text-gray-500 py-4">لا توجد مصاريف في هذا الشهر</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
              <tr>
                <th className="px-4 py-2 text-right font-medium">الفئة</th>
                <th className="px-4 py-2 text-right font-medium">إجمالي (ج.م)</th>
                <th className="px-4 py-2 text-right font-medium">العدد</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {summary.map((row) => (
                <tr key={row.categoryId} className="hover:bg-gray-50 dark:hover:bg-gray-750">
                  <td className="px-4 py-2 text-gray-900 dark:text-white">{row.categoryNameAr}</td>
                  <td className="px-4 py-2 font-medium text-gray-900 dark:text-white">
                    {formatMoney(row.totalEGP)}
                  </td>
                  <td className="px-4 py-2 text-gray-500">{row.count}</td>
                </tr>
              ))}
              <tr className="bg-gray-50 dark:bg-gray-700 font-bold">
                <td className="px-4 py-2 text-gray-900 dark:text-white">الإجمالي</td>
                <td className="px-4 py-2 text-gray-900 dark:text-white">
                  {formatMoney(grandTotal)}
                </td>
                <td className="px-4 py-2 text-gray-500">
                  {summary.reduce((s, r) => s + r.count, 0)}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">الفئة</label>
          <select
            value={filterCategory}
            onChange={(e) => { setFilterCategory(e.target.value); setPage(1) }}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
          >
            <option value="">جميع الفئات</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.name_ar}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">من تاريخ</label>
          <input
            type="date"
            value={filterFrom}
            onChange={(e) => { setFilterFrom(e.target.value); setPage(1) }}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">إلى تاريخ</label>
          <input
            type="date"
            value={filterTo}
            onChange={(e) => { setFilterTo(e.target.value); setPage(1) }}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
          />
        </div>
        {(filterCategory || filterFrom || filterTo) && (
          <button
            onClick={() => { setFilterCategory(''); setFilterFrom(''); setFilterTo(''); setPage(1) }}
            className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg"
          >
            مسح الفلاتر
          </button>
        )}
      </div>

      {/* ── Expenses List ────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
        {listLoading ? (
          <div className="p-8 text-center text-gray-500">جار التحميل...</div>
        ) : expenses.length === 0 ? (
          <div className="p-8 text-center text-gray-500">لا توجد مصاريف</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
              <tr>
                <th className="px-4 py-3 text-right font-medium">التاريخ</th>
                <th className="px-4 py-3 text-right font-medium">الفئة</th>
                <th className="px-4 py-3 text-right font-medium">الوصف</th>
                <th className="px-4 py-3 text-right font-medium">المبلغ</th>
                <th className="px-4 py-3 text-right font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {expenses.map((exp) => (
                  <tr key={exp.id} className="hover:bg-gray-50 dark:hover:bg-gray-750">
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{formatDate(exp.date)}</td>
                    <td className="px-4 py-3 text-gray-900 dark:text-white">{exp.category?.name_ar ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500 max-w-xs truncate">{exp.description || '—'}</td>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                      {formatMoney(exp.amount)}
                    </td>
                    <td className="px-4 py-3 flex gap-3">
                      <button
                        onClick={() => router.push(`/expenses/${exp.id}/edit`)}
                        className="text-blue-600 hover:text-blue-800 text-sm"
                      >
                        تعديل
                      </button>
                      <button
                        onClick={() => handleDelete(exp.id)}
                        className="text-red-600 hover:text-red-800 text-sm"
                      >
                        حذف
                      </button>
                    </td>
                  </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pagination ────────────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="mt-4 flex gap-2 justify-center">
          <button
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
            className="px-3 py-1 border rounded disabled:opacity-50"
          >
            السابق
          </button>
          <span className="px-3 py-1 text-sm text-gray-600">
            صفحة {page} من {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1 border rounded disabled:opacity-50"
          >
            التالي
          </button>
        </div>
      )}
    </div>
  )
}
