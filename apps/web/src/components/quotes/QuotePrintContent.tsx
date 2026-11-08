'use client'

import { marketingFooterHtml } from '@/components/print/InvoiceMarketingFooter'

export interface QuotePrintLine {
  nameAr: string
  barcode?: string
  quantity: number
  unitPrice: number
  lineTotal: number
}

export interface QuotePrintData {
  quoteNumber?: string
  createdAt?: string
  customerName?: string
  customerPhone?: string
  businessNameAr?: string
  businessPhone?: string
  businessAddress?: string
  lines: QuotePrintLine[]
  subtotal: number
  discountPct: number
  discountAmount: number
  taxPct: number
  taxAmount: number
  total: number
  notes?: string
  validDays?: number
  marketingSettings?: Record<string, string>
}

function fmt(n: number): string {
  return n.toLocaleString('ar-EG', { maximumFractionDigits: 2 })
}

export function openQuotePrintWindow(data: QuotePrintData) {
  const w = window.open('', '_blank', 'width=900,height=700')
  if (!w) return

  const rows = data.lines.map((line, i) => `
    <tr>
      <td style="border:1px solid #ddd;padding:6px;text-align:center">${i + 1}</td>
      <td style="border:1px solid #ddd;padding:6px">${line.nameAr}${line.barcode ? `<br><small>${line.barcode}</small>` : ''}</td>
      <td style="border:1px solid #ddd;padding:6px;text-align:center">${fmt(line.quantity)}</td>
      <td style="border:1px solid #ddd;padding:6px;text-align:center">${fmt(line.unitPrice)}</td>
      <td style="border:1px solid #ddd;padding:6px;text-align:center;font-weight:600">${fmt(line.lineTotal)}</td>
    </tr>`).join('')

  const validUntil = new Date()
  validUntil.setDate(validUntil.getDate() + (data.validDays ?? 7))

  const marketingHtml = marketingFooterHtml(data.marketingSettings ?? {})

  w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>عرض سعر</title>
  <style>
    body{font-family:'Segoe UI',Tahoma,sans-serif;margin:0;padding:20px;color:#111}
    @media print{.no-print{display:none!important}@page{margin:10mm;size:A4}}
    table{border-collapse:collapse;width:100%;font-size:13px}
    th{background:#f1f5f9;border:1px solid #ddd;padding:8px}
  </style></head><body>
  <div class="no-print" style="margin-bottom:16px">
    <button onclick="window.print()" style="padding:8px 16px;background:#2563eb;color:#fff;border:none;border-radius:8px;cursor:pointer;margin-left:8px">طباعة</button>
    <button onclick="window.close()" style="padding:8px 16px;border:1px solid #ccc;border-radius:8px;cursor:pointer">إغلاق</button>
  </div>
  <div style="text-align:center;border-bottom:2px solid #1e293b;padding-bottom:16px;margin-bottom:20px">
    <h1 style="margin:0;font-size:22px">${data.businessNameAr || '—'}</h1>
    ${data.businessAddress ? `<p style="margin:4px 0;color:#666;font-size:13px">${data.businessAddress}</p>` : ''}
    ${data.businessPhone ? `<p style="margin:0;color:#666;font-size:13px">ت: ${data.businessPhone}</p>` : ''}
    <h2 style="margin:12px 0 0;color:#1e40af">عرض سعر</h2>
    <p style="margin:4px 0;font-size:11px;color:#888">ليس فاتورة بيع</p>
  </div>
  <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:20px">
    <div>
      ${data.quoteNumber ? `<div><b>رقم العرض:</b> ${data.quoteNumber}</div>` : ''}
      <div><b>التاريخ:</b> ${new Date(data.createdAt || Date.now()).toLocaleString('ar-EG')}</div>
      <div><b>صالح حتى:</b> ${validUntil.toLocaleDateString('ar-EG')}</div>
    </div>
    <div style="text-align:left">
      <div><b>العميل:</b> ${data.customerName || '—'}</div>
      ${data.customerPhone ? `<div><b>الهاتف:</b> ${data.customerPhone}</div>` : ''}
    </div>
  </div>
  <table><thead><tr>
    <th>#</th><th>الصنف</th><th>الكمية</th><th>السعر (ج.م)</th><th>الإجمالي (ج.م)</th>
  </tr></thead><tbody>${rows}</tbody></table>
  <div style="margin-top:20px;max-width:280px;margin-right:auto;font-size:13px">
    <div style="display:flex;justify-content:space-between;padding:4px 0"><span>المجموع</span><span>${fmt(data.subtotal)} ج.م</span></div>
    ${data.discountPct > 0 ? `<div style="display:flex;justify-content:space-between;padding:4px 0;color:#dc2626"><span>خصم (${data.discountPct}%)</span><span>- ${fmt(data.discountAmount)} ج.م</span></div>` : ''}
    ${data.taxPct > 0 ? `<div style="display:flex;justify-content:space-between;padding:4px 0"><span>ض.ق.م (${data.taxPct}%)</span><span>${fmt(data.taxAmount)} ج.م</span></div>` : ''}
    <div style="display:flex;justify-content:space-between;padding:8px 0;font-size:18px;font-weight:bold;border-top:2px solid #333;margin-top:8px"><span>الإجمالي</span><span style="color:#1e40af">${fmt(data.total)} ج.م</span></div>
  </div>
  ${data.notes ? `<p style="margin-top:24px;font-size:13px;color:#666"><b>ملاحظات:</b> ${data.notes}</p>` : ''}
  <p style="margin-top:32px;text-align:center;font-size:11px;color:#888;border-top:1px solid #eee;padding-top:16px">
    هذا عرض سعر للاطلاع فقط — الأسعار قابلة للتغيير.<br>شكراً لتعاملكم معنا.
  </p>
  ${marketingHtml}
  </body></html>`)
  w.document.close()
}
