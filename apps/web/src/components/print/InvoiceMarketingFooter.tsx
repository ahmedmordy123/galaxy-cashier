/** إعدادات تسويق أسفل الفاتورة — أيقونة فيسبوك + اسم + معرّف الصفحة */

export function marketingFromSettings(settings: Record<string, string>) {
  const enabled = settings.invoice_marketing_enabled !== 'false'
  const brand = (settings.invoice_marketing_brand || 'Galaxy Digital').trim()
  const handle = (settings.invoice_facebook_handle || 'GalaxyDigitalEG').trim()
  return { enabled, brand, handle }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const FB_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12" fill="#fff"><path d="M13.5 9.5V7.75c0-.69.56-1.25 1.25-1.25H16V4h-1.65C12.28 4 11 5.48 11 7.25V9.5H9v2.25h2V20h2.5v-8.25h2.13l.37-2.25H13.5z"/></svg>`

export function marketingFooterHtml(settings: Record<string, string>): string {
  const { enabled, brand, handle } = marketingFromSettings(settings)
  if (!enabled || !handle) return ''
  return `<div style="margin-top:10px;padding-top:8px;border-top:1px solid #e5e7eb;text-align:center;font-size:10px;color:#6b7280;-webkit-print-color-adjust:exact;print-color-adjust:exact">
    <span style="display:inline-flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap">
      <span style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;background:#1877F2;border-radius:3px">${FB_ICON_SVG}</span>
      <span style="font-weight:600;color:#374151">${escapeHtml(brand)}</span>
      <span>·</span>
      <span dir="ltr" style="font-family:Segoe UI,sans-serif">${escapeHtml(handle)}</span>
    </span>
  </div>`
}

function FacebookIcon() {
  return (
    <span
      className="inline-flex items-center justify-center w-4 h-4 rounded-sm bg-[#1877F2] text-white flex-shrink-0 print:bg-[#1877F2]"
      style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="w-3 h-3 fill-current" aria-hidden>
        <path d="M13.5 9.5V7.75c0-.69.56-1.25 1.25-1.25H16V4h-1.65C12.28 4 11 5.48 11 7.25V9.5H9v2.25h2V20h2.5v-8.25h2.13l.37-2.25H13.5z" />
      </svg>
    </span>
  )
}

export function InvoiceMarketingFooter({ settings }: { settings: Record<string, string> }) {
  const { enabled, brand, handle } = marketingFromSettings(settings)
  if (!enabled || !handle) return null

  return (
    <div
      className="mt-3 pt-3 border-t border-gray-200 text-center text-[11px] text-gray-500"
      style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
    >
      <div className="flex items-center justify-center gap-1.5 flex-wrap">
        <FacebookIcon />
        <span className="font-medium text-gray-600">{brand}</span>
        <span aria-hidden>·</span>
        <span dir="ltr" className="font-mono text-[10px]">{handle}</span>
      </div>
    </div>
  )
}
