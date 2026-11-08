'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import api from '@/lib/api'
import { salesService } from '@/services/sales.service'
import { customersService } from '@/services/customers.service'
import { useSoundFeedback } from '@/hooks/useSoundFeedback'
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner'
import { useAuth } from '@/hooks/useAuth'
import { CameraScanner } from '@/components/barcode/CameraScanner'
import { QuickAddItemModal, type ScannedItem } from '@/components/barcode/QuickAddItemModal'
import { CURRENCY_CODE, formatMoney, formatNumber } from '@/lib/currency'
import { computeInvoiceTotals, type DiscountType, type TaxMode } from '@/lib/salesTotals'
import { isTaxPolicyChangedError, promptTaxPolicyChange } from '@/lib/taxPolicyConfirm'

type PriceType = 'RETAIL' | 'WHOLESALE' | 'SPECIAL'
type PaymentType = 'CASH' | 'CREDIT'

const PRICE_TYPE_LABELS: Record<PriceType, string> = {
  RETAIL: 'مفرد',
  WHOLESALE: 'جملة',
  SPECIAL: 'خاص',
}

const PRICE_TYPE_FIELD: Record<PriceType, keyof AllPrices> = {
  RETAIL: 'retailPrice',
  WHOLESALE: 'wholesalePrice',
  SPECIAL: 'specialPrice',
}

interface AllPrices {
  retailPrice: number
  wholesalePrice: number
  specialPrice: number
  dollarPrice: number
  dinarPrice: number
}

interface InvoiceLine {
  itemId: string
  nameAr: string
  nameEn: string
  barcode: string
  quantity: number
  unitPrice: number
  /** Catalog price when line was added (before override) */
  originalUnitPrice: number
  costPrice: number
  discount: number
  lineTotal: number
  linePriceType: PriceType
  allPrices: AllPrices
  trackSerial: boolean
  serialNumber: string
  taxExempt: boolean
}

interface CustomerOption {
  id: string
  name: string
  currency: string
}

interface CustomerDetail {
  balance: number
  creditLimit: number | null
}

interface ItemData extends AllPrices {
  id: string
  name_ar: string
  name_en: string
  barcode: string | null
  stockQty: number
  costPrice?: number
  trackSerial?: boolean
  taxExempt?: boolean
  isFavorite?: boolean
}

function resolvePrice(prices: AllPrices, priceType: PriceType): number {
  return prices[PRICE_TYPE_FIELD[priceType]] ?? 0
}

function calcLineTotal(qty: number, price: number, discount: number): number {
  return qty * price * (1 - discount / 100)
}

