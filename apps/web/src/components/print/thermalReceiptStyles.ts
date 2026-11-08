/** Shared thermal receipt print styles (58mm / 80mm) — RTL-safe */
export function thermalPrintCss(paper: '58' | '80' | 'A4') {
  const isThermal = paper === '58' || paper === '80'
  const pageSize = isThermal ? `${paper}mm auto` : 'A4'
  const margin = isThermal ? '1.5mm' : '8mm'
  const baseFont = isThermal ? (paper === '58' ? '11px' : '12px') : '14px'
  const titleFont = isThermal ? (paper === '58' ? '14px' : '16px') : '24px'
  const totalFont = isThermal ? (paper === '58' ? '16px' : '18px') : '20px'

  return `
    @media print {
      html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
      .no-print { display: none !important; }
      @page { margin: ${margin}; size: ${pageSize}; }
    }
    .receipt-root {
      direction: rtl;
      unicode-bidi: isolate;
      font-family: 'Segoe UI', Tahoma, 'Arial', sans-serif;
      font-size: ${baseFont};
      line-height: 1.35;
      color: #000;
      word-wrap: break-word;
      overflow-wrap: anywhere;
    }
    .receipt-root .receipt-title { font-size: ${titleFont}; font-weight: 700; text-align: center; }
    .receipt-root .receipt-total { font-size: ${totalFont}; font-weight: 800; }
    .receipt-root .receipt-line { display: flex; justify-content: space-between; gap: 4px; }
    .receipt-root .receipt-items { width: 100%; border-collapse: collapse; }
    .receipt-root .receipt-items th,
    .receipt-root .receipt-items td {
      border-bottom: 1px dashed #999;
      padding: 2px 0;
      text-align: right;
      vertical-align: top;
    }
    .receipt-root.thermal-narrow .item-name { max-width: ${paper === '58' ? '22mm' : '32mm'}; }
  `
}

export function resolvePaper(settings: Record<string, string>, queryPaper?: string | null) {
  const p = queryPaper || settings.paper_width || 'A4'
  if (p === '58' || p === '80') return p
  return 'A4'
}
