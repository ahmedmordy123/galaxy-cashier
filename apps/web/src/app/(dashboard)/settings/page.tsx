'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { settingsService } from '@/services/settings.service'
import api from '@/lib/api'

type Tab = 'business' | 'print' | 'eta'

export default function SettingsPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<Tab>('business')

  // ── Settings state ─────────────────────────────────────────────────────────
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [loadingSettings, setLoadingSettings] = useState(true)

  // ── Business info form ─────────────────────────────────────────────────────
  const [businessNameAr, setBusinessNameAr] = useState('')
  const [businessNameEn, setBusinessNameEn] = useState('')
  const [defaultCurrency] = useState('EGP')
  const [defaultPriceType, setDefaultPriceType] = useState('RETAIL')
  const [taxRate, setTaxRate] = useState('0')
  const [vatEnabled, setVatEnabled] = useState(true)
  const [taxMode, setTaxMode] = useState<'INCLUSIVE' | 'EXCLUSIVE'>('INCLUSIVE')
  const [belowCostPolicy, setBelowCostPolicy] = useState<'BLOCK' | 'WARN'>('WARN')
  const [minimumStockAlert, setMinimumStockAlert] = useState('true')
  const [businessAddress, setBusinessAddress] = useState('')
  const [businessPhone, setBusinessPhone] = useState('')
  const [invoiceFooterAr, setInvoiceFooterAr] = useState('')
  const [marketingEnabled, setMarketingEnabled] = useState(true)
  const [marketingBrand, setMarketingBrand] = useState('Galaxy Digital')
  const [facebookHandle, setFacebookHandle] = useState('GalaxyDigitalEG')
  const [savingBusiness, setSavingBusiness] = useState(false)
  const [businessMsg, setBusinessMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // ── Print settings state ───────────────────────────────────────────────────
  const [paperWidth, setPaperWidth] = useState('A4')
  const [savingPrint, setSavingPrint] = useState(false)
  const [printMsg, setPrintMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [backupLoading, setBackupLoading] = useState(false)
  const [backupMsg, setBackupMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [backupList, setBackupList] = useState<Array<{ name: string; path: string; size: number; createdAt: string }>>([])
  const [restoreLoading, setRestoreLoading] = useState(false)
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(true)
  const [autoBackupHours, setAutoBackupHours] = useState('24')
  const [autoBackupKeep, setAutoBackupKeep] = useState('30')
  const [backupDirectory, setBackupDirectory] = useState('')
  const [backupDirectorySecondary, setBackupDirectorySecondary] = useState('')
  const [backupOnExit, setBackupOnExit] = useState(true)
  const [defaultBackupDir, setDefaultBackupDir] = useState('ProgramData\\GalaxyCashier\\backups')
  const [googleDriveInfo, setGoogleDriveInfo] = useState<{
    installed: boolean
    roots: string[]
    suggestedBackupDir: string | null
    driveProcessRunning: boolean
    hints: string[]
  } | null>(null)
  const [pathLooksLikeGoogleDrive, setPathLooksLikeGoogleDrive] = useState(false)
  const [secondaryBackupWarning, setSecondaryBackupWarning] = useState<string | null>(null)
  const [autoBackupStatus, setAutoBackupStatus] = useState<{
    lastAt: string
    nextDueAt: string | null
    intervalHours: number
    directory?: string
  } | null>(null)

  const [etaEnabled, setEtaEnabled] = useState(false)
  const [etaEnvironment, setEtaEnvironment] = useState('preprod')
  const [etaDocType, setEtaDocType] = useState('receipt')
  const [etaRin, setEtaRin] = useState('')
  const [etaPosSerial, setEtaPosSerial] = useState('')
  const [etaClientId, setEtaClientId] = useState('')
  const [savingEta, setSavingEta] = useState(false)
  const [etaMsg, setEtaMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [etaQueue, setEtaQueue] = useState<{ pendingCount: number; retryCount: number } | null>(null)

  // ── Load settings on mount ─────────────────────────────────────────────────
  const loadSettings = useCallback(async () => {
    setLoadingSettings(true)
    try {
      const res = await settingsService.getAll()
      const data: Record<string, string> = res.data ?? {}
      setSettings(data)
      setBusinessNameAr(data.business_name_ar ?? '')
      setBusinessNameEn(data.business_name_en ?? '')
      setDefaultPriceType(data.default_price_type ?? 'RETAIL')
      setTaxRate(data.tax_rate ?? '0')
      setVatEnabled(data.vat_enabled !== 'false')
      setTaxMode(data.tax_mode === 'EXCLUSIVE' ? 'EXCLUSIVE' : 'INCLUSIVE')
      setBelowCostPolicy(data.below_cost_policy === 'BLOCK' ? 'BLOCK' : 'WARN')
      setMinimumStockAlert(data.minimum_stock_alert ?? 'true')
      setBusinessAddress(data.business_address ?? '')
      setBusinessPhone(data.business_phone ?? '')
      setInvoiceFooterAr(data.invoice_footer_ar ?? '')
      setMarketingEnabled(data.invoice_marketing_enabled !== 'false')
      setMarketingBrand(data.invoice_marketing_brand ?? 'Galaxy Digital')
      setFacebookHandle(data.invoice_facebook_handle ?? 'GalaxyDigitalEG')
      setPaperWidth(data.paper_width ?? 'A4')
      setAutoBackupEnabled(data.auto_backup_enabled !== 'false')
      setAutoBackupHours(data.auto_backup_interval_hours ?? '24')
      setAutoBackupKeep(data.auto_backup_keep_count ?? '30')
      setBackupDirectory(data.backup_directory ?? '')
      setBackupDirectorySecondary(data.backup_directory_secondary ?? '')
      setBackupOnExit(data.backup_on_exit !== 'false')
      setEtaEnabled(data.eta_enabled === 'true')
      setEtaEnvironment(data.eta_environment ?? 'preprod')
      setEtaDocType(data.eta_doc_type ?? 'receipt')
      setEtaRin(data.eta_rin ?? '')
      setEtaPosSerial(data.eta_pos_serial ?? '')
      setEtaClientId(data.eta_client_id ?? '')
    } catch {
      // silent
    } finally {
      setLoadingSettings(false)
    }
  }, [])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  // ── Save business info ─────────────────────────────────────────────────────
  async function handleSaveBusiness(e: React.FormEvent) {
    e.preventDefault()
    setBusinessMsg(null)
    setSavingBusiness(true)
    try {
      const payload: Record<string, string> = {}
      if (businessNameAr) payload.business_name_ar = businessNameAr
      if (businessNameEn) payload.business_name_en = businessNameEn
      payload.default_currency = 'EGP'
      payload.default_price_type = defaultPriceType
      // Allow 0% tax — do not coerce 0 to 14
      const taxNum = Number(taxRate)
      payload.tax_rate = String(Number.isFinite(taxNum) ? taxNum : 14)
      payload.vat_enabled = vatEnabled ? 'true' : 'false'
      payload.tax_mode = taxMode
      payload.below_cost_policy = belowCostPolicy
      payload.minimum_stock_alert = minimumStockAlert
      payload.business_address = businessAddress
      payload.business_phone = businessPhone
      payload.invoice_footer_ar = invoiceFooterAr
      payload.invoice_marketing_enabled = marketingEnabled ? 'true' : 'false'
      payload.invoice_marketing_brand = marketingBrand.trim()
      payload.invoice_facebook_handle = facebookHandle.trim()
      payload.auto_backup_enabled = autoBackupEnabled ? 'true' : 'false'
      payload.auto_backup_interval_hours = String(Math.max(1, Math.min(168, Number(autoBackupHours) || 24)))
      payload.auto_backup_keep_count = String(Math.max(5, Math.min(200, Number(autoBackupKeep) || 30)))
      payload.backup_directory = backupDirectory.trim()
      payload.backup_directory_secondary = backupDirectorySecondary.trim()
      payload.backup_on_exit = backupOnExit ? 'true' : 'false'

      await settingsService.update(payload)
      setBusinessMsg({ type: 'success', text: 'تم حفظ الإعدادات بنجاح' })
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string; details?: unknown } } })?.response?.data?.error
        || 'فشل في حفظ الإعدادات'
      const details = (err as { response?: { data?: { details?: Record<string, string[]> } } })?.response?.data?.details
      const detailText = details
        ? ' — ' + Object.entries(details).map(([k, v]) => `${k}: ${(v || []).join(', ')}`).join(' | ')
        : ''
      setBusinessMsg({ type: 'error', text: msg + detailText })
    } finally {
      setSavingBusiness(false)
    }
  }

  // ── Save print settings ────────────────────────────────────────────────────
  async function handleSavePrint(e: React.FormEvent) {
    e.preventDefault()
    setPrintMsg(null)
    setSavingPrint(true)
    try {
      await settingsService.update({ paper_width: paperWidth })
      setPrintMsg({ type: 'success', text: 'تم حفظ إعدادات الطباعة' })
    } catch {
      setPrintMsg({ type: 'error', text: 'فشل في حفظ إعدادات الطباعة' })
    } finally {
      setSavingPrint(false)
    }
  }

  async function loadBackupList() {
    try {
      const [listRes, statusRes] = await Promise.all([
        api.get('/api/backup'),
        api.get('/api/backup/auto-status'),
      ])
      setBackupList(listRes.data?.data ?? [])
      const st = statusRes.data?.data
      if (st) {
        setAutoBackupStatus({
          lastAt: st.lastAt || '',
          nextDueAt: st.nextDueAt ?? null,
          intervalHours: st.intervalHours ?? 24,
          directory: st.directory || '',
        })
        if (st.defaultDirectory) setDefaultBackupDir(String(st.defaultDirectory))
        if (typeof st.onExit === 'boolean') setBackupOnExit(st.onExit)
        if (typeof st.secondaryDirectory === 'string') {
          setBackupDirectorySecondary(st.secondaryDirectory)
        }
        if (st.googleDrive) setGoogleDriveInfo(st.googleDrive)
        setPathLooksLikeGoogleDrive(Boolean(st.pathLooksLikeGoogleDrive))
        setSecondaryBackupWarning(
          typeof st.secondaryWarning === 'string' && st.secondaryWarning
            ? st.secondaryWarning
            : null,
        )
      }
    } catch {
      setBackupList([])
    }
  }

  useEffect(() => {
    if (activeTab === 'business') loadBackupList()
    if (activeTab === 'eta') {
      api.get('/api/eta/status').then((r) => {
        const d = r.data?.data
        if (d) setEtaQueue({ pendingCount: d.pendingCount ?? 0, retryCount: d.retryCount ?? 0 })
      }).catch(() => setEtaQueue(null))
    }
  }, [activeTab])

  async function handleSaveEta(e: React.FormEvent) {
    e.preventDefault()
    setEtaMsg(null)
    setSavingEta(true)
    try {
      await settingsService.update({
        eta_enabled: etaEnabled ? 'true' : 'false',
        eta_environment: etaEnvironment,
        eta_doc_type: etaDocType,
        eta_rin: etaRin.trim(),
        eta_pos_serial: etaPosSerial.trim(),
        eta_client_id: etaClientId.trim(),
      })
      setEtaMsg({ type: 'success', text: 'تم حفظ إعدادات الفاتورة الإلكترونية' })
    } catch {
      setEtaMsg({ type: 'error', text: 'فشل حفظ إعدادات ETA' })
    } finally {
      setSavingEta(false)
    }
  }

  async function handleBackup() {
    setBackupMsg(null)
    setBackupLoading(true)
    try {
      const res = await api.post('/api/backup')
      const p = res.data?.data?.path ?? ''
      setBackupMsg({ type: 'success', text: `تم الحفظ بنجاح:\n${p}` })
      await loadBackupList()
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'فشل النسخ الاحتياطي'
      setBackupMsg({ type: 'error', text: msg })
    } finally {
      setBackupLoading(false)
    }
  }

  async function handleRestore(fileName: string) {
    if (!confirm(`استعادة النسخة «${fileName}»؟ سيتم أخذ نسخة أمان من القاعدة الحالية أولاً.`)) return
    setBackupMsg(null)
    setRestoreLoading(true)
    try {
      const res = await api.post('/api/backup/restore', { fileName })
      const safety = res.data?.data?.safetyBackup ?? ''
      setBackupMsg({
        type: 'success',
        text: `تمت الاستعادة.\nنسخة الأمان: ${safety}\nأعد تشغيل التطبيق الآن.`,
      })
      await loadBackupList()
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'فشل الاستعادة'
      setBackupMsg({ type: 'error', text: msg })
    } finally {
      setRestoreLoading(false)
    }
  }

  async function apiDownloadBackup() {
    setBackupMsg(null)
    try {
      const res = await api.get('/api/backup/download', { responseType: 'blob' })
      const contentType = String(res.headers['content-type'] || '')
      if (contentType.includes('application/json')) {
        const text = await (res.data as Blob).text()
        const json = JSON.parse(text) as { error?: string }
        throw new Error(json.error || 'فشل التحميل')
      }
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `cashier-${new Date().toISOString().slice(0, 10)}.db`
      a.click()
      URL.revokeObjectURL(url)
      setBackupMsg({ type: 'success', text: 'تم بدء تحميل قاعدة البيانات' })
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: Blob | { error?: string } }; message?: string }
      let msg = 'فشل تحميل النسخة'
      try {
        if (axiosErr.response?.data instanceof Blob) {
          const text = await axiosErr.response.data.text()
          const json = JSON.parse(text) as { error?: string }
          if (json.error) msg = json.error
        } else if (typeof axiosErr.response?.data === 'object' && axiosErr.response.data?.error) {
          msg = axiosErr.response.data.error
        } else if (err instanceof Error && err.message) {
          msg = err.message
        }
      } catch { /* keep default */ }
      setBackupMsg({ type: 'error', text: msg })
    }
  }

  const tabClass = (tab: Tab) =>
    `px-5 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
      activeTab === tab
        ? 'bg-white dark:bg-gray-800 text-blue-600 border-t border-r border-l border-gray-200 dark:border-gray-700'
        : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
    }`

  if (loadingSettings) {
    return (
      <div dir="rtl" className="flex items-center justify-center h-48">
        <span className="text-gray-500">جار التحميل...</span>
      </div>
    )
  }

  return (
    <div dir="rtl">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">الإعدادات</h1>

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 mb-0 flex-wrap">
        <button className={tabClass('business')} onClick={() => setActiveTab('business')}>
          معلومات النشاط
        </button>
        <button className={tabClass('print')} onClick={() => setActiveTab('print')}>
          إعدادات الطباعة
        </button>
        <button className={tabClass('eta')} onClick={() => setActiveTab('eta')}>
          الفاتورة الإلكترونية (ETA)
        </button>
        <Link
          href="/settings/audit"
          className="px-5 py-2.5 text-sm font-medium rounded-t-lg transition-colors text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
        >
          سجل العمليات
        </Link>
        <button
          onClick={() => router.push('/staff')}
          className="px-5 py-2.5 text-sm font-medium rounded-t-lg transition-colors text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 flex items-center gap-1.5"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
          إدارة المستخدمين
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-b-xl rounded-tl-xl shadow-sm p-6 border border-gray-200 dark:border-gray-700">

        {/* ── Tab 1: Business Info ─────────────────────────────────────────── */}
        {activeTab === 'business' && (
          <form onSubmit={handleSaveBusiness} className="space-y-5 max-w-2xl">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-2">معلومات النشاط التجاري</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Arabic business name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  اسم النشاط بالعربي
                </label>
                <input
                  type="text"
                  value={businessNameAr}
                  onChange={(e) => setBusinessNameAr(e.target.value)}
                  placeholder="متجر الأمانة"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* English business name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  اسم النشاط بالإنجليزي
                </label>
                <input
                  type="text"
                  value={businessNameEn}
                  onChange={(e) => setBusinessNameEn(e.target.value)}
                  placeholder="Al-Amana Store"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  عنوان المحل
                </label>
                <input
                  type="text"
                  value={businessAddress}
                  onChange={(e) => setBusinessAddress(e.target.value)}
                  placeholder="العنوان"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  تليفون المحل
                </label>
                <input
                  type="text"
                  value={businessPhone}
                  onChange={(e) => setBusinessPhone(e.target.value)}
                  placeholder="01xxxxxxxxx"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                تذييل الفاتورة
              </label>
              <input
                type="text"
                value={invoiceFooterAr}
                onChange={(e) => setInvoiceFooterAr(e.target.value)}
                placeholder="شكراً لتعاملكم معنا"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="border border-gray-200 dark:border-gray-600 rounded-xl p-4 space-y-4 bg-gray-50 dark:bg-gray-900/40">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-white">تسويق أسفل الفاتورة (جالاكسي دجتال)</h3>
              <p className="text-xs text-gray-500">
                سطر صغير تحت تذييل الفاتورة: أيقونة فيسبوك + اسم الشركة + معرّف الصفحة (بدون رابط طويل).
              </p>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={marketingEnabled}
                  onChange={(e) => setMarketingEnabled(e.target.checked)}
                  className="rounded border-gray-300"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">إظهار سطر التسويق على الطباعة</span>
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    اسم الشركة (إنجليزي)
                  </label>
                  <input
                    type="text"
                    value={marketingBrand}
                    onChange={(e) => setMarketingBrand(e.target.value)}
                    placeholder="Galaxy Digital"
                    dir="ltr"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-left"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    فيسبوك — اسم الصفحة
                  </label>
                  <input
                    type="text"
                    value={facebookHandle}
                    onChange={(e) => setFacebookHandle(e.target.value.replace(/\s/g, ''))}
                    placeholder="GalaxyDigitalEG"
                    dir="ltr"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-left font-mono text-sm"
                  />
                  <p className="text-xs text-gray-400 mt-1">facebook.com/{facebookHandle || 'GalaxyDigitalEG'}</p>
                </div>
              </div>
              <div className="flex items-center justify-center gap-2 text-xs text-gray-500 pt-2 border-t border-gray-200 dark:border-gray-600">
                <span className="inline-flex w-4 h-4 rounded-sm bg-[#1877F2] items-center justify-center text-white text-[10px] font-bold">f</span>
                <span>{marketingBrand || 'Galaxy Digital'}</span>
                <span>·</span>
                <span dir="ltr">{facebookHandle || 'GalaxyDigitalEG'}</span>
                <span className="text-gray-400">(معاينة)</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Currency — fixed EGP */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  العملة
                </label>
                <div className="w-full px-3 py-2 border border-emerald-200 dark:border-emerald-700 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-200 font-medium">
                  جنيه مصري (ج.م)
                </div>
              </div>

              {/* Default price type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  نوع السعر الافتراضي
                </label>
                <select
                  value={defaultPriceType}
                  onChange={(e) => setDefaultPriceType(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="RETAIL">مفرد (RETAIL)</option>
                  <option value="WHOLESALE">جملة (WHOLESALE)</option>
                  <option value="SPECIAL">خاص (SPECIAL)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2 rounded-lg border border-gray-200 dark:border-gray-600 p-3 space-y-3">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-white">
                  <input
                    type="checkbox"
                    checked={vatEnabled}
                    onChange={(e) => setVatEnabled(e.target.checked)}
                  />
                  تفعيل ضريبة القيمة المضافة على الفواتير الجديدة
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">نسبة الضريبة (%)</label>
                    <input
                      type="number"
                      value={taxRate}
                      onChange={(e) => setTaxRate(e.target.value)}
                      min="0"
                      max="100"
                      step="0.01"
                      disabled={!vatEnabled}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">نوع الحساب</label>
                    <select
                      value={taxMode}
                      onChange={(e) => setTaxMode(e.target.value as 'INCLUSIVE' | 'EXCLUSIVE')}
                      disabled={!vatEnabled}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 disabled:opacity-50"
                    >
                      <option value="INCLUSIVE">شاملة (مستخرجة من السعر)</option>
                      <option value="EXCLUSIVE">مضافة (تُحسب فوق الصافي)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">بيع بأقل من التكلفة</label>
                    <select
                      value={belowCostPolicy}
                      onChange={(e) => setBelowCostPolicy(e.target.value as 'BLOCK' | 'WARN')}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                    >
                      <option value="WARN">تحذير + تأكيد</option>
                      <option value="BLOCK">منع تمامًا</option>
                    </select>
                  </div>
                </div>
                <p className="text-[11px] text-gray-500">
                  الفواتير القديمة تحتفظ بلقطة الضريبة وقت إنشائها. تغيير الإعداد يُسجَّل في سجل المراجعة.
                </p>
              </div>

              {/* Minimum stock alert toggle */}
              <div className="flex flex-col justify-end">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  تنبيه الحد الأدنى للمخزون
                </label>
                <button
                  type="button"
                  onClick={() => setMinimumStockAlert((v) => (v === 'true' ? 'false' : 'true'))}
                  className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors focus:outline-none ${
                    minimumStockAlert === 'true' ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                  aria-pressed={minimumStockAlert === 'true'}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                      minimumStockAlert === 'true' ? 'translate-x-8' : 'translate-x-1'
                    }`}
                  />
                </button>
                <span className="text-xs text-gray-500 mt-1">
                  {minimumStockAlert === 'true' ? 'مفعّل' : 'معطّل'}
                </span>
              </div>
            </div>

            {businessMsg && (
              <div
                className={`px-4 py-3 rounded-lg text-sm font-medium ${
                  businessMsg.type === 'success'
                    ? 'bg-green-50 text-green-700 border border-green-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}
              >
                {businessMsg.text}
              </div>
            )}

            <button
              type="submit"
              disabled={savingBusiness}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium text-sm"
            >
              {savingBusiness ? 'جار الحفظ...' : 'حفظ الإعدادات'}
            </button>
          </form>
        )}

        {/* ── Tab 2: Exchange Rate — removed for Egypt EGP-only ─────────────── */}

        {/* ── Tab 3: Print Settings ────────────────────────────────────────── */}
        {activeTab === 'print' && (
          <form onSubmit={handleSavePrint} className="space-y-5 max-w-md">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-2">إعدادات الطباعة</h2>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                حجم ورق الطباعة
              </label>
              <div className="flex flex-col gap-3">
                <label className="flex items-center gap-3 cursor-pointer p-3 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
                  <input type="radio" name="paper_width" value="58" checked={paperWidth === '58'}
                    onChange={() => setPaperWidth('58')} className="text-blue-600" />
                  <div>
                    <div className="font-medium text-gray-900 dark:text-white">58 ملم</div>
                    <div className="text-xs text-gray-500">ورق صغير — طابعات الجيب</div>
                  </div>
                </label>
                <label className="flex items-center gap-3 cursor-pointer p-3 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
                  <input type="radio" name="paper_width" value="80" checked={paperWidth === '80'}
                    onChange={() => setPaperWidth('80')} className="text-blue-600" />
                  <div>
                    <div className="font-medium text-gray-900 dark:text-white">80 ملم</div>
                    <div className="text-xs text-gray-500">طابعة حرارية مكتبية</div>
                  </div>
                </label>
                <label className="flex items-center gap-3 cursor-pointer p-3 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
                  <input type="radio" name="paper_width" value="A4" checked={paperWidth === 'A4'}
                    onChange={() => setPaperWidth('A4')} className="text-blue-600" />
                  <div>
                    <div className="font-medium text-gray-900 dark:text-white">A4</div>
                    <div className="text-xs text-gray-500">فاتورة ورق عادي</div>
                  </div>
                </label>
              </div>
            </div>

            {printMsg && (
              <div className={`px-4 py-3 rounded-lg text-sm font-medium ${
                printMsg.type === 'success'
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}>
                {printMsg.text}
              </div>
            )}

            <button type="submit" disabled={savingPrint}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium text-sm">
              {savingPrint ? 'جار الحفظ...' : 'حفظ'}
            </button>
          </form>
        )}

        {activeTab === 'eta' && (
          <form onSubmit={handleSaveEta} className="space-y-5 max-w-2xl">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-2">مصلحة الضرائب — ETA (مصر)</h2>
            <p className="text-sm text-gray-500">
              افتراضياً معطّل — لا يؤثر على البيع. فعّله بعد تسجيل النشاط والحصول على بيانات OAuth.
            </p>
            {!vatEnabled && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 text-amber-900 text-sm px-3 py-2">
                ضريبة القيمة المضافة معطّلة حالياً في إعدادات العمل. إرسال ETA يبقى ممكناً للمستندات
                بدون ضريبة، لكن راجع مطابقة النشاط الضريبي قبل التفعيل.
              </div>
            )}
            {etaQueue && (
              <p className="text-xs text-gray-500">
                في الطابور: {etaQueue.pendingCount} معلّق · {etaQueue.retryCount} إعادة محاولة
              </p>
            )}
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={etaEnabled} onChange={(e) => setEtaEnabled(e.target.checked)} />
              تفعيل إرسال الفواتير للضرائب
            </label>
            <div className="grid md:grid-cols-2 gap-4">
              <label className="text-sm block">
                <span className="block text-xs text-gray-500 mb-1">البيئة</span>
                <select
                  value={etaEnvironment}
                  onChange={(e) => setEtaEnvironment(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 dark:bg-gray-700 dark:border-gray-600"
                >
                  <option value="preprod">preprod (اختبار)</option>
                  <option value="prod">prod (إنتاج)</option>
                </select>
              </label>
              <label className="text-sm block">
                <span className="block text-xs text-gray-500 mb-1">نوع المستند</span>
                <select
                  value={etaDocType}
                  onChange={(e) => setEtaDocType(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 dark:bg-gray-700 dark:border-gray-600"
                >
                  <option value="receipt">إيصال (B2C)</option>
                  <option value="invoice">فاتورة (B2B)</option>
                </select>
              </label>
            </div>
            <label className="text-sm block">
              <span className="block text-xs text-gray-500 mb-1">RIN</span>
              <input value={etaRin} onChange={(e) => setEtaRin(e.target.value)} className="w-full border rounded-lg px-3 py-2 dark:bg-gray-700 dark:border-gray-600" />
            </label>
            <label className="text-sm block">
              <span className="block text-xs text-gray-500 mb-1">رقم سيريال نقطة البيع</span>
              <input value={etaPosSerial} onChange={(e) => setEtaPosSerial(e.target.value)} className="w-full border rounded-lg px-3 py-2 dark:bg-gray-700 dark:border-gray-600" />
            </label>
            <label className="text-sm block">
              <span className="block text-xs text-gray-500 mb-1">Client ID (OAuth)</span>
              <input value={etaClientId} onChange={(e) => setEtaClientId(e.target.value)} className="w-full border rounded-lg px-3 py-2 dark:bg-gray-700 dark:border-gray-600 font-mono text-xs" />
            </label>
            {etaMsg && (
              <div className={`px-4 py-3 rounded-lg text-sm ${etaMsg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {etaMsg.text}
              </div>
            )}
            <button type="submit" disabled={savingEta} className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium">
              {savingEta ? 'جار الحفظ...' : 'حفظ إعدادات ETA'}
            </button>
          </form>
        )}

        {/* ── Backup ───────────────────────────────────────────────────────── */}
        {activeTab === 'business' && (
          <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700 max-w-2xl">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-2">نسخ احتياطي</h2>
            <p className="text-sm text-gray-500 mb-4">
              قاعدة البيانات الحية:{' '}
              <span className="font-mono text-xs">Documents\CASR\data</span>
              <br />
              مجلد النسخ الحالي:{' '}
              <span className="font-mono text-xs break-all" dir="ltr">
                {autoBackupStatus?.directory || backupDirectory || defaultBackupDir}
              </span>
            </p>

            <div className="mb-4 p-3 rounded-lg border border-sky-200 bg-sky-50 dark:bg-sky-900/20 dark:border-sky-800 text-sm text-sky-900 dark:text-sky-100 space-y-2">
              <p className="font-medium">Google Drive Desktop</p>
              {googleDriveInfo?.installed ? (
                <>
                  <p className="text-xs">
                    تم اكتشاف مجلد Drive:{' '}
                    <span className="font-mono" dir="ltr">
                      {(googleDriveInfo.roots || []).slice(0, 2).join(' | ') || '—'}
                    </span>
                    {googleDriveInfo.driveProcessRunning ? ' · المزامنة شغّالة' : ' · تطبيق Drive قد يكون متوقف'}
                  </p>
                  {googleDriveInfo.suggestedBackupDir && (
                    <button
                      type="button"
                      className="px-3 py-1.5 bg-sky-700 text-white rounded-lg text-xs hover:bg-sky-800"
                      onClick={() => setBackupDirectory(googleDriveInfo.suggestedBackupDir || '')}
                    >
                      استخدام مجلد Drive المقترح (CASR-Backups)
                    </button>
                  )}
                </>
              ) : (
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  لم يتم اكتشاف Google Drive Desktop على هذا الجهاز. ثبّته من Google، أو اختر يدوياً مجلداً داخل
                  «My Drive» بعد التثبيت. بدون Drive، الحفظ المحلي يعمل لكن لن تُرفع النسخ للسحابة.
                </p>
              )}
              {(googleDriveInfo?.hints || []).map((h) => (
                <p key={h} className="text-[11px] opacity-90">
                  {h}
                </p>
              ))}
              <p className="text-[11px] border-t border-sky-200/60 pt-2 mt-1">
                النظام بيحفظ النسخة في المجلد ده على القرص، لكن رفعها فعليًا لجوجل درايف بيعتمد على إن تطبيق
                Google Drive شغال ومتصل بالنت على الجهاز ده.
              </p>
            </div>

            <div className="mb-4 p-4 rounded-lg border border-gray-200 dark:border-gray-600 space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-white">
                <input
                  type="checkbox"
                  checked={autoBackupEnabled}
                  onChange={(e) => setAutoBackupEnabled(e.target.checked)}
                />
                نسخ احتياطي تلقائي (كل عدة ساعات)
              </label>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-white">
                <input
                  type="checkbox"
                  checked={backupOnExit}
                  onChange={(e) => setBackupOnExit(e.target.checked)}
                />
                نسخ تلقائي عند إغلاق البرنامج
              </label>
              <div>
                <span className="block text-xs text-gray-500 mb-1">مسار حفظ النسخة</span>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    dir="ltr"
                    value={backupDirectory}
                    onChange={(e) => setBackupDirectory(e.target.value)}
                    placeholder={googleDriveInfo?.suggestedBackupDir || defaultBackupDir}
                    className="flex-1 min-w-[200px] border rounded-lg px-2 py-2 text-sm font-mono dark:bg-gray-800 dark:border-gray-600"
                  />
                  <button
                    type="button"
                    className="px-3 py-2 border rounded-lg text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700"
                    onClick={async () => {
                      const desktop = window.desktop
                      if (desktop?.selectBackupFolder) {
                        const picked = await desktop.selectBackupFolder()
                        if (picked) {
                          setBackupDirectory(picked)
                          setBackupMsg({
                            type: 'success',
                            text: 'تأكد إن المجلد ده جوه Google Drive المتزامن عندك، ثم احفظ الإعدادات.',
                          })
                        }
                      } else {
                        setBackupMsg({
                          type: 'error',
                          text: 'اختيار المجلد متاح من برنامج سطح المكتب. أو الصق مسار My Drive يدوياً.',
                        })
                      }
                    }}
                  >
                    اختيار مجلد…
                  </button>
                  <button
                    type="button"
                    className="px-3 py-2 border rounded-lg text-sm hover:bg-gray-50 dark:border-gray-600"
                    onClick={() => setBackupDirectory('')}
                    title="العودة للافتراضي المحلي"
                  >
                    افتراضي محلي
                  </button>
                </div>
                <p className="text-[11px] text-gray-500 mt-1">
                  الافتراضي المحلي: <span className="font-mono" dir="ltr">{defaultBackupDir}</span>
                  {googleDriveInfo?.suggestedBackupDir && (
                    <>
                      {' '}
                      · مقترح Drive:{' '}
                      <span className="font-mono" dir="ltr">
                        {googleDriveInfo.suggestedBackupDir}
                      </span>
                    </>
                  )}
                </p>
                {(() => {
                  const activeDir =
                    backupDirectory.trim() ||
                    autoBackupStatus?.directory ||
                    googleDriveInfo?.suggestedBackupDir ||
                    ''
                  const isDrivePath =
                    pathLooksLikeGoogleDrive ||
                    /my drive|google drive|googledrive/i.test(activeDir)
                  if (!isDrivePath) return null
                  return (
                    <p className="text-[11px] text-emerald-800 dark:text-emerald-300 mt-2 p-2 rounded-md bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800">
                      موصى به: كل <strong>24 ساعة</strong> مع تفعيل «نسخ عند إغلاق البرنامج» لتقليل
                      الملفات المرفوعة لـ Google Drive. (إرشاد فقط — يمكنك تغيير عدد الساعات كما
                      تشاء.)
                    </p>
                  )
                })()}
                {backupDirectory &&
                  !(
                    pathLooksLikeGoogleDrive ||
                    /my drive|google drive|googledrive/i.test(backupDirectory)
                  ) && (
                  <p className="text-[11px] text-amber-700 mt-1">
                    تنبيه: المسار الحالي لا يبدو داخل Google Drive المتزامن. تأكد إن المجلد جوه «My Drive» لو
                    هدفك المزامنة السحابية.
                  </p>
                )}
                {backupDirectory &&
                  (pathLooksLikeGoogleDrive ||
                    /my drive|google drive|googledrive/i.test(backupDirectory)) && (
                  <p className="text-[11px] text-emerald-700 mt-1">يبدو أن المسار داخل مجلد Google Drive.</p>
                )}
              </div>
              <div>
                <span className="block text-xs text-gray-500 mb-1">مسار نسخة ثانية (فلاشة / مجلد خارجي) — اختياري</span>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    dir="ltr"
                    value={backupDirectorySecondary}
                    onChange={(e) => setBackupDirectorySecondary(e.target.value)}
                    placeholder="مثال: E:\CASR-Backups"
                    className="flex-1 min-w-[200px] border rounded-lg px-2 py-2 text-sm font-mono dark:bg-gray-800 dark:border-gray-600"
                  />
                  <button
                    type="button"
                    className="px-3 py-2 border rounded-lg text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700"
                    onClick={async () => {
                      const desktop = window.desktop
                      if (desktop?.selectBackupFolder) {
                        const picked = await desktop.selectBackupFolder()
                        if (picked) setBackupDirectorySecondary(picked)
                      } else {
                        setBackupMsg({
                          type: 'error',
                          text: 'اختيار المجلد متاح من برنامج سطح المكتب. أو الصق المسار يدوياً.',
                        })
                      }
                    }}
                  >
                    اختيار مجلد…
                  </button>
                  <button
                    type="button"
                    className="px-3 py-2 border rounded-lg text-sm hover:bg-gray-50 dark:border-gray-600"
                    onClick={() => setBackupDirectorySecondary('')}
                  >
                    مسح
                  </button>
                </div>
                <p className="text-[11px] text-gray-500 mt-1">
                  تُنسخ مرآة إضافية عند كل Backup يدوي/تلقائي/خروج. لو الفلاشة مش متوصلة، النسخ الأساسي
                  يكمل والإغلاق لا يتوقف.
                </p>
                {secondaryBackupWarning && (
                  <p className="text-[11px] text-amber-800 dark:text-amber-300 mt-2 p-2 rounded-md bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800">
                    {secondaryBackupWarning}
                  </p>
                )}
                {!backupDirectorySecondary.trim() && !secondaryBackupWarning && (
                  <p className="text-[11px] text-amber-700 mt-1">
                    تنبيه: لم يُضبط مسار النسخة الثانية — يُفضّل فلاشة أو مجلد خارجي كنسخة احتياطية إضافية.
                  </p>
                )}
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="text-sm">
                  <span className="block text-xs text-gray-500 mb-1">كل (ساعات)</span>
                  <input
                    type="number"
                    min={1}
                    max={168}
                    value={autoBackupHours}
                    onChange={(e) => setAutoBackupHours(e.target.value)}
                    className="w-full border rounded-lg px-2 py-2 dark:bg-gray-800 dark:border-gray-600"
                  />
                </label>
                <label className="text-sm">
                  <span className="block text-xs text-gray-500 mb-1">الاحتفاظ بآخر (ملف)</span>
                  <input
                    type="number"
                    min={5}
                    max={200}
                    value={autoBackupKeep}
                    onChange={(e) => setAutoBackupKeep(e.target.value)}
                    className="w-full border rounded-lg px-2 py-2 dark:bg-gray-800 dark:border-gray-600"
                  />
                </label>
              </div>
              <p className="text-xs text-gray-500">
                جدولة التكرار لم تتغير — التعديل على مسار الحفظ فقط. احفظ الإعدادات ثم جرّب «نسخ احتياطي الآن».
              </p>
              <button
                type="button"
                disabled={savingBusiness}
                onClick={async () => {
                  setBackupMsg(null)
                  setSavingBusiness(true)
                  try {
                    await settingsService.update({
                      auto_backup_enabled: autoBackupEnabled ? 'true' : 'false',
                      auto_backup_interval_hours: String(Math.max(1, Math.min(168, Number(autoBackupHours) || 24))),
                      auto_backup_keep_count: String(Math.max(5, Math.min(200, Number(autoBackupKeep) || 30))),
                      backup_directory: backupDirectory.trim(),
                      backup_directory_secondary: backupDirectorySecondary.trim(),
                      backup_on_exit: backupOnExit ? 'true' : 'false',
                    })
                    setBackupMsg({ type: 'success', text: 'تم حفظ إعدادات النسخ الاحتياطي' })
                    await loadBackupList()
                  } catch (err: unknown) {
                    const msg =
                      (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
                      'فشل حفظ إعدادات النسخ'
                    setBackupMsg({ type: 'error', text: msg })
                  } finally {
                    setSavingBusiness(false)
                  }
                }}
                className="px-4 py-2 bg-slate-700 text-white rounded-lg text-sm hover:bg-slate-800 disabled:opacity-50"
              >
                حفظ إعدادات النسخ
              </button>
              {autoBackupStatus?.lastAt && (
                <p className="text-xs text-emerald-700 dark:text-emerald-400">
                  آخر نسخ تلقائي: {new Date(autoBackupStatus.lastAt).toLocaleString('ar-EG')}
                  {autoBackupStatus.nextDueAt && autoBackupEnabled && (
                    <> — التالي تقريباً: {new Date(autoBackupStatus.nextDueAt).toLocaleString('ar-EG')}</>
                  )}
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-3 items-center">
              <button type="button" onClick={handleBackup} disabled={backupLoading}
                className="px-5 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 text-sm font-medium">
                {backupLoading ? 'جار النسخ...' : 'نسخ احتياطي الآن'}
              </button>
              <button type="button" onClick={apiDownloadBackup}
                className="px-5 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700">
                تحميل قاعدة البيانات
              </button>
            </div>
            {backupList.length > 0 && (
              <div className="mt-4">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">النسخ المحفوظة — استعادة</h3>
                <ul className="space-y-2 max-h-48 overflow-y-auto">
                  {backupList.slice(0, 15).map((b) => (
                    <li key={b.name} className="flex items-center justify-between gap-2 text-sm p-2 rounded border border-gray-200 dark:border-gray-600">
                      <span className="truncate" title={b.path}>
                        {b.name}
                        {(b as { kind?: string }).kind === 'auto' && (
                          <span className="text-[10px] text-emerald-600 mr-1"> (تلقائي)</span>
                        )}
                        {(b as { kind?: string }).kind === 'exit' && (
                          <span className="text-[10px] text-sky-600 mr-1"> (عند الإغلاق)</span>
                        )}
                      </span>
                      <button type="button" disabled={restoreLoading}
                        onClick={() => handleRestore(b.name)}
                        className="shrink-0 px-3 py-1 bg-amber-600 text-white rounded text-xs hover:bg-amber-700 disabled:opacity-50">
                        استعادة
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {backupMsg && (
              <div className={`mt-3 px-4 py-3 rounded-lg text-sm whitespace-pre-wrap ${
                backupMsg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
              }`}>
                {backupMsg.text}
              </div>
            )}
            <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 rounded-lg text-sm text-amber-800 dark:text-amber-200">
              مهم: غيّر كلمة مرور المدير من «إدارة المستخدمين» قبل الشغل الفعلي.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