export default function NewSalesInvoicePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const resumeId = searchParams.get('resumeId')
  const barcodeRef = useRef<HTMLInputElement>(null)
  const itemSearchRef = useRef<HTMLInputElement>(null)
  const parkedPanelRef = useRef<HTMLDivElement>(null)
  const confirmClickRef = useRef<() => void>(() => {})
  const parkClickRef = useRef<() => void>(() => {})
  const { playBeep, playBuzz } = useSoundFeedback()
  const { user } = useAuth()
  const hideCost = user?.role === 'CASHIER'
  const canEditPrice =
    Boolean(user?.canEditPrice) || user?.role === 'ADMIN' || user?.role === 'MANAGER'
  const canStarFavorite = user?.role === 'ADMIN' || user?.role === 'MANAGER' || user?.role === 'STAFF'

  const [lines, setLines] = useState<InvoiceLine[]>([])
  const [priceType, setPriceType] = useState<PriceType>('RETAIL')
  const [paymentType, setPaymentType] = useState<PaymentType>('CASH')
  const [discount, setDiscount] = useState<number>(0)
  const [discountType, setDiscountType] = useState<DiscountType>('PERCENT')
  const [notes, setNotes] = useState('')
  const [customerId, setCustomerId] = useState<string>('')
  const [customerSearch, setCustomerSearch] = useState('')
  const [newCustomerPhone, setNewCustomerPhone] = useState('')
  const [customerAddError, setCustomerAddError] = useState('')
  const [customerAdding, setCustomerAdding] = useState(false)
  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>([])
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false)
  const [selectedCustomerName, setSelectedCustomerName] = useState('')
  const [customerDetail, setCustomerDetail] = useState<CustomerDetail | null>(null)
  const [barcodeInput, setBarcodeInput] = useState('')
  const [itemSearch, setItemSearch] = useState('')
  const [itemOptions, setItemOptions] = useState<ItemData[]>([])
  const [showItemDropdown, setShowItemDropdown] = useState(false)
  const [itemHighlight, setItemHighlight] = useState(0)
  const itemRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [scanStatus, setScanStatus] = useState<'idle' | 'scanning' | 'ok' | 'err'>('idle')
  const [favorites, setFavorites] = useState<ItemData[]>([])
  const [cardAmount, setCardAmount] = useState(0)
  const [walletAmount, setWalletAmount] = useState(0)
  const [parked, setParked] = useState<Array<{ id: string; invoiceNumber: string; total: number; _count: { items: number } }>>([])
  const [parkMsg, setParkMsg] = useState('')
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null)
  const [editingInvoiceNumber, setEditingInvoiceNumber] = useState('')
  const [editingInvoiceUpdatedAt, setEditingInvoiceUpdatedAt] = useState<string | null>(null)
  const [resumeLoading, setResumeLoading] = useState(false)

  // Camera + quick-add modals
  const [showCamera, setShowCamera] = useState(false)
  const [batchMode, setBatchMode] = useState(true)
  const [lastScannedLabel, setLastScannedLabel] = useState('')
  const [quickAddBarcode, setQuickAddBarcode] = useState<string | null>(null)

  // Pay modal
  const [showPayModal, setShowPayModal] = useState(false)
  const [paidAmount, setPaidAmount] = useState<number>(0)
  const [taxPct, setTaxPct] = useState(0)
  const [taxMode, setTaxMode] = useState<TaxMode>('INCLUSIVE')
  const [vatEnabled, setVatEnabled] = useState(true)
  const [belowCostPolicy, setBelowCostPolicy] = useState<'BLOCK' | 'WARN'>('WARN')
  const [belowCostConfirmed, setBelowCostConfirmed] = useState(false)

  function reloadFavorites() {
    api.get('/api/items', { params: { limit: 100 } }).then((r) => {
      const list = r.data?.data?.items || r.data?.data || []
      const arr = Array.isArray(list) ? list : []
      setFavorites(arr.filter((i: ItemData) => i.isFavorite).slice(0, 16))
    }).catch(() => {})
  }

  async function toggleFavorite(e: React.MouseEvent, item: ItemData) {
    e.preventDefault()
    e.stopPropagation()
    if (!canStarFavorite) return
    try {
      await api.put(`/api/items/${item.id}`, { isFavorite: !item.isFavorite })
      setItemOptions((prev) => prev.map((it) => it.id === item.id ? { ...it, isFavorite: !it.isFavorite } : it))
      reloadFavorites()
    } catch { /* CASHIER cannot mutate items */ }
  }

  useEffect(() => {
    barcodeRef.current?.focus()
    api.get('/api/settings').then((r) => {
      const s = r.data?.data ?? {}
      setTaxPct(Number.isFinite(Number(s.tax_rate)) ? Number(s.tax_rate) : 14)
      setTaxMode(s.tax_mode === 'EXCLUSIVE' ? 'EXCLUSIVE' : 'INCLUSIVE')
      setVatEnabled(s.vat_enabled !== 'false')
      setBelowCostPolicy(s.below_cost_policy === 'BLOCK' ? 'BLOCK' : 'WARN')
    }).catch(() => {})
    reloadFavorites()
    salesService.listParked().then((r) => setParked(r.data || [])).catch(() => {})
  }, [])

  useEffect(() => {
    if (!resumeId) return
    let cancelled = false
    setResumeLoading(true)
    setSubmitError('')
    ;(async () => {
      try {
        const res = await salesService.getById(resumeId)
        const inv = res.data
        if (!inv || (inv.status !== 'DRAFT' && inv.status !== 'PARKED')) {
          setSubmitError('لا يمكن تعديل هذه الفاتورة')
          return
        }
        if (cancelled) return
        setEditingInvoiceId(inv.id)
        setEditingInvoiceNumber(inv.invoiceNumber)
        setEditingInvoiceUpdatedAt(typeof inv.updatedAt === 'string' ? inv.updatedAt : null)
        setPriceType((inv.priceType === 'WHOLESALE' || inv.priceType === 'SPECIAL' ? inv.priceType : 'RETAIL') as PriceType)
        setPaymentType(inv.type as PaymentType)
        setDiscount(Number(inv.discount) || 0)
        setDiscountType((inv as { discountType?: string }).discountType === 'FIXED' ? 'FIXED' : 'PERCENT')
        setNotes(inv.notes || '')
        if (inv.customer) {
          setCustomerId(inv.customer.id)
          setSelectedCustomerName(inv.customer.name)
        }
        const loadedLines: InvoiceLine[] = []
        for (const line of inv.items as Array<{
          itemId: string
          quantity: number
          unitPrice: number
          subtotal: number
          serialNumber?: string | null
          item: { id: string; name_ar: string; name_en: string; barcode: string | null; trackSerial?: boolean }
        }>) {
          let itemData: ItemData | null = null
          try {
            const ir = await api.get(`/api/items/${line.itemId}`)
            itemData = ir.data?.data ?? ir.data
          } catch { /* use invoice line only */ }
          const qty = Number(line.quantity)
          const unitPrice = Number(line.unitPrice)
          const costPrice = hideCost
            ? 0
            : itemData && itemData.costPrice != null
              ? Number(itemData.costPrice) || 0
              : 0
          const raw = qty * unitPrice
          const lineDisc = raw > 0 ? Math.round((1 - Number(line.subtotal) / raw) * 10000) / 100 : 0
          const prices: AllPrices = itemData
            ? {
                retailPrice: Number(itemData.retailPrice),
                wholesalePrice: Number(itemData.wholesalePrice),
                specialPrice: Number(itemData.specialPrice),
                dollarPrice: Number(itemData.dollarPrice),
                dinarPrice: Number(itemData.dinarPrice),
              }
            : {
                retailPrice: unitPrice,
                wholesalePrice: unitPrice,
                specialPrice: unitPrice,
                dollarPrice: unitPrice,
                dinarPrice: unitPrice,
              }
          const originalUnitPrice = Number(
            (line as { originalUnitPrice?: number }).originalUnitPrice ?? unitPrice,
          )
          loadedLines.push({
            itemId: line.itemId,
            nameAr: line.item.name_ar,
            nameEn: line.item.name_en,
            barcode: line.item.barcode || '',
            quantity: qty,
            unitPrice,
            originalUnitPrice,
            costPrice,
            discount: lineDisc,
            lineTotal: Number(line.subtotal),
            linePriceType: (inv.priceType === 'WHOLESALE' || inv.priceType === 'SPECIAL' ? inv.priceType : 'RETAIL') as PriceType,
            allPrices: prices,
            trackSerial: Boolean(itemData?.trackSerial ?? line.item.trackSerial),
            serialNumber: line.serialNumber?.trim() || '',
            taxExempt: Boolean(
              (line as { taxExempt?: boolean }).taxExempt ??
                (itemData as { taxExempt?: boolean } | undefined)?.taxExempt,
            ),
          })
        }
        if (!cancelled) setLines(loadedLines)
      } catch {
        if (!cancelled) setSubmitError('فشل تحميل الفاتورة للتعديل')
      } finally {
        if (!cancelled) setResumeLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [resumeId, hideCost])

  useEffect(() => {
    if (!customerId || paymentType !== 'CREDIT') {
      setCustomerDetail(null)
      return
    }
    // Clear immediately so pay/credit UI never shows the previous customer's balance.
    setCustomerDetail(null)
    let cancelled = false
    const requestedId = customerId
    api.get(`/api/customers/${requestedId}`).then((r) => {
      if (cancelled) return
      const c = r.data?.data
      if (c) {
        setCustomerDetail({
          balance: Number(c.balance),
          creditLimit: c.creditLimit != null ? Number(c.creditLimit) : null,
        })
      }
    }).catch(() => {
      if (!cancelled) setCustomerDetail(null)
    })
    return () => {
      cancelled = true
    }
  }, [customerId, paymentType])

  const {
    subtotal,
    tax: taxAmount,
    total,
    discountAmount,
  } = computeInvoiceTotals(
    lines.reduce((sum, l) => sum + l.lineTotal, 0),
    discountType,
    discount,
    taxPct,
    {
      taxMode,
      taxEnabled: vatEnabled,
      taxableSubtotal: lines
        .filter((l) => !l.taxExempt)
        .reduce((sum, l) => sum + l.lineTotal, 0),
    },
  )

  const lossLines = hideCost
    ? []
    : lines.filter(
        (l) => l.costPrice > 0 && l.unitPrice * (1 - l.discount / 100) < l.costPrice - 0.001,
      )

  const creditWarning = (() => {
    if (paymentType !== 'CREDIT' || !customerDetail) return null
    const limit = customerDetail.creditLimit ?? 0
    if (limit <= 0) return 'هذا العميل غير مسموح له بالآجل (حد الائتمان = 0)'
    const projected = customerDetail.balance + total
    if (projected > limit) return `سيتجاوز حد الائتمان (${formatMoney(limit)}) — الرصيد بعد الفاتورة: ${formatMoney(projected)}`
    if (projected > limit * 0.85) return `قريب من حد الائتمان (${formatMoney(limit)}) — متبقي تقريباً: ${formatMoney(limit - projected)}`
    return null
  })()

  const searchCustomers = useCallback(async (q: string) => {
    if (!q.trim()) { setCustomerOptions([]); return }
    try {
      const res = await api.get('/api/customers', { params: { search: q, pageSize: 10 } })
      setCustomerOptions(res.data.data?.customers ?? [])
    } catch { setCustomerOptions([]) }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => searchCustomers(customerSearch), 300)
    return () => clearTimeout(t)
  }, [customerSearch, searchCustomers])

  useEffect(() => {
    if (!itemSearch.trim()) { setItemOptions([]); setShowItemDropdown(false); return }
    const t = setTimeout(async () => {
      try {
        const res = await api.get('/api/items', { params: { search: itemSearch, pageSize: 30 } })
        setItemOptions(res.data.data?.items ?? [])
        setItemHighlight(0)
        setShowItemDropdown(true)
      } catch { setItemOptions([]) }
    }, 300)
    return () => clearTimeout(t)
  }, [itemSearch])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (itemRef.current && !itemRef.current.contains(e.target as Node)) setShowItemDropdown(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'F2') { e.preventDefault(); confirmClickRef.current() }
      if (e.key === 'F3') { e.preventDefault(); itemSearchRef.current?.focus(); itemSearchRef.current?.select() }
      if (e.key === 'F4') { e.preventDefault(); barcodeRef.current?.blur(); (document.getElementById('invoice-discount-input') as HTMLInputElement | null)?.focus() }
      if (e.key === 'F8') { e.preventDefault(); parkClickRef.current() }
      if (e.key === 'F9') { e.preventDefault(); parkedPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); parkedPanelRef.current?.focus() }
      if (e.key === 'Escape') {
        e.preventDefault()
        if (showItemDropdown) { setShowItemDropdown(false); return }
        setShowPayModal(false)
        setSubmitError('')
        barcodeRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showItemDropdown])

  useEffect(() => {
    function onFocusBarcode() { barcodeRef.current?.focus() }
    function onConfirmInvoice() { confirmClickRef.current() }
    document.addEventListener('ims-focus-barcode', onFocusBarcode)
    document.addEventListener('ims-confirm-invoice', onConfirmInvoice)
    return () => {
      document.removeEventListener('ims-focus-barcode', onFocusBarcode)
      document.removeEventListener('ims-confirm-invoice', onConfirmInvoice)
    }
  }, [])

  // Core: add an item to cart (used by barcode, camera, search, quick-add)
  const addItemToCart = useCallback((item: ItemData, overridePriceType?: PriceType) => {
    const pt = overridePriceType ?? priceType
    const trackSerial = Boolean(item.trackSerial)
    const prices: AllPrices = {
      retailPrice: Number(item.retailPrice),
      wholesalePrice: Number(item.wholesalePrice),
      specialPrice: Number(item.specialPrice),
      dollarPrice: Number(item.dollarPrice),
      dinarPrice: Number(item.dinarPrice),
    }
    const price = resolvePrice(prices, pt)
    const costPrice = hideCost ? 0 : Number(item.costPrice) || 0

    setLines((prev) => {
      if (trackSerial) {
        return [
          ...prev,
          {
            itemId: item.id,
            nameAr: item.name_ar,
            nameEn: item.name_en,
            barcode: item.barcode ?? '',
            quantity: 1,
            unitPrice: price,
            originalUnitPrice: price,
            costPrice,
            discount: 0,
            lineTotal: calcLineTotal(1, price, 0),
            linePriceType: pt,
            allPrices: prices,
            trackSerial: true,
            serialNumber: '',
            taxExempt: Boolean(item.taxExempt),
          },
        ]
      }
      const idx = prev.findIndex((l) => l.itemId === item.id && !l.trackSerial)
      if (idx >= 0) {
        return prev.map((l, i) => {
          if (i !== idx) return l
          const newQty = l.quantity + 1
          return { ...l, quantity: newQty, lineTotal: calcLineTotal(newQty, l.unitPrice, l.discount) }
        })
      }
      return [
        ...prev,
        {
          itemId: item.id,
          nameAr: item.name_ar,
          nameEn: item.name_en,
          barcode: item.barcode ?? '',
          quantity: 1,
          unitPrice: price,
          originalUnitPrice: price,
          costPrice,
          discount: 0,
          lineTotal: calcLineTotal(1, price, 0),
          linePriceType: pt,
          allPrices: prices,
          trackSerial: false,
          serialNumber: '',
          taxExempt: Boolean(item.taxExempt),
        },
      ]
    })
  }, [priceType, hideCost])

  // Core: process a barcode string (from HID, camera, or manual input)
  const processBarcode = useCallback(async (barcode: string) => {
    setScanStatus('scanning')
    // Visually flash the barcode in the input field so staff see what was scanned
    setBarcodeInput(barcode)
    try {
      const res = await api.get(`/api/items/barcode/${encodeURIComponent(barcode)}`)
      const item = res.data.data
      if (!item) {
        playBuzz()
        setScanStatus('err')
        setLastScannedLabel('')
        setQuickAddBarcode(barcode)
        setTimeout(() => setScanStatus('idle'), 1500)
        return
      }
      addItemToCart(item as ItemData)
      playBeep()
      setScanStatus('ok')
      setLastScannedLabel(item.name_ar || item.name_en || barcode)
      setTimeout(() => setScanStatus('idle'), 800)
    } catch {
      playBuzz()
      setScanStatus('err')
      setLastScannedLabel('')
      setQuickAddBarcode(barcode)
      setTimeout(() => setScanStatus('idle'), 1500)
    }
    setBarcodeInput('')
    setTimeout(() => barcodeRef.current?.focus(), 50)
  }, [addItemToCart, playBeep, playBuzz])

  async function handleBarcodeSubmit(e: React.FormEvent) {
    e.preventDefault()
    const barcode = barcodeInput.trim()
    if (!barcode) return
    await processBarcode(barcode)
  }

  // Global HID scanner listener (fires when focus is NOT on an input)
  useBarcodeScanner({
    onScan: processBarcode,
    enabled: !showCamera && !quickAddBarcode,
    barcodeInputRef: barcodeRef,
  })

  function handleCameraDetect(barcode: string) {
    // In batch mode the scanner stays open; in single mode it closed itself already
    if (!batchMode) setShowCamera(false)
    processBarcode(barcode)
  }

  function handleQuickAdded(item: ScannedItem) {
    setQuickAddBarcode(null)
    addItemToCart(item as ItemData)
    playBeep()
    setScanStatus('ok')
    setTimeout(() => { setScanStatus('idle'); barcodeRef.current?.focus() }, 800)
  }

  function addItemFromSearch(item: ItemData) {
    addItemToCart(item)
    setItemSearch('')
    setShowItemDropdown(false)
  }

  function updateLine(idx: number, field: 'quantity' | 'discount' | 'unitPrice', value: number) {
    setLines((prev) => prev.map((l, i) => {
      if (i !== idx) return l
      let qty = field === 'quantity' ? value : l.quantity
      if (l.trackSerial && field === 'quantity') qty = 1
      const disc = field === 'discount' ? value : l.discount
      if (field === 'unitPrice') {
        if (!canEditPrice) return l
        const price = Math.max(0, value)
        return { ...l, unitPrice: price, lineTotal: calcLineTotal(qty, price, disc) }
      }
      return { ...l, quantity: qty, discount: disc, lineTotal: calcLineTotal(qty, l.unitPrice, disc) }
    }))
  }

  function updateLineSerial(idx: number, serialNumber: string) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, serialNumber } : l)))
  }

  function validateSerialLines(): string | null {
    for (const l of lines) {
      if (!l.trackSerial) continue
      if (!l.serialNumber.trim()) {
        return `أدخل رقم السيريال للصنف: ${l.nameAr} (أضفه من سيريالات الأجهزة إن لم يكن مسجّلاً)`
      }
    }
    return null
  }

  function updateLinePriceType(idx: number, pt: PriceType) {
    setLines((prev) => prev.map((l, i) => {
      if (i !== idx) return l
      const newPrice = resolvePrice(l.allPrices, pt)
      return {
        ...l,
        linePriceType: pt,
        unitPrice: newPrice,
        originalUnitPrice: newPrice,
        lineTotal: calcLineTotal(l.quantity, newPrice, l.discount),
      }
    }))
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx))
  }

  function buildPayload(forCustomerId?: string | null) {
    return {
      customerId: forCustomerId !== undefined ? forCustomerId : (customerId || null),
      priceType,
      paymentType,
      currency: CURRENCY_CODE,
      exchangeRate: 1,
      discountType,
      discount,
      notes: notes || undefined,
      belowCostConfirmed: belowCostConfirmed || undefined,
      items: lines.map((l) => ({
        itemId: l.itemId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        originalUnitPrice: l.originalUnitPrice,
        priceOverridden: Math.abs(l.unitPrice - l.originalUnitPrice) > 0.001,
        discount: l.discount,
        ...(l.trackSerial && l.serialNumber.trim()
          ? { serialNumber: l.serialNumber.trim() }
          : {}),
      })),
    }
  }

  async function createQuickCustomer(name: string, phone: string): Promise<string> {
    const created = await customersService.create({
      name: name.trim(),
      phone: phone.trim() || null,
      type: 'RETAIL',
      creditLimit: 0,
      currency: CURRENCY_CODE,
    })
    if (!created?.id) throw new Error('فشل في تسجيل العميل')
    setCustomerId(created.id)
    setSelectedCustomerName(created.name)
    setCustomerSearch('')
    setNewCustomerPhone('')
    setShowCustomerDropdown(false)
    setCustomerAddError('')
    return created.id
  }

  async function handleQuickAddCustomer() {
    const name = customerSearch.trim()
    if (!name) {
      setCustomerAddError('أدخل اسم العميل')
      return
    }
    setCustomerAdding(true)
    setCustomerAddError('')
    try {
      await createQuickCustomer(name, newCustomerPhone)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } }
      setCustomerAddError(axiosErr.response?.data?.error ?? 'فشل في تسجيل العميل')
    } finally {
      setCustomerAdding(false)
    }
  }

  /** إذا كُتب اسم عميل دون اختياره من القائمة، يُسجَّل تلقائياً عند حفظ الفاتورة */
  async function resolveCustomerIdForSave(): Promise<string | null> {
    if (customerId) return customerId
    const name = customerSearch.trim()
    if (!name) return null
    return createQuickCustomer(name, newCustomerPhone)
  }

  async function saveInvoice(
    status: 'draft' | 'park' | 'confirm',
    amountPaid?: number,
    ackTaxPolicyChange = false,
  ) {
    if (lines.length === 0) { setSubmitError('أضف صنفاً واحداً على الأقل'); return }
    if (status === 'confirm') {
      const serialErr = validateSerialLines()
      if (serialErr) { setSubmitError(serialErr); return }
    }
    if (paymentType === 'CREDIT' && !customerId && !customerSearch.trim()) {
      setSubmitError('الفاتورة الآجلة تتطلب تحديد عميل أو تسجيل عميل جديد')
      return
    }
    setLoading(true); setSubmitError(''); setCustomerAddError('')
    let pendingConfirmId: string | null = null
    let pendingVersion: string | null = null
    try {
      let activeCustomerId: string | null = customerId
      if (!activeCustomerId && customerSearch.trim()) {
        activeCustomerId = await resolveCustomerIdForSave()
      }
      if (paymentType === 'CREDIT' && !activeCustomerId) {
        setSubmitError('الفاتورة الآجلة تتطلب تحديد عميل أو تسجيل عميل جديد')
        return
      }

      let invoiceId = editingInvoiceId
      const payload = buildPayload(activeCustomerId)
      let versionToken = editingInvoiceUpdatedAt
      if (invoiceId) {
        const updateBody = versionToken ? { ...payload, updatedAt: versionToken } : payload
        const updated = await salesService.update(invoiceId, updateBody)
        const inv = updated.data as { updatedAt?: string; total?: number }
        if (inv?.updatedAt) versionToken = inv.updatedAt
      } else {
        const created = await salesService.create(payload)
        invoiceId = created.data?.id
        const inv = created.data as { updatedAt?: string }
        if (inv?.updatedAt) versionToken = inv.updatedAt
      }
      if (!invoiceId) throw new Error('فشل في حفظ الفاتورة')
      if (status === 'draft') {
        router.push(editingInvoiceId ? `/sales/${invoiceId}` : '/sales')
        return
      }
      if (status === 'park') {
        await salesService.park(invoiceId)
        const parkedRes = await salesService.listParked()
        setParked(parkedRes.data || [])
        setLines([])
        setEditingInvoiceId(null)
        setEditingInvoiceNumber('')
        setEditingInvoiceUpdatedAt(null)
        setCustomerId('')
        setSelectedCustomerName('')
        setCustomerSearch('')
        setDiscount(0)
        setNotes('')
        setParkMsg('تم تعليق الفاتورة — استكملها من لوحة المعلّق بالأسفل (F9)')
        if (resumeId) router.replace('/sales/new')
        barcodeRef.current?.focus()
        return
      }
      pendingConfirmId = invoiceId
      pendingVersion = versionToken
      if (versionToken) setEditingInvoiceUpdatedAt(versionToken)

      const confirmWithTotal = async (payTotal: number, ack: boolean) => {
        const payments: Array<{ method: string; amount: number }> = []
        if (paymentType === 'CREDIT') {
          payments.push({ method: 'CREDIT', amount: payTotal })
        } else {
          const card = Number(cardAmount) || 0
          const wallet = Number(walletAmount) || 0
          const cash = Math.max(0, (amountPaid ?? payTotal) - card - wallet)
          if (cash > 0) payments.push({ method: 'CASH', amount: cash })
          if (card > 0) payments.push({ method: 'CARD', amount: card })
          if (wallet > 0) payments.push({ method: 'WALLET', amount: wallet })
          if (payments.length === 0) payments.push({ method: 'CASH', amount: amountPaid ?? payTotal })
        }
        await salesService.confirm(invoiceId!, {
          amountPaid: paymentType === 'CASH' ? (amountPaid ?? payTotal) : 0,
          payments,
          ...(versionToken ? { updatedAt: versionToken } : {}),
          ...(ack ? { ackTaxPolicyChange: true } : {}),
        })
        router.push(`/sales/${invoiceId}`)
      }

      try {
        await confirmWithTotal(total, ackTaxPolicyChange)
      } catch (confirmErr: unknown) {
        const taxChange = isTaxPolicyChangedError(confirmErr)
        if (taxChange && !ackTaxPolicyChange && promptTaxPolicyChange(taxChange.details)) {
          const nextTotal = Number(taxChange.details.next.total)
          await confirmWithTotal(nextTotal, true)
          return
        }
        if (taxChange && !ackTaxPolicyChange) {
          setSubmitError(
            `تم إلغاء التأكيد — الإجمالي كان سيتغيّر من ${Number(taxChange.details.previous.total).toFixed(2)} إلى ${Number(taxChange.details.next.total).toFixed(2)}`,
          )
          return
        }
        throw confirmErr
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { error?: string; code?: string } } }
      const msg = axiosErr.response?.data?.error ?? (err instanceof Error ? err.message : 'فشل في حفظ الفاتورة')
      setSubmitError(msg)
      if (
        axiosErr.response?.status === 409 &&
        (editingInvoiceId || pendingConfirmId) &&
        axiosErr.response?.data?.code !== 'TAX_POLICY_CHANGED'
      ) {
        setSubmitError(`${msg} — جاري إعادة التحميل…`)
        router.replace(`/sales/new?resumeId=${editingInvoiceId || pendingConfirmId}`)
      } else if (pendingVersion) {
        setEditingInvoiceUpdatedAt(pendingVersion)
      }
    } finally { setLoading(false) }
  }

  async function handleDraft() {
    await saveInvoice('draft')
  }

  function handleConfirmClick() {
    if (lines.length === 0) { setSubmitError('أضف صنفاً واحداً على الأقل'); return }
    const serialErr = validateSerialLines()
    if (serialErr) { setSubmitError(serialErr); return }
    if (paymentType === 'CREDIT' && !customerId && !customerSearch.trim()) {
      setSubmitError('الفاتورة الآجلة تتطلب تحديد عميل أو تسجيل عميل جديد')
      return
    }
    setSubmitError('')
    if (paymentType === 'CASH') { setPaidAmount(Math.ceil(total)); setShowPayModal(true) }
    else doConfirm(undefined)
  }

  async function handlePark() {
    await saveInvoice('park')
  }

  async function doConfirm(amountPaid: number | undefined) {
    setShowPayModal(false)
    await saveInvoice('confirm', amountPaid)
  }

  confirmClickRef.current = handleConfirmClick
  parkClickRef.current = handlePark
  const change = paidAmount - total

  const scanBorderClass =
    scanStatus === 'ok' ? 'border-green-400 ring-1 ring-green-300' :
    scanStatus === 'err' ? 'border-red-400 ring-1 ring-red-300' :
    scanStatus === 'scanning' ? 'border-blue-400 ring-1 ring-blue-300' :
    'border-gray-300 dark:border-gray-600'

  return (
    <div dir="rtl" className="max-w-5xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700 text-sm">← رجوع</button>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          {editingInvoiceId ? `تعديل فاتورة ${editingInvoiceNumber}` : 'فاتورة مبيعات جديدة'}
        </h1>
      </div>

      <div className="mb-4 flex flex-wrap gap-2 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2">
        <span><kbd className="font-mono bg-white dark:bg-gray-800 px-1 rounded">F2</kbd> تأكيد/دفع</span>
        <span><kbd className="font-mono bg-white dark:bg-gray-800 px-1 rounded">F3</kbd> بحث صنف</span>
        <span><kbd className="font-mono bg-white dark:bg-gray-800 px-1 rounded">F4</kbd> خصم الفاتورة</span>
        <span><kbd className="font-mono bg-white dark:bg-gray-800 px-1 rounded">F8</kbd> تعليق</span>
        <span><kbd className="font-mono bg-white dark:bg-gray-800 px-1 rounded">F9</kbd> المعلّق</span>
        <span><kbd className="font-mono bg-white dark:bg-gray-800 px-1 rounded">Esc</kbd> إلغاء/باركود</span>
        <span className="text-emerald-700 dark:text-emerald-400">
          {vatEnabled
            ? taxMode === 'EXCLUSIVE'
              ? `ضريبة مضافة ${taxPct}%`
              : `أسعار شامل الضريبة ${taxPct}%`
            : 'الضريبة متوقفة'}
        </span>
      </div>

      {parkMsg && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 px-4 py-2 text-sm">
          {parkMsg}
        </div>
      )}

      {creditWarning && paymentType === 'CREDIT' && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 px-4 py-2 text-sm">
          {creditWarning}
        </div>
      )}

      {!hideCost && lossLines.length > 0 && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 text-red-800 px-4 py-2 text-sm space-y-2">
          <div>
            {lossLines.length} صنف/أصناف بسعر أقل من التكلفة
            {belowCostPolicy === 'BLOCK' ? ' — البيع ممنوع حسب الإعدادات.' : ' — راجع قبل التأكيد.'}
          </div>
          {belowCostPolicy === 'WARN' && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={belowCostConfirmed}
                onChange={(e) => setBelowCostConfirmed(e.target.checked)}
              />
              أؤكد البيع بخسارة
            </label>
          )}
        </div>
      )}

      {resumeLoading && (
        <div className="mb-4 text-sm text-gray-500">جار تحميل الفاتورة...</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Settings column */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">نوع السعر</h2>
            <div className="space-y-2">
              {(Object.keys(PRICE_TYPE_LABELS) as PriceType[]).map((pt) => (
                <label key={pt} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="priceType" value={pt} checked={priceType === pt}
                    onChange={() => setPriceType(pt)} className="accent-blue-600" />
                  <span className="text-sm text-gray-700 dark:text-gray-300">{PRICE_TYPE_LABELS[pt]}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl shadow-sm p-4 border border-emerald-200 dark:border-emerald-800">
            <h2 className="text-sm font-semibold text-emerald-800 dark:text-emerald-300 mb-1">العملة</h2>
            <p className="text-lg font-bold text-emerald-700 dark:text-emerald-200">جنيه مصري (ج.م)</p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">طريقة الدفع</h2>
            <div className="flex gap-4">
              {(['CASH', 'CREDIT'] as PaymentType[]).map((pt) => (
                <label key={pt} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="paymentType" value={pt} checked={paymentType === pt}
                    onChange={() => setPaymentType(pt)} className="accent-blue-600" />
                  <span className="text-sm text-gray-700 dark:text-gray-300">{pt === 'CASH' ? 'نقدي' : 'آجل'}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 relative">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              العميل {paymentType === 'CREDIT' && <span className="text-red-500">*</span>}
            </h2>
            {selectedCustomerName ? (
              <div>
                <div className="flex items-center justify-between bg-blue-50 dark:bg-blue-900/30 rounded-lg px-3 py-2">
                  <span className="text-sm font-medium text-blue-700 dark:text-blue-300">{selectedCustomerName}</span>
                  <button type="button"
                    onClick={() => {
                      setCustomerId('')
                      setSelectedCustomerName('')
                      setCustomerSearch('')
                      setNewCustomerPhone('')
                      setCustomerAddError('')
                      setCustomerDetail(null)
                    }}
                    className="text-red-500 hover:text-red-700 text-xs mr-2">حذف</button>
                </div>
                {customerDetail && paymentType === 'CREDIT' && (
                  <div className="mt-2 text-xs space-y-1 px-1">
                    <div className="flex justify-between text-gray-500">
                      <span>الرصيد الحالي</span>
                      <span className={customerDetail.balance > 0 ? 'text-red-500 font-medium' : 'text-green-600 font-medium'}>
                        {formatMoney(customerDetail.balance)}
                      </span>
                    </div>
                    {customerDetail.creditLimit != null && (
                      <div className="flex justify-between text-gray-500">
                        <span>حد الائتمان</span>
                        <span className="font-medium">{formatMoney(customerDetail.creditLimit)}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <input type="text" placeholder="اسم العميل (بحث أو عميل جديد)..." value={customerSearch}
                    onChange={(e) => { setCustomerSearch(e.target.value); setShowCustomerDropdown(true); setCustomerAddError('') }}
                    onFocus={() => setShowCustomerDropdown(true)}
                    onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 200)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                  {showCustomerDropdown && customerOptions.length > 0 && (
                    <div className="absolute z-10 inset-x-0 top-full mt-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {customerOptions.map((c) => (
                        <button key={c.id} type="button"
                          onMouseDown={() => {
                            setCustomerId(c.id)
                            setSelectedCustomerName(c.name)
                            setCustomerSearch('')
                            setNewCustomerPhone('')
                            setShowCustomerDropdown(false)
                            setCustomerAddError('')
                          }}
                          className="w-full text-right px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600">
                          {c.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <input type="tel" placeholder="رقم الهاتف (لعميل جديد)" value={newCustomerPhone}
                  onChange={(e) => setNewCustomerPhone(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                {customerSearch.trim() && (
                  <button
                    type="button"
                    disabled={customerAdding}
                    onClick={handleQuickAddCustomer}
                    className="w-full px-3 py-2 text-sm font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg hover:bg-blue-100 disabled:opacity-50"
                  >
                    {customerAdding ? 'جار التسجيل...' : `➕ تسجيل «${customerSearch.trim()}» كعميل جديد`}
                  </button>
                )}
                {customerAddError && (
                  <p className="text-xs text-red-600">{customerAddError}</p>
                )}
                <p className="text-xs text-gray-400">
                  أو أكمل الفاتورة مباشرة — إذا كتبت اسماً جديداً يُسجَّل تلقائياً عند التأكيد.
                </p>
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">خصم الفاتورة</h2>
            <div className="flex gap-2 mb-2">
              <button type="button" onClick={() => setDiscountType('PERCENT')}
                className={`flex-1 py-1.5 text-xs rounded-lg border ${discountType === 'PERCENT' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300'}`}>نسبة %</button>
              <button type="button" onClick={() => setDiscountType('FIXED')}
                className={`flex-1 py-1.5 text-xs rounded-lg border ${discountType === 'FIXED' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300'}`}>مبلغ ثابت</button>
            </div>
            <input id="invoice-discount-input" type="number" min="0" max={discountType === 'PERCENT' ? 100 : undefined} value={discount}
              onChange={(e) => setDiscount(Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">ملاحظات</h2>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
          </div>
        </div>

        {/* Items column */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">إضافة صنف</h2>

            {/* Barcode input row */}
            <form onSubmit={handleBarcodeSubmit} className="flex gap-2 mb-1">
              <div className="relative flex-1">
                <input
                  ref={barcodeRef}
                  type="text"
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  placeholder="امسح الباركود أو أدخله يدوياً..."
                  autoComplete="off"
                  className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm transition-colors ${scanBorderClass}`}
                />
                {scanStatus === 'ok' && (
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-green-500 text-lg">✓</span>
                )}
                {scanStatus === 'err' && (
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-red-500 text-lg">✗</span>
                )}
                {scanStatus === 'scanning' && (
                  <span className="absolute left-3 top-1/2 -translate-y-1/2">
                    <span className="animate-spin inline-block w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full" />
                  </span>
                )}
              </div>
              <button type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium whitespace-nowrap">
                إضافة
              </button>
              <button type="button" onClick={() => setShowCamera(true)}
                title="مسح بالكاميرا"
                className="px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm flex items-center gap-1.5">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="hidden sm:inline text-xs">كاميرا</span>
              </button>
            </form>

            <p className="text-xs text-gray-400 dark:text-gray-500 mb-3 pr-1">
              يمكنك استخدام ماسح USB مباشرةً — سيُضاف الصنف تلقائياً
            </p>

            <div className="flex items-center gap-2 my-2">
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-600" />
              <span className="text-xs text-gray-400">أو بحث بالاسم</span>
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-600" />
            </div>

            <div ref={itemRef} className="relative">
              <input ref={itemSearchRef} type="text" value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                onFocus={() => { if (itemOptions.length > 0) setShowItemDropdown(true) }}
                onKeyDown={(e) => {
                  if (!showItemDropdown || itemOptions.length === 0) return
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setItemHighlight((i) => Math.min(itemOptions.length - 1, i + 1))
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setItemHighlight((i) => Math.max(0, i - 1))
                  } else if (e.key === 'Enter') {
                    e.preventDefault()
                    const pick = itemOptions[itemHighlight]
                    if (pick) addItemFromSearch(pick)
                  }
                }}
                placeholder="ابحث باسم الصنف... (F3)"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
              {showItemDropdown && (
                <div className="absolute z-10 right-0 left-0 top-full mt-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-80 overflow-y-auto">
                  {itemOptions.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-gray-400 text-center">لا توجد نتائج</div>
                  ) : itemOptions.map((item, idx) => {
                    const price = resolvePrice(item as AllPrices, priceType)
                    const stock = Number(item.stockQty)
                    return (
                      <div key={item.id}
                        className={`flex items-stretch border-b border-gray-100 dark:border-gray-600 last:border-0 ${idx === itemHighlight ? 'bg-blue-50 dark:bg-blue-900/30' : ''}`}>
                        <button type="button" onMouseDown={() => addItemFromSearch(item)}
                          onMouseEnter={() => setItemHighlight(idx)}
                          className="flex-1 text-right px-4 py-2.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-600">
                          <div className="font-medium text-gray-900 dark:text-white">{item.name_ar}</div>
                          <div className="flex items-center justify-between mt-0.5">
                            <div className="flex items-center gap-3">
                              {item.barcode && <span className="text-xs text-gray-400 font-mono">{item.barcode}</span>}
                              <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                                {formatMoney(price)}
                              </span>
                            </div>
                            <span className={`text-xs font-medium ${stock <= 0 ? 'text-red-500' : stock <= 5 ? 'text-amber-500' : 'text-green-600'}`}>
                              مخزون: {stock.toLocaleString("en-EG", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                        </button>
                        {canStarFavorite && (
                          <button type="button" title="مفضلة"
                            onMouseDown={(e) => toggleFavorite(e, item)}
                            className={`px-3 text-lg ${item.isFavorite ? 'text-amber-500' : 'text-gray-300 hover:text-amber-400'}`}>
                            ★
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Invoice lines table */}
          {favorites.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-3">
              <h3 className="text-xs font-semibold text-gray-500 mb-2">أصناف مفضلة — ضغطة واحدة</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {favorites.map((f) => (
                  <button key={f.id} type="button" onClick={() => addItemFromSearch(f)}
                    className="px-3 py-3 text-sm rounded-xl bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-900 text-right">
                    <div className="font-semibold leading-tight">{f.name_ar}</div>
                    <div className="text-xs text-blue-600 mt-1">{formatMoney(resolvePrice(f, priceType))}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
            {lines.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">
                لم يتم إضافة أي أصناف — امسح الباركود أو ابحث بالاسم للبدء
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                  <tr>
                    <th className="px-3 py-3 text-right font-medium">الصنف</th>
                    <th className="px-3 py-3 text-center font-medium w-24">الكمية</th>
                    <th className="px-3 py-3 text-center font-medium w-36">سعر الوحدة</th>
                    <th className="px-3 py-3 text-center font-medium w-20">خصم%</th>
                    <th className="px-3 py-3 text-center font-medium w-28">الإجمالي</th>
                    <th className="px-3 py-3 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {lines.map((line, idx) => (
                    <tr key={`${line.itemId}-${idx}`} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900 dark:text-white">{line.nameAr}</div>
                        <div className="text-xs text-gray-400 font-mono">{line.barcode}</div>
                        {line.trackSerial && (
                          <div className="mt-2">
                            <label className="text-[10px] text-amber-700 dark:text-amber-400 block mb-0.5">رقم السيريال (مطلوب)</label>
                            <input
                              type="text"
                              value={line.serialNumber}
                              onChange={(e) => updateLineSerial(idx, e.target.value)}
                              placeholder="IMEI / سيريال من المخزن"
                              className="w-full px-2 py-1 border border-amber-300 dark:border-amber-600 rounded bg-amber-50/50 dark:bg-gray-700 text-sm font-mono"
                            />
                          </div>
                        )}
                        {!hideCost && line.costPrice > 0 && line.unitPrice * (1 - line.discount / 100) < line.costPrice - 0.001 && (
                          <div className="text-[10px] text-red-600 dark:text-red-400 mt-1">
                            ⚠ سعر البيع أقل من التكلفة ({formatNumber(line.costPrice)})
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" min="0.001" step="0.001" value={line.quantity}
                          readOnly={line.trackSerial}
                          onChange={(e) => updateLine(idx, 'quantity', Number(e.target.value))}
                          className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm text-center" />
                        {line.trackSerial && (
                          <p className="text-[10px] text-gray-400 mt-0.5 text-center">قطعة = سيريال</p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {canEditPrice ? (
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.unitPrice}
                            onChange={(e) => updateLine(idx, 'unitPrice', Number(e.target.value))}
                            className="w-full px-2 py-1 border border-blue-300 dark:border-blue-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm text-center font-medium"
                            title="تعديل سعر هذه الفاتورة فقط"
                          />
                        ) : (
                          <div className="font-medium text-gray-700 dark:text-gray-300">
                            {line.unitPrice.toLocaleString('en-EG', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                          </div>
                        )}
                        {Math.abs(line.unitPrice - line.originalUnitPrice) > 0.001 && (
                          <div className="text-[10px] text-amber-600 mt-0.5">
                            أصلي: {line.originalUnitPrice.toLocaleString('en-EG', { maximumFractionDigits: 2 })}
                          </div>
                        )}
                        <div className="flex gap-0.5 justify-center mt-1 flex-wrap">
                          {(Object.keys(PRICE_TYPE_LABELS) as PriceType[]).map((pt) => (
                            <button key={pt} type="button"
                              onClick={() => updateLinePriceType(idx, pt)}
                              className={`px-1 py-0 text-[10px] rounded leading-4 transition-colors ${
                                line.linePriceType === pt
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-gray-100 dark:bg-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-500'
                              }`}>
                              {PRICE_TYPE_LABELS[pt]}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" min="0" max="100" value={line.discount}
                          onChange={(e) => updateLine(idx, 'discount', Number(e.target.value))}
                          className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm text-center" />
                      </td>
                      <td className="px-3 py-2 font-medium text-gray-900 dark:text-white text-center">
                        {line.lineTotal.toLocaleString("en-EG", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button type="button" onClick={() => removeLine(idx)}
                          className="text-red-400 hover:text-red-600 text-xl leading-none" title="حذف">×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {lines.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-gray-600 dark:text-gray-400">
                  <span>المجموع الفرعي</span>
                  <span className="font-medium">{formatMoney(subtotal)}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-red-500">
                    <span>الخصم {discountType === 'PERCENT' ? `(${discount}%)` : '(مبلغ)'}</span>
                    <span>- {formatMoney(discountAmount)}</span>
                  </div>
                )}
                {vatEnabled && taxPct > 0 && (
                  <div className="flex justify-between text-gray-600 dark:text-gray-400">
                    <span>
                      {taxMode === 'EXCLUSIVE' ? `ض.ق.م مضافة (${taxPct}%)` : `ض.ق.م متضمنة (${taxPct}%)`}
                    </span>
                    <span>{formatMoney(taxAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-lg font-bold text-gray-900 dark:text-white border-t border-gray-100 dark:border-gray-700 pt-2 mt-2">
                  <span>الإجمالي</span>
                  <span>{formatMoney(total)}</span>
                </div>
              </div>
            </div>
          )}

          {submitError && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-400 rounded-lg px-4 py-3 text-sm">
              {submitError}
            </div>
          )}

          <div className="flex gap-3 flex-wrap">
            <button type="button" onClick={handleDraft} disabled={loading || lines.length === 0}
              className="flex-1 min-w-[120px] px-6 py-3 border-2 border-gray-300 text-gray-700 dark:text-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 font-medium text-sm">
              {loading ? 'جار الحفظ...' : 'حفظ مسودة'}
            </button>
            <button type="button" onClick={handlePark} disabled={loading || lines.length === 0}
              className="flex-1 min-w-[120px] px-6 py-3 border-2 border-amber-400 text-amber-700 rounded-lg hover:bg-amber-50 disabled:opacity-50 font-medium text-sm">
              تعليق فاتورة
            </button>
            <button type="button" onClick={handleConfirmClick} disabled={loading || lines.length === 0}
              className="flex-1 min-w-[120px] px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium text-sm">
              {loading ? 'جار التأكيد...' : 'تأكيد الفاتورة'}
            </button>
          </div>
          <div ref={parkedPanelRef} tabIndex={-1} className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 outline-none">
            <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-2">فواتير معلّقة (F9)</h3>
            {parked.length === 0 ? (
              <p className="text-xs text-amber-700/70">لا توجد فواتير معلّقة — F8 لتعليق الفاتورة الحالية</p>
            ) : (
              <ul className="space-y-2">
                {parked.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 bg-white dark:bg-gray-800 rounded-lg px-3 py-2 text-sm">
                    <div>
                      <span className="font-medium">{p.invoiceNumber}</span>
                      <span className="text-gray-400 mr-2"> · {p._count?.items ?? 0} أصناف</span>
                      <span className="font-semibold text-amber-800">{formatMoney(Number(p.total))}</span>
                    </div>
                    <button type="button"
                      onClick={() => router.push(`/sales/new?resumeId=${p.id}`)}
                      className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-semibold hover:bg-amber-700">
                      استكمال
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Camera scanner dialog */}
      <CameraScanner
        open={showCamera}
        onDetect={handleCameraDetect}
        onClose={() => { setShowCamera(false); setTimeout(() => barcodeRef.current?.focus(), 100) }}
        batchMode={batchMode}
        onBatchModeChange={setBatchMode}
        lastScannedLabel={lastScannedLabel}
      />

      {/* Quick add item modal */}
      {quickAddBarcode && (
        <QuickAddItemModal
          barcode={quickAddBarcode}
          onAdded={handleQuickAdded}
          onClose={() => { setQuickAddBarcode(null); setScanStatus('idle'); barcodeRef.current?.focus() }}
        />
      )}

      {/* Cash payment modal */}
      {showPayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div dir="rtl" className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">تسوية الدفع النقدي</h2>
            <div className="space-y-3 mb-5">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">المبلغ المستحق</span>
                <span className="font-bold text-gray-900 dark:text-white text-base">
                  {formatMoney(total)}
                </span>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">المبلغ المستلم (نقدي + بطاقة + محفظة)</label>
                <input type="number" min={total} step="1" value={paidAmount}
                  onChange={(e) => setPaidAmount(Number(e.target.value))} autoFocus
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-lg font-bold text-center" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500">بطاقة</label>
                  <input type="number" min={0} value={cardAmount} onChange={(e) => setCardAmount(Number(e.target.value))}
                    className="w-full px-2 py-1 border rounded text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">محفظة</label>
                  <input type="number" min={0} value={walletAmount} onChange={(e) => setWalletAmount(Number(e.target.value))}
                    className="w-full px-2 py-1 border rounded text-sm" />
                </div>
              </div>
              <div className="flex justify-between text-sm bg-gray-50 dark:bg-gray-700 rounded-lg px-3 py-2">
                <span className="text-gray-500">الباقي للعميل</span>
                <span className={`font-bold text-lg ${change >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {formatMoney(Math.max(0, change))}
                </span>
              </div>
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setShowPayModal(false)}
                className="flex-1 px-4 py-2.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium">
                إلغاء
              </button>
              <button type="button" onClick={() => doConfirm(paidAmount)} disabled={paidAmount < total}
                className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm font-bold">
                تأكيد الدفع
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
