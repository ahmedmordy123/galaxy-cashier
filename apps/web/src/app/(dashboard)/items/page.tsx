'use client'

import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { itemsService } from '@/services/items.service'
import { useAuth } from '@/hooks/useAuth'
import { CameraScanner, ScanResult } from '@/components/barcode/CameraScanner'
import { TableSkeleton } from '@/components/ui/TableSkeleton'

type PriceField = 'costPrice' | 'retailPrice' | 'wholesalePrice' | 'specialPrice'
type BulkScope = 'selected' | 'filtered' | 'all'
type BulkMode = 'percent' | 'amount' | 'set'

const PRICE_FIELD_LABELS: Record<PriceField, string> = {
  costPrice: 'سعر التكلفة',
  retailPrice: 'سعر المفرد',
  wholesalePrice: 'سعر الجملة',
  specialPrice: 'سعر خاص',
}

interface Item {
  id: string
  barcode: string | null
  name_ar: string
  name_en: string
  unit: string
  stockQty: number
  retailPrice: number
  costPrice: number
  minimumStock: number
  isActive: boolean
  category?: { name_ar: string; name_en: string }
}

interface ValidateRow { row: number; name_ar: string; name_en: string; barcode: string | null }
interface ValidateUpdateRow { row: number; name_ar: string; name_en: string; barcode: string; existingId: string }
interface ValidateInvalidRow { row: number; errors: string[] }
interface ValidationPreview {
  toCreate: ValidateRow[]
  toUpdate: ValidateUpdateRow[]
  invalid: ValidateInvalidRow[]
  summary: { total: number; willCreate: number; willUpdate: number; invalid: number }
}

function ItemsPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user } = useAuth()
  const canManage = user?.role === 'ADMIN' || user?.role === 'MANAGER'
  const canMutateItems =
    user?.role === 'ADMIN' || user?.role === 'MANAGER' || user?.role === 'STAFF'
  const [items, setItems] = useState<Item[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [page, setPage] = useState(1)
  const [showScanner, setShowScanner] = useState(false)
  const [scanStatus, setScanStatus] = useState<'idle' | 'checking'>('idle')
  const [scanError, setScanError] = useState('')
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const importRef = useRef<HTMLInputElement>(null)

  const [importLoading, setImportLoading] = useState(false)
  const [importResult, setImportResult] = useState<{
    created: number; updated: number; skipped: number; errors: string[]
  } | null>(null)

  const [validateLoading, setValidateLoading] = useState(false)
  const [validationPreview, setValidationPreview] = useState<ValidationPreview | null>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkScope, setBulkScope] = useState<BulkScope>('selected')
  const [bulkMode, setBulkMode] = useState<BulkMode>('percent')
  const [bulkValue, setBulkValue] = useState<number>(0)
  const [bulkFields, setBulkFields] = useState<PriceField[]>(['retailPrice'])
  const [bulkLoading, setBulkLoading] = useState(false)
  const [bulkMsg, setBulkMsg] = useState('')
  const [deleteLoadingId, setDeleteLoadingId] = useState<string | null>(null)

  const hasMore = items.length < total

  // Auto-reopen scanner when returning from new-item form
  useEffect(() => {
    if (searchParams.get('scan') === '1') setShowScanner(true)
  }, [searchParams])

  // Initial load / search-change: always replaces items
  const load = useCallback(async () => {
    setLoading(true)
    setItems([])
    setPage(1)
    try {
      const data = await itemsService.getAll({ search, page: 1, pageSize: 20 })
      setItems(data.items)
      setTotal(data.total)
    } catch {
      // handled by interceptor
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    setSelectedIds(new Set())
  }, [search])

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAllOnPage() {
    if (items.every((i) => selectedIds.has(i.id))) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        items.forEach((i) => next.delete(i.id))
        return next
      })
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        items.forEach((i) => next.add(i.id))
        return next
      })
    }
  }

  async function handleDeleteItem(item: Item) {
    if (!canManage) return
    const ok = window.confirm(`حذف الصنف «${item.name_ar}»؟\n(إخفاء من القائمة — لا يُحذف من الفواتير القديمة)`)
    if (!ok) return
    setDeleteLoadingId(item.id)
    try {
      await itemsService.delete(item.id)
      setItems((prev) => prev.filter((i) => i.id !== item.id))
      setTotal((t) => Math.max(0, t - 1))
      setSelectedIds((prev) => {
        const next = new Set(prev)
        next.delete(item.id)
        return next
      })
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'فشل الحذف'
      alert(msg)
    } finally {
      setDeleteLoadingId(null)
    }
  }

  async function handleBulkDelete() {
    if (!canManage) return
    const scope = bulkScope
    const countLabel =
      scope === 'selected' ? selectedIds.size :
      scope === 'filtered' ? `نتائج البحث (${total})` : `كل الأصناف (${total})`
    if (scope === 'selected' && selectedIds.size === 0) {
      setBulkMsg('حدد أصنافاً أولاً')
      return
    }
    if (!window.confirm(`حذف ${countLabel}؟`)) return
    setBulkLoading(true)
    setBulkMsg('')
    try {
      await itemsService.bulk({
        action: 'delete',
        scope,
        itemIds: scope === 'selected' ? [...selectedIds] : undefined,
        search: scope === 'filtered' ? search : undefined,
      })
      setBulkMsg('تم الحذف')
      setSelectedIds(new Set())
      load()
    } catch (err: unknown) {
      setBulkMsg((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'فشل الحذف')
    } finally {
      setBulkLoading(false)
    }
  }

  async function handleBulkAdjust(e: React.FormEvent) {
    e.preventDefault()
    if (!canManage) return
    if (bulkFields.length === 0) {
      setBulkMsg('اختر حقول الأسعار')
      return
    }
    if (bulkScope === 'selected' && selectedIds.size === 0) {
      setBulkMsg('حدد أصنافاً أو غيّر النطاق إلى «كل نتائج البحث»')
      return
    }
    setBulkLoading(true)
    setBulkMsg('')
    try {
      const res = await itemsService.bulk({
        action: 'adjustPrices',
        scope: bulkScope,
        itemIds: bulkScope === 'selected' ? [...selectedIds] : undefined,
        search: bulkScope === 'filtered' ? search : undefined,
        fields: bulkFields,
        mode: bulkMode,
        value: bulkValue,
      })
      setBulkMsg(`تم تحديث ${res.data?.updated ?? 0} صنف`)
      load()
    } catch (err: unknown) {
      setBulkMsg((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'فشل التعديل')
    } finally {
      setBulkLoading(false)
    }
  }

  function toggleBulkField(field: PriceField) {
    setBulkFields((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field],
    )
  }

  // Append next page when sentinel scrolls into view
  useEffect(() => {
    if (!sentinelRef.current || !hasMore || loading || loadingMore) return
    const el = sentinelRef.current
    const obs = new IntersectionObserver(async ([entry]) => {
      if (!entry.isIntersecting) return
      obs.disconnect()
      setLoadingMore(true)
      try {
        const nextPage = page + 1
        const data = await itemsService.getAll({ search, page: nextPage, pageSize: 20 })
        setItems(prev => [...prev, ...data.items])
        setTotal(data.total)
        setPage(nextPage)
      } catch {
        // handled by interceptor
      } finally {
        setLoadingMore(false)
      }
    }, { threshold: 0.1 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [hasMore, loading, loadingMore, page, search])

  async function handleScan(barcode: string) {
    setScanStatus('checking')
    setScanError('')
    setScanResult(null)
    try {
      const item = await itemsService.getByBarcode(barcode)
      setScanStatus('idle')
      setScanResult({ type: 'success', text: `تم العثور على: ${item.name_ar}` })
      setTimeout(() => {
        setShowScanner(false)
        setScanResult(null)
        router.push(`/items/${item.id}/edit`)
      }, 1400)
    } catch (err: unknown) {
      setScanStatus('idle')
      const httpStatus = (err as { response?: { status?: number } })?.response?.status
      if (!httpStatus || httpStatus === 404) {
        setScanResult({ type: 'info', text: 'باركود جديد — سيتم إضافة الصنف' })
        setTimeout(() => {
          setShowScanner(false)
          setScanResult(null)
          router.push(`/items/new?barcode=${encodeURIComponent(barcode)}&returnToScan=1`)
        }, 1400)
      } else {
        setScanResult({ type: 'error', text: 'حدث خطأ أثناء البحث — حاول مجدداً' })
        setTimeout(() => setScanResult(null), 2500)
      }
    }
  }

  function downloadTemplate() {
    const header = 'name_ar,name_en,barcode,unit,costPrice,retailPrice,wholesalePrice,specialPrice,stockQty,minimumStock'
    const example = 'تلفزيون سامسونج,Samsung TV,1234567890,piece,8000,12000,11000,10500,5,2'
    const blob = new Blob(['﻿' + header + '\n' + example], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'items_template.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (importRef.current) importRef.current.value = ''
    if (!file) return
    setValidateLoading(true)
    setImportResult(null)
    setValidationPreview(null)
    try {
      const res = await itemsService.validateImport(file)
      setPendingFile(file)
      setValidationPreview(res.data)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'فشل التحقق من الملف'
      setImportResult({ created: 0, updated: 0, skipped: 0, errors: [msg] })
    } finally {
      setValidateLoading(false)
    }
  }

  async function handleConfirmImport() {
    if (!pendingFile) return
    setImportLoading(true)
    setValidationPreview(null)
    setPendingFile(null)
    try {
      const res = await itemsService.importItems(pendingFile)
      setImportResult(res.data)
      if (res.data.created > 0 || res.data.updated > 0) load()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'فشل الاستيراد'
      setImportResult({ created: 0, updated: 0, skipped: 0, errors: [msg] })
    } finally {
      setImportLoading(false)
    }
  }

  return (
    <div dir="rtl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">الأصناف</h1>
        <div className="flex gap-2">
          {canMutateItems && (
            <>
              <button
                onClick={() => { setScanError(''); setShowScanner(true) }}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm font-medium"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                مسح لإضافة / تعديل
              </button>
              <button
                onClick={downloadTemplate}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm font-medium"
                title="تحميل قالب الاستيراد"
              >
                📥 قالب
              </button>
              <button
                onClick={() => importRef.current?.click()}
                disabled={importLoading || validateLoading}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors text-sm font-medium"
              >
                {validateLoading ? 'جار التحقق...' : importLoading ? 'جار الاستيراد...' : '📤 استيراد Excel/CSV'}
              </button>
              <input ref={importRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImportFile} />
              <button
                onClick={() => router.push('/items/new')}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
              >
                + إضافة صنف
              </button>
            </>
          )}
        </div>
      </div>

      {importResult && (
        <div className={`mb-4 rounded-lg px-4 py-3 text-sm border ${
          importResult.errors.length > 0 && importResult.created === 0 && importResult.updated === 0
            ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700 text-red-700 dark:text-red-300'
            : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700 text-green-700 dark:text-green-300'
        }`}>
          <div className="flex items-center justify-between">
            <span className="font-medium">
              نتيجة الاستيراد — جديد: {importResult.created}، محدّث: {importResult.updated}، متجاوز: {importResult.skipped}
            </span>
            <button onClick={() => setImportResult(null)} className="text-gray-400 hover:text-gray-600 mr-4">✕</button>
          </div>
          {importResult.errors.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-red-600 dark:text-red-400">
              {importResult.errors.slice(0, 10).map((e, i) => <li key={i}>• {e}</li>)}
              {importResult.errors.length > 10 && (
                <li>• ... و{importResult.errors.length - 10} أخطاء أخرى</li>
              )}
            </ul>
          )}
        </div>
      )}

      {scanStatus === 'checking' && (
        <div className="mb-4 flex items-center gap-2 text-sm text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg px-4 py-2">
          <span className="animate-spin w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full inline-block shrink-0" />
          جار البحث عن الباركود...
        </div>
      )}

      <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <input
          type="text"
          placeholder="بحث بالاسم أو الباركود..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {canManage && (
          <button
            type="button"
            onClick={() => setBulkOpen((o) => !o)}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-indigo-300 dark:border-indigo-600 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
          >
            {bulkOpen ? 'إخفاء التعديل الجماعي' : 'تعديل جماعي / حذف'}
            {selectedIds.size > 0 && ` (${selectedIds.size} محدد)`}
          </button>
        )}
      </div>

      {canManage && bulkOpen && (
        <div className="mb-4 bg-indigo-50/80 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 rounded-xl p-4 space-y-4">
          <h2 className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">تعديل أسعار جماعي</h2>
          <form onSubmit={handleBulkAdjust} className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <span className="text-xs text-gray-600 dark:text-gray-400 w-full sm:w-auto sm:leading-8">الأسعار:</span>
              {(Object.keys(PRICE_FIELD_LABELS) as PriceField[]).map((f) => (
                <label key={f} className="inline-flex items-center gap-1.5 text-sm px-2 py-1 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 cursor-pointer">
                  <input type="checkbox" checked={bulkFields.includes(f)} onChange={() => toggleBulkField(f)} />
                  {PRICE_FIELD_LABELS[f]}
                </label>
              ))}
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <label className="text-sm">
                <span className="block text-xs text-gray-500 mb-1">نوع التعديل</span>
                <select
                  value={bulkMode}
                  onChange={(e) => setBulkMode(e.target.value as BulkMode)}
                  className="w-full border rounded-lg px-2 py-2 dark:bg-gray-800 dark:border-gray-600"
                >
                  <option value="percent">زيادة / نقص بنسبة %</option>
                  <option value="amount">زيادة / نقص مبلغ (ج.م)</option>
                  <option value="set">تعيين سعر ثابت</option>
                </select>
              </label>
              <label className="text-sm">
                <span className="block text-xs text-gray-500 mb-1">
                  {bulkMode === 'percent' ? 'النسبة (سالب = نقص)' : bulkMode === 'amount' ? 'المبلغ (سالب = نقص)' : 'السعر الجديد'}
                </span>
                <input
                  type="number"
                  step="0.01"
                  value={bulkValue}
                  onChange={(e) => setBulkValue(Number(e.target.value))}
                  className="w-full border rounded-lg px-2 py-2 dark:bg-gray-800 dark:border-gray-600"
                />
              </label>
              <label className="text-sm sm:col-span-2">
                <span className="block text-xs text-gray-500 mb-1">يطبّق على</span>
                <select
                  value={bulkScope}
                  onChange={(e) => setBulkScope(e.target.value as BulkScope)}
                  className="w-full border rounded-lg px-2 py-2 dark:bg-gray-800 dark:border-gray-600"
                >
                  <option value="selected">الأصناف المحددة فقط ({selectedIds.size})</option>
                  <option value="filtered">كل نتائج البحث الحالية ({total})</option>
                  <option value="all">كل الأصناف النشطة ({total}+)</option>
                </select>
              </label>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <button
                type="submit"
                disabled={bulkLoading}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {bulkLoading ? 'جار التطبيق...' : 'تطبيق على الأسعار'}
              </button>
              <button
                type="button"
                disabled={bulkLoading}
                onClick={handleBulkDelete}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                حذف حسب النطاق
              </button>
            </div>
          </form>
          {bulkMsg && <p className="text-sm text-indigo-800 dark:text-indigo-200">{bulkMsg}</p>}
          <p className="text-xs text-gray-500">مثال: نقص 10% → نوع «نسبة» والقيمة -10. زيادة 50 ج.م على المفرد والجملة → حدّد الحقلين ونوع «مبلغ» والقيمة 50.</p>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <TableSkeleton cols={canManage ? 7 : 6} />
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-gray-500">لا توجد أصناف</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
              <tr>
                {canManage && (
                  <th className="px-3 py-3 w-10">
                    <input
                      type="checkbox"
                      aria-label="تحديد الكل في الصفحة"
                      checked={items.length > 0 && items.every((i) => selectedIds.has(i.id))}
                      onChange={toggleSelectAllOnPage}
                    />
                  </th>
                )}
                <th className="px-4 py-3 text-right font-medium">الباركود</th>
                <th className="px-4 py-3 text-right font-medium">الاسم</th>
                <th className="px-4 py-3 text-right font-medium">الفئة</th>
                <th className="px-4 py-3 text-right font-medium">المخزون</th>
                <th className="px-4 py-3 text-right font-medium">سعر المفرد</th>
                <th className="px-4 py-3 text-right font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-750">
                  {canManage && (
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(item.id)}
                        onChange={() => toggleSelect(item.id)}
                        aria-label={`تحديد ${item.name_ar}`}
                      />
                    </td>
                  )}
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">{item.barcode || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900 dark:text-white">{item.name_ar}</div>
                    <div className="text-gray-400 text-xs">{item.name_en}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                    {item.category?.name_ar || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`font-medium ${Number(item.stockQty) <= Number(item.minimumStock) && Number(item.minimumStock) > 0 ? 'text-red-600' : 'text-gray-900 dark:text-white'}`}>
                      {Number(item.stockQty).toLocaleString("en-EG", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-900 dark:text-white">
                    {Number(item.retailPrice).toLocaleString("en-EG", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {canMutateItems && (
                        <button
                          type="button"
                          onClick={() => router.push(`/items/${item.id}/edit`)}
                          className="text-blue-600 hover:underline text-sm px-2 py-1"
                        >
                          تعديل
                        </button>
                      )}
                      {canManage && (
                        <button
                          type="button"
                          disabled={deleteLoadingId === item.id}
                          onClick={() => handleDeleteItem(item)}
                          className="text-red-600 hover:underline text-sm px-2 py-1 disabled:opacity-50"
                        >
                          {deleteLoadingId === item.id ? '...' : 'حذف'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Infinite scroll sentinel */}
      {!loading && (
        <div ref={sentinelRef} className="py-4 text-center">
          {loadingMore && (
            <span className="inline-flex items-center gap-2 text-sm text-gray-500">
              <span className="animate-spin w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full inline-block" />
              جار تحميل المزيد...
            </span>
          )}
          {!hasMore && items.length > 0 && (
            <span className="text-xs text-gray-400">تم عرض جميع الأصناف ({total})</span>
          )}
        </div>
      )}

      {/* Validation preview modal */}
      {validationPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">معاينة الاستيراد</h2>
              <button onClick={() => { setValidationPreview(null); setPendingFile(null) }} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">✕</button>
            </div>

            <div className="overflow-y-auto flex-1 px-6 py-4">
              {/* Summary badges */}
              <div className="flex flex-wrap gap-3 mb-4">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-700 text-xs font-medium text-gray-700 dark:text-gray-300">
                  الإجمالي: {validationPreview.summary.total}
                </span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-xs font-medium text-blue-700 dark:text-blue-300">
                  ✚ جديد: {validationPreview.summary.willCreate}
                </span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-xs font-medium text-amber-700 dark:text-amber-300">
                  ✎ تحديث: {validationPreview.summary.willUpdate}
                </span>
                {validationPreview.summary.invalid > 0 && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-100 dark:bg-red-900/40 text-xs font-medium text-red-700 dark:text-red-300">
                    ✕ أخطاء: {validationPreview.summary.invalid}
                  </span>
                )}
              </div>

              {/* Errors */}
              {validationPreview.invalid.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-red-600 dark:text-red-400 mb-2">الصفوف غير الصالحة (ستُتجاهل)</h3>
                  <div className="space-y-1.5">
                    {validationPreview.invalid.slice(0, 8).map((inv) => (
                      <div key={inv.row} className="text-xs bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded px-3 py-2">
                        <span className="font-medium text-red-700 dark:text-red-300">صف {inv.row}:</span>{' '}
                        <span className="text-red-600 dark:text-red-400">{inv.errors.join(' | ')}</span>
                      </div>
                    ))}
                    {validationPreview.invalid.length > 8 && (
                      <p className="text-xs text-red-500">... و{validationPreview.invalid.length - 8} صف آخر بأخطاء</p>
                    )}
                  </div>
                </div>
              )}

              {/* Valid rows preview */}
              {(validationPreview.toCreate.length > 0 || validationPreview.toUpdate.length > 0) && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    الأصناف الصالحة ({validationPreview.summary.willCreate + validationPreview.summary.willUpdate})
                  </h3>
                  <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-600">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                        <tr>
                          <th className="px-3 py-2 text-right font-medium">صف</th>
                          <th className="px-3 py-2 text-right font-medium">الاسم العربي</th>
                          <th className="px-3 py-2 text-right font-medium">الباركود</th>
                          <th className="px-3 py-2 text-right font-medium">الإجراء</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                        {[
                          ...validationPreview.toCreate.slice(0, 5).map(r => ({ ...r, action: 'create' as const })),
                          ...validationPreview.toUpdate.slice(0, 5).map(r => ({ ...r, action: 'update' as const })),
                        ].map((r, i) => (
                          <tr key={i} className="bg-white dark:bg-gray-800">
                            <td className="px-3 py-2 text-gray-400">{r.row}</td>
                            <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">{r.name_ar}</td>
                            <td className="px-3 py-2 font-mono text-gray-500">{r.barcode ?? '—'}</td>
                            <td className="px-3 py-2">
                              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${r.action === 'create' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}`}>
                                {r.action === 'create' ? 'إضافة' : 'تحديث'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {(validationPreview.toCreate.length + validationPreview.toUpdate.length) > 10 && (
                      <p className="text-xs text-gray-400 px-3 py-2 bg-gray-50 dark:bg-gray-750">
                        ... و{validationPreview.toCreate.length + validationPreview.toUpdate.length - 10} صنف آخر
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-700">
              <button
                onClick={() => { setValidationPreview(null); setPendingFile(null) }}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-sm"
              >
                إلغاء
              </button>
              <button
                onClick={handleConfirmImport}
                disabled={validationPreview.summary.willCreate + validationPreview.summary.willUpdate === 0}
                className="px-5 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 text-sm font-medium"
              >
                تأكيد الاستيراد ({validationPreview.summary.willCreate + validationPreview.summary.willUpdate} صنف)
              </button>
            </div>
          </div>
        </div>
      )}

      <CameraScanner
        open={showScanner}
        onDetect={handleScan}
        onClose={() => { setShowScanner(false); setScanStatus('idle'); setScanResult(null) }}
        scanResult={scanResult}
      />
    </div>
  )
}

export default function ItemsPage() {
  return (
    <Suspense fallback={<TableSkeleton cols={6} />}>
      <ItemsPageInner />
    </Suspense>
  )
}
