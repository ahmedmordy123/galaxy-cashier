'use client'

import { useEffect, useRef, useState } from 'react'
import api from '@/lib/api'

export default function BarcodeLabelsPage() {
  const [items, setItems] = useState<Array<{ id: string; name_ar: string; barcode: string | null; retailPrice: number }>>([])
  const [selected, setSelected] = useState<string[]>([])
  const printRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.get('/api/items', { params: { limit: 300 } }).then((r) => {
      const list = r.data?.data?.items || r.data?.data || []
      setItems(Array.isArray(list) ? list.filter((i: { barcode: string | null }) => i.barcode) : [])
    })
  }, [])

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  function print() {
    window.print()
  }

  const chosen = items.filter((i) => selected.includes(i.id))

  return (
    <div dir="rtl">
      <div className="print:hidden space-y-4 mb-6">
        <h1 className="text-2xl font-bold">ملصقات الباركود</h1>
        <div className="max-h-64 overflow-y-auto border rounded-xl bg-white p-2 space-y-1">
          {items.map((i) => (
            <label key={i.id} className="flex items-center gap-2 text-sm p-1 hover:bg-gray-50">
              <input type="checkbox" checked={selected.includes(i.id)} onChange={() => toggle(i.id)} />
              <span>{i.name_ar}</span>
              <span className="text-gray-400 font-mono text-xs">{i.barcode}</span>
            </label>
          ))}
        </div>
        <button onClick={print} disabled={!chosen.length} className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50">
          طباعة ({chosen.length})
        </button>
      </div>

      <div ref={printRef} className="grid grid-cols-2 sm:grid-cols-3 gap-3 print:grid-cols-3">
        {chosen.map((i) => (
          <div key={i.id} className="border border-black p-3 text-center break-inside-avoid">
            <div className="text-sm font-bold mb-1">{i.name_ar}</div>
            <div className="font-mono text-lg tracking-widest">{i.barcode}</div>
            <div className="text-sm mt-1">{Number(i.retailPrice).toFixed(2)} ج.م</div>
          </div>
        ))}
      </div>
    </div>
  )
}
