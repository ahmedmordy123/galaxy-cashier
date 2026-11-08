'use strict'
/**
 * Generate thermal invoice preview PDFs (58mm / 80mm) for RTL review.
 *   node scripts/generate-invoice-preview-pdf.cjs
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'docs')

function thermalCss(paper) {
  const baseFont = paper === '58' ? '11px' : '12px'
  const titleFont = paper === '58' ? '14px' : '16px'
  const totalFont = paper === '58' ? '16px' : '18px'
  return `
    @page { margin: 1.5mm; size: ${paper}mm auto; }
    html, body { margin: 0; padding: 0; background: #fff; }
    .receipt-root {
      direction: rtl;
      unicode-bidi: isolate;
      font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
      font-size: ${baseFont};
      line-height: 1.35;
      color: #000;
      word-wrap: break-word;
      overflow-wrap: anywhere;
      width: ${paper}mm;
      box-sizing: border-box;
      padding: 2mm;
    }
    .receipt-title { font-size: ${titleFont}; font-weight: 700; text-align: center; }
    .receipt-total { font-size: ${totalFont}; font-weight: 800; }
    .receipt-line { display: flex; justify-content: space-between; gap: 4px; }
    .border-d { border-bottom: 1px dashed #999; padding-bottom: 4px; margin-bottom: 4px; }
    .center { text-align: center; }
    .muted { color: #555; font-size: 0.92em; }
  `
}

function buildHtml(paper) {
  const items = [
    { name: 'قميص قطن — مقاس L', qty: 2, unit: 115, sub: 230 },
    { name: 'بنطلون جينز أزرق', qty: 1, unit: 345, sub: 345 },
    { name: 'حزام جلد', qty: 1, unit: 85, sub: 85 },
  ]
  const subtotal = 660
  const tax = 80.88
  const total = 660
  const rows = items
    .map(
      (l) => `
      <div class="border-d">
        <div style="font-weight:600">${l.name}</div>
        <div class="receipt-line muted">
          <span>${l.qty} × ${l.unit.toFixed(2)} ج.م</span>
          <span>${l.sub.toFixed(2)} ج.م</span>
        </div>
      </div>`,
    )
    .join('')

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <style>${thermalCss(paper)}</style>
</head>
<body>
  <div class="receipt-root">
    <div class="center border-d" style="padding-bottom:8px;margin-bottom:8px">
      <div class="receipt-title">Galaxy Cashier — معاينة</div>
      <div class="muted">شارع التحرير، القاهرة</div>
      <div class="muted">ت: 01001234567</div>
      <div style="margin-top:6px;font-weight:600;color:#1e40af">فاتورة مبيعات (${paper}مم)</div>
    </div>
    <div class="muted" style="margin-bottom:8px">
      <div class="receipt-line"><span>رقم الفاتورة</span><span style="font-family:monospace;font-weight:700">INV-PREVIEW-001</span></div>
      <div class="receipt-line"><span>التاريخ</span><span>21/07/2026 14:30</span></div>
      <div class="receipt-line"><span>العميل</span><span>عميل تجريبي</span></div>
      <div class="receipt-line"><span>الدفع</span><span>نقدي</span></div>
    </div>
    ${rows}
    <div style="margin-top:8px">
      <div class="receipt-line"><span class="muted">المجموع الفرعي</span><span>${subtotal.toFixed(2)} ج.م</span></div>
      <div class="receipt-line"><span class="muted">ض.ق.م متضمنة (14%)</span><span>${tax.toFixed(2)} ج.م</span></div>
      <div class="receipt-line receipt-total border-d" style="border-top:2px solid #000;padding-top:6px;margin-top:6px">
        <span>الإجمالي</span>
        <span>${total.toFixed(2)} ج.م</span>
      </div>
      <div class="receipt-line" style="color:#15803d"><span>المبلغ المستلم</span><span>700.00 ج.م</span></div>
      <div class="receipt-line"><span>الباقي</span><span>40.00 ج.م</span></div>
    </div>
    <div class="center muted" style="margin-top:12px;padding-top:8px;border-top:1px dashed #999">
      شكراً لتعاملكم معنا
    </div>
  </div>
</body>
</html>`
}

async function main() {
  let puppeteer
  try {
    puppeteer = require('puppeteer')
  } catch {
    console.error('Installing puppeteer… run: npm install puppeteer --save-dev')
    process.exit(1)
  }
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
  for (const paper of ['58', '80']) {
    const page = await browser.newPage()
    await page.setContent(buildHtml(paper), { waitUntil: 'domcontentloaded' })
    const out = path.join(OUT_DIR, `invoice-preview-${paper}mm.pdf`)
    await page.pdf({
      path: out,
      width: `${paper}mm`,
      printBackground: true,
      margin: { top: '1.5mm', right: '1.5mm', bottom: '1.5mm', left: '1.5mm' },
    })
    await page.close()
    console.log('Wrote', out)
  }
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
