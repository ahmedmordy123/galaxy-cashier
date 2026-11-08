'use client'

import { useEffect, useState } from 'react'
import api from '@/lib/api'
import { formatMoney } from '@/lib/currency'

export default function ShiftsPage() {
  const [current, setCurrent] = useState<{ id: string; openingCash: number; openedAt: string } | null>(null)
  const [shiftStats, setShiftStats] = useState<{
    expectedCash: number
    cashSales: number
    salesCount: number
    staffAdvances: number
    expenses: number
  } | null>(null)
  const [list, setList] = useState<Array<{ id: string; status: string; openingCash: number; closingCash: number | null; expectedCash: number | null; openedAt: string; closedAt: string | null; user: { name: string } }>>([])
  const [opening, setOpening] = useState(0)
  const [closing, setClosing] = useState(0)
  const [msg, setMsg] = useState('')

  async function load() {
    const [c, l] = await Promise.all([
      api.get('/api/ops/shifts/current'),
      api.get('/api/ops/shifts').catch(() => ({ data: { data: [] } })),
    ])
    const cur = c.data.data
    setCurrent(cur)
    setList(l.data.data || [])
    if (cur?.id) {
      const s = await api.get('/api/ops/shifts/current/summary').catch(() => null)
      if (s?.data?.data) {
        const br = s.data.data.cashBreakdown || {}
        setShiftStats({
          expectedCash: Number(s.data.data.expectedCash),
          cashSales: Number(s.data.data.cashSales),
          salesCount: Number(s.data.data.salesCount),
          staffAdvances: Number(s.data.data.staffAdvances ?? br.staffAdvances ?? 0),
          expenses: Number(br.expenses ?? 0),
        })
        setClosing(Number(s.data.data.expectedCash))
      }
    } else {
      setShiftStats(null)
    }
  }

  useEffect(() => { load().catch(() => {}) }, [])

  const expected = shiftStats?.expectedCash ?? (current ? Number(current.openingCash) : 0)
  const diff = closing - expected

  async function openShift() {
    try {
      await api.post('/api/ops/shifts/open', { openingCash: opening })
      setMsg('تم فتح الوردية')
      await load()
    } catch (e: unknown) {
      setMsg((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'فشل')
    }
  }

  async function closeShift() {
    try {
      const res = await api.post('/api/ops/shifts/close', { closingCash: closing })
      const d = Number(res.data?.data?.cashDifference ?? closing - Number(res.data?.data?.expectedCash))
      setMsg(`تم الإغلاق — الفرق: ${formatMoney(d)}`)
      await load()
    } catch (e: unknown) {
      setMsg((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'فشل')
    }
  }

  return (
    <div dir="rtl" className="space-y-4 max-w-2xl">
      <h1 className="text-2xl font-bold">وردية الكاشير</h1>
      {msg && <div className="p-3 bg-blue-50 rounded text-sm">{msg}</div>}

      {current ? (
        <div className="bg-white border rounded-xl p-5 space-y-4">
          <p className="font-medium text-green-700">وردية مفتوحة</p>
          <p className="text-sm text-gray-600">افتتاح: {formatMoney(Number(current.openingCash))} — {new Date(current.openedAt).toLocaleString('ar-EG')}</p>
          {shiftStats && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg bg-gray-50 p-3"><span className="text-gray-500">فواتير</span><p className="text-xl font-bold">{shiftStats.salesCount}</p></div>
              <div className="rounded-lg bg-gray-50 p-3"><span className="text-gray-500">نقد متوقع</span><p className="text-xl font-bold">{formatMoney(expected)}</p></div>
              <div className="rounded-lg bg-gray-50 p-3"><span className="text-gray-500">سلف موظفين</span><p className="text-xl font-bold">{formatMoney(shiftStats.staffAdvances)}</p></div>
              <div className="rounded-lg bg-gray-50 p-3"><span className="text-gray-500">مصروفات</span><p className="text-xl font-bold">{formatMoney(shiftStats.expenses)}</p></div>
            </div>
          )}
          <div>
            <label className="text-sm font-medium text-gray-700">العدّ الفعلي في الدرج</label>
            <input type="number" value={closing} onChange={(e) => setClosing(Number(e.target.value))}
              className="mt-1 w-full border rounded-lg px-3 py-2 text-lg" />
          </div>
          <div className={`rounded-lg p-4 text-center ${diff === 0 ? 'bg-emerald-50 text-emerald-800' : diff > 0 ? 'bg-blue-50 text-blue-800' : 'bg-red-50 text-red-800'}`}>
            <p className="text-sm">الفرق (فعلي − متوقع)</p>
            <p className="text-3xl font-bold">{formatMoney(diff)}</p>
          </div>
          <button onClick={closeShift} className="w-full py-3 bg-red-600 text-white rounded-xl font-semibold">إغلاق الوردية</button>
        </div>
      ) : (
        <div className="bg-white border rounded-xl p-5 space-y-3">
          <p className="text-gray-600">افتح وردية بخطوة واحدة</p>
          <input type="number" value={opening} onChange={(e) => setOpening(Number(e.target.value))}
            className="w-full border rounded-lg px-3 py-2" placeholder="نقدية الافتتاح" />
          <button onClick={openShift} className="w-full py-3 bg-emerald-600 text-white rounded-xl font-semibold">فتح وردية</button>
        </div>
      )}

      <div className="bg-white border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50"><tr>
            <th className="p-2 text-right">المستخدم</th>
            <th className="p-2 text-right">الحالة</th>
            <th className="p-2 text-right">افتتاح</th>
            <th className="p-2 text-right">إغلاق</th>
            <th className="p-2 text-right">متوقع</th>
          </tr></thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id} className="border-t">
                <td className="p-2">{s.user.name}</td>
                <td className="p-2">{s.status === 'OPEN' ? 'مفتوحة' : 'مغلقة'}</td>
                <td className="p-2">{Number(s.openingCash)}</td>
                <td className="p-2">{s.closingCash != null ? Number(s.closingCash) : '—'}</td>
                <td className="p-2">{s.expectedCash != null ? Number(s.expectedCash) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
