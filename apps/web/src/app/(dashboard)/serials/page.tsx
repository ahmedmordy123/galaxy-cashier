'use client'

import { useEffect, useState } from 'react'
import api from '@/lib/api'

export default function SerialsPage() {
  const [items, setItems] = useState<Array<{ id: string; name_ar: string; trackSerial: boolean }>>([])
  const [serials, setSerials] = useState<Array<{ id: string; serial: string; status: string; item: { name_ar: string } }>>([])
  const [itemId, setItemId] = useState('')
  const [serial, setSerial] = useState('')
  const [warrantyMonths, setWarrantyMonths] = useState(12)
  const [msg, setMsg] = useState('')

  async function load() {
    const [i, s] = await Promise.all([
      api.get('/api/items', { params: { limit: 300 } }),
      api.get('/api/ops/serials'),
    ])
    const list = i.data?.data?.items || i.data?.data || []
    setItems(Array.isArray(list) ? list.filter((x: { trackSerial?: boolean }) => x.trackSerial) : [])
    setSerials(s.data.data || [])
  }

  useEffect(() => { load().catch(() => {}) }, [])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    try {
      await api.post('/api/ops/serials', { itemId, serial, warrantyMonths })
      setSerial('')
      setMsg('تمت إضافة السيريال')
      await load()
    } catch (err: unknown) {
      setMsg((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'فشل')
    }
  }

  return (
    <div dir="rtl" className="space-y-4 max-w-3xl">
      <h1 className="text-2xl font-bold">سيريالات الأجهزة</h1>
      <p className="text-sm text-gray-500">فعّل «تتبع سيريال» على الصنف ثم أضف الأرقام هنا قبل البيع</p>
      {msg && <div className="p-2 bg-blue-50 rounded text-sm">{msg}</div>}

      <form onSubmit={add} className="bg-white border rounded-xl p-4 grid sm:grid-cols-2 gap-2">
        <select value={itemId} onChange={(e) => setItemId(e.target.value)} required className="border rounded px-2 py-2">
          <option value="">صنف بتتبع سيريال</option>
          {items.map((i) => <option key={i.id} value={i.id}>{i.name_ar}</option>)}
        </select>
        <input value={serial} onChange={(e) => setSerial(e.target.value)} required placeholder="رقم السيريال / IMEI" className="border rounded px-2 py-2" />
        <input type="number" min={0} value={warrantyMonths} onChange={(e) => setWarrantyMonths(Number(e.target.value))}
          className="border rounded px-2 py-2" placeholder="ضمان بالشهور" />
        <button className="bg-blue-600 text-white rounded px-3 py-2">إضافة</button>
      </form>

      <table className="w-full text-sm bg-white border rounded-xl overflow-hidden">
        <thead className="bg-gray-50"><tr>
          <th className="p-2 text-right">الصنف</th>
          <th className="p-2 text-right">سيريال</th>
          <th className="p-2 text-right">الحالة</th>
        </tr></thead>
        <tbody>
          {serials.map((s) => (
            <tr key={s.id} className="border-t">
              <td className="p-2">{s.item.name_ar}</td>
              <td className="p-2 font-mono">{s.serial}</td>
              <td className="p-2">{s.status === 'IN_STOCK' ? 'بالمخزن' : s.status === 'SOLD' ? 'مباع' : s.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
