'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { itemsService } from '@/services/items.service'
import { quotesService } from '@/services/quotes.service'
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner'
import { openQuotePrintWindow, type QuotePrintData } from '@/components/quotes/QuotePrintContent'
import { formatMoney } from '@/lib/currency'

interface Line {
  itemId: string
  nameAr: string
  barcode: string
  quantity: number
  unitPrice: number
  lineTotal: number
}

interface ItemRow {
  id: string
  name_ar: string
  name_en?: string
  barcode: string | null
  retailPrice: number
  stockQty: number
}

export default function NewQuotePage() {
  const router = useRouter()
  const searchRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [searchInput, setSearchInput] = useState('')
  const [itemOptions, setItemOptions] = useState<ItemRow[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [searching, setSearching] = useState(false)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerId, setCustomerId] = useState<string | undefined>()
  const [customerOptions, setCustomerOptions] = useState<Array<{ id: string; name: string; phone?: string }>>([])
  const [discount, setDiscount] = useState(0)
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [settings, setSettings] = useState<Record<string, string>>({})

  useEffect(() => {
    api.get('/api/settings').then((r) => setSettings(r.data?.data ?? {})).catch(() => {})
    searchRef.current?.focus()
  }, [])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const loadItems = useCallback(async (query?: string) => {
    setSearching(true)
    try {
      const result = await itemsService.getAll({
        ...(query?.trim() ? { search: query.trim() } : {}),
        pageSize: 30,
      })
      const items = (result?.items ?? []) as ItemRow[]
      setItemOptions(items)
      setShowDropdown(true)
    } catch {
      setItemOptions([])
      setShowDropdown(true)
      setError('فشل في تحميل الأصناف — تأكد أن السيرفر يعمل')
      setTimeout(() => setError(''), 3000)
    } finally {
      setSearching(false)
    }
  }, [])

  const runSearch = useCallback(async (query: string) => {
    const q = query.trim()
    if (!q) {
      await loadItems()
      return
    }
    await loadItems(q)
  }, [loadItems])

  useEffect(() => {
    const q = searchInput.trim()
    if (!q) return
    const t = setTimeout(() => runSearch(q), 200)
    return () => clearTimeout(t)
  }, [searchInput, runSearch])

  const taxPct = Number(settings.tax_rate || 0)
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0)
  const discountAmount = subtotal * (discount / 100)
  const afterDiscount = subtotal - discountAmount
  const taxAmount = afterDiscount * (taxPct / 100)
  const total = afterDiscount + taxAmount

  const addItem = useCallback((item: ItemRow) => {
    const price = Number(item.retailPrice)
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.itemId === item.id)
      if (idx >= 0) {
        return prev.map((l, i) => i === idx
          ? { ...l, quantity: l.quantity + 1, lineTotal: (l.quantity + 1) * l.unitPrice }
          : l)
      }
      return [...prev, {
        itemId: item.id,
        nameAr: item.name_ar,
        barcode: item.barcode ?? '',
        quantity: 1,
        unitPrice: price,
        lineTotal: price,
      }]
    })
    setSearchInput('')
    setItemOptions([])
    setShowDropdown(false)
    setError('')
    searchRef.current?.focus()
  }, [])

  const tryAddByBarcode = useCallback(async (code: string): Promise<boolean> => {
    try {
      const item = await itemsService.getByBarcode(code) as ItemRow
      if (item) {
        addItem(item)
        return true
      }
    } catch { /* not found */ }
    return false
  }, [addItem])

  const handleSearchSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault()
    const q = searchInput.trim()
    if (!q) return

    // باركود → إضافة مباشرة
    if (/^\d+$/.test(q) && q.length >= 4) {
      const added = await tryAddByBarcode(q)
      if (added) return
    }

    setSearching(true)
    try {
      const result = await itemsService.getAll({ search: q, pageSize: 15 })
      const items = (result?.items ?? []) as ItemRow[]
      if (items.length === 1) {
        addItem(items[0])
      } else if (items.length === 0) {
        setItemOptions([])
        setShowDropdown(true)
        setError(`لم يُعثر على "${q}" — جرّب كلمة أخرى أو امسح الباركود`)
        setTimeout(() => setError(''), 3000)
      } else {
        setItemOptions(items)
        setShowDropdown(true)
      }
    } finally {
      setSearching(false)
    }
  }, [searchInput, tryAddByBarcode, addItem])

  const processBarcode = useCallback(async (code: string) => {
    setSearchInput(code)
    const added = await tryAddByBarcode(code)
    if (!added) {
      setError(`الباركود "${code}" غير مسجل`)
      setTimeout(() => setError(''), 2500)
      await runSearch(code)
    }
    searchRef.current?.focus()
  }, [tryAddByBarcode, runSearch])

  useBarcodeScanner({ onScan: processBarcode, enabled: true, barcodeInputRef: searchRef })

  function buildPrintData(extra?: Partial<QuotePrintData>): QuotePrintData {
    return {
      businessNameAr: settings.business_name_ar,
      businessPhone: settings.business_phone,
      businessAddress: settings.business_address,
      customerName,
      customerPhone,
      lines: lines.map((l) => ({ ...l })),
      subtotal,
      discountPct: discount,
      discountAmount,
      taxPct,
      taxAmount,
      total,
      notes,
      marketingSettings: settings,
      ...extra,
    }
  }

  function handlePrint() {
    if (lines.length === 0) { setError('أضف صنفاً واحداً على الأقل'); return }
    openQuotePrintWindow(buildPrintData())
  }

  async function handleSave(thenPrint: boolean) {
    if (lines.length === 0) { setError('أضف صنفاً واحداً على الأقل'); return }
    setLoading(true)
    setError('')
    try {
      const noteParts = [notes]
      if (customerName) noteParts.unshift(`العميل: ${customerName}${customerPhone ? ` — ${customerPhone}` : ''}`)
      const res = await quotesService.create({
        priceType: 'RETAIL',
        paymentType: 'CASH',
        currency: 'EGP',
        exchangeRate: 1,
        discount,
        customerId: customerId || undefined,
        notes: noteParts.filter(Boolean).join('\n') || undefined,
        items: lines.map((l) => ({
          itemId: l.itemId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discount: 0,
        })),
      })
      const id = res.data?.id
      if (thenPrint && id) {
        router.push(`/quotes/${id}/print`)
      } else if (id) {
        router.push('/quotes')
      }
    } catch {
      setError('فشل في حفظ عرض السعر')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div dir="rtl" className="max-w-4xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700 text-sm">← رجوع</button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">عرض سعر</h1>
          <p className="text-sm text-gray-500">ابحث بالاسم أو امسح الباركود — اعرض الأسعار — اطبع أو احفظ</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 relative">
        <div className="relative">
          <input type="text" placeholder="ابحث عن عميل أو اكتب الاسم" value={customerName}
            onChange={async (e) => {
              const v = e.target.value
              setCustomerName(v)
              setCustomerId(undefined)
              if (v.trim().length < 1) { setCustomerOptions([]); return }
              try {
                const res = await api.get('/api/customers', { params: { search: v, pageSize: 8 } })
                setCustomerOptions(res.data?.data?.customers ?? [])
              } catch { setCustomerOptions([]) }
            }}
            className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 dark:border-gray-600 text-sm" />
          {customerOptions.length > 0 && (
            <div className="absolute z-10 right-0 left-0 top-full mt-1 bg-white dark:bg-gray-700 border rounded-lg shadow-lg max-h-40 overflow-y-auto">
              {customerOptions.map((c) => (
                <button key={c.id} type="button"
                  onMouseDown={() => {
                    setCustomerId(c.id)
                    setCustomerName(c.name)
                    setCustomerPhone(c.phone || '')
                    setCustomerOptions([])
                  }}
                  className="w-full text-right px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-600 border-b last:border-0">
                  {c.name}{c.phone ? ` — ${c.phone}` : ''}
                </button>
              ))}
            </div>
          )}
        </div>
        <input type="text" placeholder="تليفون العميل" value={customerPhone}
          onChange={(e) => setCustomerPhone(e.target.value)}
          className="px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 dark:border-gray-600 text-sm" />
        <input type="number" min="0" max="100" placeholder="خصم %" value={discount}
          onChange={(e) => setDiscount(Number(e.target.value))}
          className="px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 dark:border-gray-600 text-sm" />
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 mb-4">
        <div ref={dropdownRef} className="relative">
          <form onSubmit={handleSearchSubmit} className="flex gap-2">
            <input
              ref={searchRef}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onFocus={() => loadItems(searchInput.trim() || undefined)}
              placeholder="ابحث بالاسم أو الباركود... (اضغط هنا لعرض كل الأصناف)"
              autoComplete="off"
              className="flex-1 px-3 py-2.5 border rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm"
            />
            <button type="submit" className="px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm shrink-0">
              {searching ? '...' : 'بحث'}
            </button>
          </form>
          <p className="text-xs text-gray-400 mt-2">
            اكتب جزء من الاسم — النتائج تظهر تلقائياً. Enter يضيف الصنف إذا كانت نتيجة واحدة.
          </p>

          {showDropdown && (
            <div className="absolute z-20 right-0 left-0 top-full mt-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl max-h-64 overflow-y-auto">
              {searching ? (
                <div className="px-4 py-3 text-sm text-gray-400 text-center">جار البحث...</div>
              ) : itemOptions.length === 0 ? (
                <div className="px-4 py-3 text-sm text-gray-400 text-center">لا توجد نتائج — جرّب كلمة أقصر أو مختلفة</div>
              ) : (
                itemOptions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); addItem(item) }}
                    className="w-full text-right px-4 py-2.5 hover:bg-blue-50 dark:hover:bg-gray-600 border-b last:border-0 text-sm"
                  >
                    <div className="font-medium text-gray-900 dark:text-white">{item.name_ar}</div>
                    <div className="flex items-center justify-between mt-0.5 gap-2">
                      <div className="flex items-center gap-2 text-xs text-gray-400">
                        {item.barcode && <span className="font-mono">{item.barcode}</span>}
                        {item.name_en && <span>{item.name_en}</span>}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-xs text-gray-500">مخزون: {Number(item.stockQty).toLocaleString("en-EG", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
                        <span className="font-bold text-blue-600">{formatMoney(item.retailPrice)}</span>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden mb-4">
        {lines.length === 0 ? (
          <p className="p-8 text-center text-gray-400 text-sm">ابحث عن جهاز بالاسم أو امسح الباركود</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700 text-gray-600">
              <tr>
                <th className="px-3 py-2 text-right">الصنف</th>
                <th className="px-3 py-2 text-center w-24">الكمية</th>
                <th className="px-3 py-2 text-center">السعر</th>
                <th className="px-3 py-2 text-center">الإجمالي</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-gray-700">
              {lines.map((line, idx) => (
                <tr key={line.itemId}>
                  <td className="px-3 py-2 font-medium">{line.nameAr}</td>
                  <td className="px-3 py-2">
                    <input type="number" min="1" value={line.quantity}
                      onChange={(e) => {
                        const q = Number(e.target.value) || 1
                        setLines((prev) => prev.map((l, i) => i === idx ? { ...l, quantity: q, lineTotal: q * l.unitPrice } : l))
                      }}
                      className="w-full px-2 py-1 border rounded text-center dark:bg-gray-700" />
                  </td>
                  <td className="px-3 py-2 text-center">{formatMoney(line.unitPrice)}</td>
                  <td className="px-3 py-2 text-center font-bold">{formatMoney(line.lineTotal)}</td>
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => setLines((p) => p.filter((_, i) => i !== idx))} className="text-red-500">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {lines.length > 0 && (
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 mb-4 space-y-1 text-sm">
          <div className="flex justify-between"><span>المجموع</span><span>{formatMoney(subtotal)}</span></div>
          {discount > 0 && <div className="flex justify-between text-red-600"><span>خصم {discount}%</span><span>- {formatMoney(discountAmount)}</span></div>}
          {taxPct > 0 && <div className="flex justify-between"><span>ض.ق.م {taxPct}%</span><span>{formatMoney(taxAmount)}</span></div>}
          <div className="flex justify-between text-xl font-bold text-blue-800 dark:text-blue-300 pt-2 border-t border-blue-200">
            <span>الإجمالي</span><span>{formatMoney(total)}</span>
          </div>
        </div>
      )}

      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظات (اختياري)..."
        rows={2} className="w-full px-3 py-2 border rounded-lg mb-4 dark:bg-gray-800 dark:border-gray-600 text-sm" />

      {error && <div className="mb-4 text-red-600 text-sm bg-red-50 p-3 rounded-lg">{error}</div>}

      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={handlePrint} disabled={lines.length === 0}
          className="px-5 py-2.5 bg-slate-700 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50 text-sm font-medium">
          🖨️ طباعة (بدون حفظ)
        </button>
        <button type="button" onClick={() => handleSave(false)} disabled={loading || lines.length === 0}
          className="px-5 py-2.5 border-2 border-blue-600 text-blue-700 rounded-lg hover:bg-blue-50 disabled:opacity-50 text-sm font-medium">
          {loading ? 'جار الحفظ...' : '💾 حفظ فقط'}
        </button>
        <button type="button" onClick={() => handleSave(true)} disabled={loading || lines.length === 0}
          className="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium">
          حفظ + طباعة
        </button>
      </div>
    </div>
  )
}
