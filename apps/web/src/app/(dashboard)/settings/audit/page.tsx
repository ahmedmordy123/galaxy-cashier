'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { formatDateTime } from '@/lib/dates'

interface AuditRow {
  id: string
  action: string
  entityType: string
  entityId: string | null
  detailsJson: string | null
  createdAt: string
  user: { name: string; username: string }
}

const ACTION_LABELS: Record<string, string> = {
  CONFIRM_INVOICE: 'تأكيد فاتورة',
  CANCEL_INVOICE: 'إلغاء فاتورة',
  RETURN_FULL: 'مرتجع كامل',
  RETURN_PARTIAL: 'مرتجع جزئي',
  DELETE_ITEM: 'حذف صنف',
  DELETE_CUSTOMER: 'حذف عميل',
  DELETE_SUPPLIER: 'حذف مورد',
  BACKUP_RESTORE: 'استعادة نسخة',
  RECONCILE_BALANCE: 'تسوية رصيد',
  SHIFT_REBIND: 'إعادة ربط وردية',
  UPDATE_INVOICE: 'تعديل فاتورة',
}

export default function AuditLogPage() {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get('/api/audit', { params: { page, limit: 40 } })
      const data = res.data?.data
      setRows(data?.data ?? [])
      setTotal(data?.total ?? 0)
    } catch {
      setError('فشل تحميل سجل العمليات — تحتاج صلاحية مدير')
    } finally {
      setLoading(false)
    }
  }, [page])

  useEffect(() => {
    load()
  }, [load])

  const pages = Math.max(1, Math.ceil(total / 40))

  return (
    <div dir="rtl" className="max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/settings" className="text-sm text-gray-500 hover:text-gray-700">
          ← الإعدادات
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">سجل العمليات (Audit)</h1>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">{error}</div>
      )}

      {loading ? (
        <p className="text-gray-500 text-sm">جار التحميل...</p>
      ) : rows.length === 0 ? (
        <p className="text-gray-500 text-sm">لا سجلات بعد.</p>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
              <tr>
                <th className="px-3 py-2 text-right">الوقت</th>
                <th className="px-3 py-2 text-right">المستخدم</th>
                <th className="px-3 py-2 text-right">العملية</th>
                <th className="px-3 py-2 text-right">الكيان</th>
                <th className="px-3 py-2 text-right">تفاصيل</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50/80 dark:hover:bg-gray-700/30">
                  <td className="px-3 py-2 whitespace-nowrap text-xs">{formatDateTime(r.createdAt)}</td>
                  <td className="px-3 py-2">
                    <div>{r.user.name}</div>
                    <div className="text-xs text-gray-400 font-mono">{r.user.username}</div>
                  </td>
                  <td className="px-3 py-2">{ACTION_LABELS[r.action] ?? r.action}</td>
                  <td className="px-3 py-2 text-xs font-mono">
                    {r.entityType}
                    {r.entityId ? ` · ${r.entityId.slice(0, 8)}…` : ''}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500 max-w-xs truncate" title={r.detailsJson ?? ''}>
                    {r.detailsJson ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-4 text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3 py-1 border rounded disabled:opacity-40"
          >
            السابق
          </button>
          <span>
            {page} / {pages}
          </span>
          <button
            type="button"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1 border rounded disabled:opacity-40"
          >
            التالي
          </button>
        </div>
      )}
    </div>
  )
}
