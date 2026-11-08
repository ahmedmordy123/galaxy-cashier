'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import api from '@/lib/api'
import { formatMoney } from '@/lib/currency'

export default function ItemLedgerInner() {
  const sp = useSearchParams()
  const [itemId, setItemId] = useState(sp.get('itemId') || '')
  const [items, setItems] = useState<Array<{ id: string; name_ar: string }>>([])
  const [data, setData] = useState<{
    item: { name_ar: string; costPrice: number; stockQty: number } | null
    balances: Array<{ qty: number; warehouse: { name: string } }>
    movements: Array<{
      createdAt: string
      type: string
      reason: string
      quantity: number
      avgCostAfter: number
      notes: string | null
      fromWarehouse?: { name: string } | null
      toWarehouse?: { name: string } | null
    }>
  } | null>(null)

  useEffect(() => {
    api.get('/api/items', { params: { limit: 300 } }).then((r) => {
      const list = r.data?.data?.items || r.data?.data || []
      setItems(Array.isArray(list) ? list : [])
    })
  }, [])

  useEffect(() => {
    if (!itemId) {
      setData(null)
      return
    }
    let cancelled = false
    setData(null)
    api
      .get(`/api/ops/item-ledger/${itemId}`)
      .then((res) => {
        if (!cancelled) setData(res.data.data)
      })
      .catch(() => {
        if (!cancelled) setData(null)
      })
    return () => {
      cancelled = true
    }
  }, [itemId])

  return (
    <div dir="rtl" className="space-y-4">
      <h1 className="text-2xl font-bold">حركة الصنف</h1>
      <select value={itemId} onChange={(e) => setItemId(e.target.value)} className="border rounded px-3 py-2 w-full max-w-md">
        <option value="">اختر صنف</option>
        {items.map((i) => <option key={i.id} value={i.id}>{i.name_ar}</option>)}
      </select>

      {data?.item && (
        <div className="flex flex-wrap gap-4 text-sm bg-white p-4 rounded-xl border">
          <span>{data.item.name_ar}</span>
          <span>متوسط التكلفة: {formatMoney(Number(data.item.costPrice))}</span>
          <span>إجمالي الكمية: {Number(data.item.stockQty)}</span>
          {data.balances.map((b, idx) => (
            <span key={idx}>{b.warehouse.name}: {Number(b.qty)}</span>
          ))}
        </div>
      )}

      <div className="overflow-x-auto bg-white rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-2 text-right">التاريخ</th>
              <th className="p-2 text-right">نوع</th>
              <th className="p-2 text-right">سبب</th>
              <th className="p-2 text-right">كمية</th>
              <th className="p-2 text-right">متوسط بعد</th>
              <th className="p-2 text-right">من/إلى</th>
              <th className="p-2 text-right">ملاحظات</th>
            </tr>
          </thead>
          <tbody>
            {(data?.movements || []).map((m, i) => (
              <tr key={i} className="border-t">
                <td className="p-2">{new Date(m.createdAt).toLocaleString('ar-EG')}</td>
                <td className="p-2">{m.type}</td>
                <td className="p-2">{m.reason}</td>
                <td className="p-2">{Number(m.quantity)}</td>
                <td className="p-2">{formatMoney(Number(m.avgCostAfter))}</td>
                <td className="p-2 text-xs">{[m.fromWarehouse?.name, m.toWarehouse?.name].filter(Boolean).join(' → ') || '—'}</td>
                <td className="p-2 text-xs">{m.notes || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
