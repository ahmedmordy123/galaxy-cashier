'use client'

import { useCallback, useEffect, useState } from 'react'
import api from '@/lib/api'
import { formatMoney } from '@/lib/currency'

export default function WarehousesPage() {
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string; code: string; isDefault: boolean }>>([])
  const [items, setItems] = useState<Array<{ id: string; name_ar: string }>>([])
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [fromWh, setFromWh] = useState('')
  const [toWh, setToWh] = useState('')
  const [itemId, setItemId] = useState('')
  const [qty, setQty] = useState(1)
  const [msg, setMsg] = useState('')
  const [countWh, setCountWh] = useState('')
  const [countItem, setCountItem] = useState('')
  const [countQty, setCountQty] = useState(0)
  const [counts, setCounts] = useState<Array<{ id: string; status: string; warehouse: { name: string }; _count: { lines: number } }>>([])

  const load = useCallback(async () => {
    const [w, i, c] = await Promise.all([
      api.get('/api/ops/warehouses'),
      api.get('/api/items', { params: { limit: 200 } }),
      api.get('/api/ops/stock-counts'),
    ])
    setWarehouses(w.data.data || [])
    const list = i.data?.data?.items || i.data?.data || []
    setItems(Array.isArray(list) ? list : [])
    setCounts(c.data.data || [])
    setFromWh((prev) => prev || w.data.data?.[0]?.id || '')
    setToWh((prev) => prev || w.data.data?.[1]?.id || '')
    setCountWh((prev) => prev || w.data.data?.[0]?.id || '')
  }, [])

  useEffect(() => {
    void load().catch(() => {})
  }, [load])

  async function addWarehouse(e: React.FormEvent) {
    e.preventDefault()
    await api.post('/api/ops/warehouses', { name, code })
    setName(''); setCode(''); setMsg('تم إضافة المخزن'); await load()
  }

  async function doTransfer(e: React.FormEvent) {
    e.preventDefault()
    try {
      await api.post('/api/ops/warehouses/transfer', {
        itemId, fromWarehouseId: fromWh, toWarehouseId: toWh, quantity: Number(qty),
      })
      setMsg('تم التحويل بنجاح')
    } catch (err: unknown) {
      setMsg((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'فشل التحويل')
    }
  }

  async function createCount(e: React.FormEvent) {
    e.preventDefault()
    const res = await api.post('/api/ops/stock-counts', {
      warehouseId: countWh,
      lines: [{ itemId: countItem, countedQty: Number(countQty) }],
    })
    const id = res.data.data.id
    await api.post(`/api/ops/stock-counts/${id}/confirm`)
    setMsg('تم الجرد والتسوية')
    await load()
  }

  return (
    <div dir="rtl" className="space-y-6 max-w-4xl">
      <h1 className="text-2xl font-bold">المخازن والتحويل والجرد</h1>
      {msg && <div className="p-3 bg-emerald-50 text-emerald-800 rounded-lg text-sm">{msg}</div>}

      <section className="bg-white dark:bg-gray-800 p-4 rounded-xl border space-y-3">
        <h2 className="font-semibold">المخازن</h2>
        <ul className="text-sm space-y-1">
          {warehouses.map((w) => (
            <li key={w.id}>{w.name} ({w.code}) {w.isDefault ? '— افتراضي' : ''}</li>
          ))}
        </ul>
        <form onSubmit={addWarehouse} className="flex flex-wrap gap-2">
          <input placeholder="اسم المخزن" value={name} onChange={(e) => setName(e.target.value)} className="border rounded px-2 py-1" required />
          <input placeholder="كود" value={code} onChange={(e) => setCode(e.target.value)} className="border rounded px-2 py-1 w-24" required />
          <button className="px-3 py-1 bg-blue-600 text-white rounded text-sm">إضافة</button>
        </form>
      </section>

      <section className="bg-white dark:bg-gray-800 p-4 rounded-xl border space-y-3">
        <h2 className="font-semibold">تحويل بين مخازن</h2>
        <form onSubmit={doTransfer} className="grid sm:grid-cols-2 gap-2">
          <select value={fromWh} onChange={(e) => setFromWh(e.target.value)} className="border rounded px-2 py-1">
            {warehouses.map((w) => <option key={w.id} value={w.id}>من: {w.name}</option>)}
          </select>
          <select value={toWh} onChange={(e) => setToWh(e.target.value)} className="border rounded px-2 py-1">
            {warehouses.map((w) => <option key={w.id} value={w.id}>إلى: {w.name}</option>)}
          </select>
          <select value={itemId} onChange={(e) => setItemId(e.target.value)} className="border rounded px-2 py-1" required>
            <option value="">اختر صنف</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.name_ar}</option>)}
          </select>
          <input type="number" min={0.001} step="any" value={qty} onChange={(e) => setQty(Number(e.target.value))} className="border rounded px-2 py-1" />
          <button className="px-3 py-2 bg-indigo-600 text-white rounded text-sm sm:col-span-2">تحويل</button>
        </form>
      </section>

      <section className="bg-white dark:bg-gray-800 p-4 rounded-xl border space-y-3">
        <h2 className="font-semibold">جرد سريع (صنف واحد)</h2>
        <form onSubmit={createCount} className="grid sm:grid-cols-2 gap-2">
          <select value={countWh} onChange={(e) => setCountWh(e.target.value)} className="border rounded px-2 py-1">
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <select value={countItem} onChange={(e) => setCountItem(e.target.value)} className="border rounded px-2 py-1" required>
            <option value="">اختر صنف</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.name_ar}</option>)}
          </select>
          <input type="number" step="any" value={countQty} onChange={(e) => setCountQty(Number(e.target.value))}
            placeholder="الكمية الفعلية" className="border rounded px-2 py-1" />
          <button className="px-3 py-2 bg-amber-600 text-white rounded text-sm">حفظ وتسوية</button>
        </form>
        <div className="text-xs text-gray-500">آخر الجردات: {counts.slice(0, 5).map((c) => `${c.warehouse.name} (${c.status}/${c._count.lines})`).join(' · ') || 'لا يوجد'}</div>
      </section>

      <p className="text-xs text-gray-400">قيمة المخزون بتكلفة متوسطة تظهر في تقرير الجرد — {formatMoney(0).replace('0', '…')}</p>
    </div>
  )
}
