'use client'

import { useCallback, useEffect, useState } from 'react'
import i18n from '@/lib/i18n'
import { formatMoney } from '@/lib/currency'
import { formatDate, localDateISO } from '@/lib/dates'
import { staffAdvancesService } from '@/services/staff-advances.service'

interface Employee {
  id: string
  name: string
  username: string
  role: string
}

interface DayAgg {
  date: string
  total: number
  count: number
}

interface EmpSummary {
  employeeId: string
  name: string
  username: string
  role: string
  total: number
  count: number
  days: DayAgg[]
}

interface LedgerEntry {
  id: string
  amount: number
  notes: string | null
  createdAt: string
  createdBy: { id: string; name: string }
  shift: { id: string; openedAt: string; status: string }
}

interface LedgerDay {
  date: string
  total: number
  count: number
  entries: LedgerEntry[]
}

function currentMonthValue(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function StaffAdvancesPage() {
  const t = (key: string) => i18n.t(key)
  const [month, setMonth] = useState(currentMonthValue())
  const [employees, setEmployees] = useState<Employee[]>([])
  const [summary, setSummary] = useState<{ employees: EmpSummary[]; grandTotal: number } | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [ledger, setLedger] = useState<{ total: number; days: LedgerDay[]; employee: Employee } | null>(null)
  const [form, setForm] = useState({ employeeId: '', amount: '', date: localDateISO(), notes: '' })
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const year = Number(month.slice(0, 4))
  const mon = Number(month.slice(5, 7))

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [empRes, sumRes] = await Promise.all([
        staffAdvancesService.listEmployees(),
        staffAdvancesService.summary(year, mon),
      ])
      setEmployees(empRes.data ?? [])
      setSummary(sumRes.data ?? null)
    } catch {
      setError(t('errors.serverError'))
    } finally {
      setLoading(false)
    }
  }, [year, mon])

  useEffect(() => { load().catch(() => {}) }, [load])

  useEffect(() => {
    if (!selectedId) { setLedger(null); return }
    staffAdvancesService.ledger(selectedId, year, mon)
      .then((res) => setLedger(res.data))
      .catch(() => setLedger(null))
  }, [selectedId, year, mon])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setMsg('')
    if (!form.employeeId) { setError(t('errors.required')); return }
    if (!form.amount || Number(form.amount) <= 0) { setError(t('errors.positiveNumber')); return }
    setSaving(true)
    try {
      await staffAdvancesService.create({
        employeeId: form.employeeId,
        amount: Number(form.amount),
        date: form.date,
        notes: form.notes || undefined,
      })
      setForm((f) => ({ ...f, amount: '', notes: '' }))
      setMsg(t('common.save'))
      await load()
      if (form.employeeId === selectedId) {
        const res = await staffAdvancesService.ledger(form.employeeId, year, mon)
        setLedger(res.data)
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } }
      setError(axiosErr.response?.data?.error || t('errors.serverError'))
    } finally {
      setSaving(false)
    }
  }

  async function cancelAdvance(id: string) {
    try {
      await staffAdvancesService.remove(id)
      await load()
      if (selectedId) {
        const res = await staffAdvancesService.ledger(selectedId, year, mon)
        setLedger(res.data)
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } }
      setError(axiosErr.response?.data?.error || t('errors.serverError'))
    }
  }

  return (
    <div dir="rtl" className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">{t('staffAdvances.title')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('staffAdvances.salaryHint')}</p>
      </div>

      {(msg || error) && (
        <div className={`p-3 rounded text-sm ${error ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}>
          {error || msg}
        </div>
      )}

      <form onSubmit={submit} className="bg-white border rounded-xl p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium">{t('staffAdvances.employee')}</label>
          <select
            value={form.employeeId}
            onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))}
            className="mt-1 w-full border rounded-lg px-3 py-2"
          >
            <option value="">—</option>
            {employees.map((u) => (
              <option key={u.id} value={u.id}>{u.name} ({u.username})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium">{t('staffAdvances.amount')}</label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            className="mt-1 w-full border rounded-lg px-3 py-2"
          />
        </div>
        <div>
          <label className="text-sm font-medium">{t('staffAdvances.date')}</label>
          <input
            type="date"
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            className="mt-1 w-full border rounded-lg px-3 py-2"
          />
        </div>
        <div>
          <label className="text-sm font-medium">{t('staffAdvances.notes')}</label>
          <input
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            className="mt-1 w-full border rounded-lg px-3 py-2"
          />
        </div>
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={saving}
            className="w-full py-3 bg-emerald-600 text-white rounded-xl font-semibold disabled:opacity-60"
          >
            {saving ? t('common.loading') : t('staffAdvances.add')}
          </button>
        </div>
      </form>

      <div className="flex items-center justify-between gap-3">
        <label className="text-sm font-medium">
          {t('staffAdvances.month')}
          <input
            type="month"
            value={month}
            onChange={(e) => { setMonth(e.target.value); setSelectedId(null) }}
            className="mr-2 border rounded-lg px-3 py-1"
          />
        </label>
        <p className="text-sm font-semibold">
          {t('staffAdvances.total')}: {formatMoney(summary?.grandTotal ?? 0)}
        </p>
      </div>

      <div className="bg-white border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-2 text-right">{t('staffAdvances.employee')}</th>
              <th className="p-2 text-right">{t('staffAdvances.total')}</th>
              <th className="p-2 text-right">{t('staffAdvances.count')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="p-4 text-gray-400" colSpan={3}>{t('common.loading')}</td></tr>
            ) : !summary?.employees.length ? (
              <tr><td className="p-4 text-gray-400" colSpan={3}>{t('staffAdvances.empty')}</td></tr>
            ) : summary.employees.map((row) => (
              <tr
                key={row.employeeId}
                className={`border-t cursor-pointer ${selectedId === row.employeeId ? 'bg-blue-50' : ''}`}
                onClick={() => setSelectedId(row.employeeId)}
              >
                <td className="p-2">{row.name} <span className="text-gray-400">({row.username})</span></td>
                <td className="p-2 font-semibold">{formatMoney(row.total)}</td>
                <td className="p-2">{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ledger && (
        <div className="bg-white border rounded-xl p-4 space-y-3">
          <h2 className="font-bold">{ledger.employee.name} — {formatMoney(ledger.total)}</h2>
          {ledger.days.map((day) => (
            <div key={day.date} className="border rounded-lg p-3">
              <div className="flex justify-between text-sm font-medium mb-2">
                <span>{formatDate(day.date)}</span>
                <span>{formatMoney(day.total)} ({day.count})</span>
              </div>
              <ul className="space-y-1 text-sm">
                {day.entries.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between gap-2">
                    <span>
                      {formatMoney(entry.amount)}
                      {entry.notes ? ` — ${entry.notes}` : ''}
                      <span className="text-gray-400 mr-2"> · {entry.createdBy.name}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => cancelAdvance(entry.id)}
                      className="text-red-600 text-xs"
                    >
                      {t('staffAdvances.cancel')}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
