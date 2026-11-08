/**
 * Dry-run: compare stored customer.balance vs computed ledger (NO writes).
 * Usage: node scripts/dry-run-customer-balance.cjs [path-to-cashier.db]
 */
const path = require('path')
const fs = require('fs')

const ROOT = path.join(__dirname, '..')
const defaultDb = path.join(
  process.env.USERPROFILE || process.env.HOME || '',
  'Documents',
  'CASR',
  'data',
  'cashier.db',
)
const dbPath = process.argv[2] || defaultDb
if (!fs.existsSync(dbPath)) {
  console.error('DB not found:', dbPath)
  process.exit(1)
}

process.env.DATABASE_URL = 'file:' + dbPath.replace(/\\/g, '/')

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient({
  datasources: { db: { url: 'file:' + dbPath.replace(/\\/g, '/') } },
})
const EPS = 0.01

async function computeCustomerBalance(customerId) {
  const [invoiceAgg, receiptAgg] = await Promise.all([
    prisma.salesInvoice.aggregate({
      where: {
        customerId,
        type: 'CREDIT',
        status: 'CONFIRMED',
        isActive: true,
      },
      _sum: { total: true },
    }),
    prisma.paymentVoucher.aggregate({
      where: {
        entityType: 'CUSTOMER',
        entityId: customerId,
        type: 'RECEIPT',
      },
      _sum: { amount: true },
    }),
  ])
  return Number(invoiceAgg._sum.total ?? 0) - Number(receiptAgg._sum.amount ?? 0)
}

async function main() {
  const customers = await prisma.customer.findMany({
    where: { isActive: true },
    select: { id: true, name: true, phone: true, balance: true, type: true },
    orderBy: { name: 'asc' },
  })

  const all = []
  const drifts = []

  for (const c of customers) {
    const creditInvoices = await prisma.salesInvoice.findMany({
      where: {
        customerId: c.id,
        type: 'CREDIT',
        status: 'CONFIRMED',
        isActive: true,
      },
      select: { invoiceNumber: true, total: true, amountPaid: true },
    })
    const receipts = await prisma.paymentVoucher.findMany({
      where: {
        entityType: 'CUSTOMER',
        entityId: c.id,
        type: 'RECEIPT',
      },
      select: { voucherNumber: true, amount: true },
    })
    const disbursements = await prisma.paymentVoucher.findMany({
      where: {
        entityType: 'CUSTOMER',
        entityId: c.id,
        type: 'DISBURSEMENT',
      },
      select: { voucherNumber: true, amount: true },
    })

    const computed = await computeCustomerBalance(c.id)
    const stored = Number(c.balance)
    const difference = Math.round((stored - computed) * 100) / 100
    const creditTotal = creditInvoices.reduce((s, i) => s + Number(i.total), 0)
    const receiptTotal = receipts.reduce((s, v) => s + Number(v.amount), 0)
    const disburseTotal = disbursements.reduce((s, v) => s + Number(v.amount), 0)

    const row = {
      customerId: c.id,
      name: c.name,
      phone: c.phone || '—',
      type: c.type,
      storedBalance: stored,
      computedBalance: computed,
      difference,
      inSync: Math.abs(difference) <= EPS,
      detail: {
        creditInvoicesCount: creditInvoices.length,
        creditInvoicesTotal: creditTotal,
        receiptsCount: receipts.length,
        receiptsTotal: receiptTotal,
        disbursementsCount: disbursements.length,
        disbursementsTotal: disburseTotal,
        note:
          disburseTotal > 0
            ? 'DISBURSEMENT موجود لكن صيغة compute الحالية لا تضيفه (total CREDIT − RECEIPT فقط)'
            : null,
        invoices: creditInvoices.map((i) => ({
          no: i.invoiceNumber,
          total: Number(i.total),
          paid: Number(i.amountPaid),
        })),
        receipts: receipts.map((v) => ({
          no: v.voucherNumber,
          amount: Number(v.amount),
        })),
      },
    }
    all.push(row)
    if (!row.inSync) drifts.push(row)
  }

  const report = {
    mode: 'DRY_RUN',
    appliedChanges: false,
    dbPath,
    scannedAt: new Date().toISOString(),
    formula: 'computed = SUM(CREDIT CONFIRMED total) − SUM(CUSTOMER RECEIPT vouchers)',
    epsilon: EPS,
    summary: {
      totalActiveCustomers: all.length,
      inSync: all.length - drifts.length,
      outOfSync: drifts.length,
      totalStoredBalance: all.reduce((s, r) => s + r.storedBalance, 0),
      totalComputedBalance: all.reduce((s, r) => s + r.computedBalance, 0),
      netDrift: all.reduce((s, r) => s + r.difference, 0),
    },
    drifts,
    allCustomers: all,
  }

  const outDir = path.join(ROOT, 'docs')
  const outFile = path.join(outDir, 'CUSTOMER-BALANCE-DRY-RUN.md')
  const lines = [
    '# Dry Run — فروق رصيد العملاء',
    '',
    `**الوضع:** قراءة فقط — **لم تُطبَّق أي تسوية**`,
    `**قاعدة البيانات:** \`${dbPath}\``,
    `**وقت الفحص:** ${report.scannedAt}`,
    `**الصيغة:** \`${report.formula}\``,
    '',
    '## الملخص',
    '',
    `| المؤشر | القيمة |`,
    `|--------|--------|`,
    `| عملاء نشطون | ${report.summary.totalActiveCustomers} |`,
    `| متطابقون | ${report.summary.inSync} |`,
    `| فيهم فرق | **${report.summary.outOfSync}** |`,
    `| مجموع المخزّن | ${report.summary.totalStoredBalance.toFixed(2)} ج.م |`,
    `| مجموع المحسوب | ${report.summary.totalComputedBalance.toFixed(2)} ج.م |`,
    `| صافي الفرق (مخزّن − محسوب) | ${report.summary.netDrift.toFixed(2)} ج.م |`,
    '',
  ]

  if (drifts.length === 0) {
    lines.push('## النتيجة')
    lines.push('')
    lines.push('**لا توجد فروق** — كل الأرصدة المخزّنة مطابقة للحساب من الفواتير الآجلة − سندات القبض.')
  } else {
    lines.push('## العملاء بفرق (يحتاج قرار تسوية)')
    lines.push('')
    lines.push('| العميل | الهاتف | المخزّن | المحسوب | الفرق | فواتير آجلة | سندات قبض |')
    lines.push('|--------|--------|---------|---------|-------|-------------|-----------|')
    for (const d of drifts) {
      lines.push(
        `| ${d.name} | ${d.phone} | ${d.storedBalance.toFixed(2)} | ${d.computedBalance.toFixed(2)} | **${d.difference.toFixed(2)}** | ${d.detail.creditInvoicesCount} / ${d.detail.creditInvoicesTotal.toFixed(2)} | ${d.detail.receiptsCount} / ${d.detail.receiptsTotal.toFixed(2)} |`,
      )
    }
    lines.push('')
    lines.push('### تفصيل')
    for (const d of drifts) {
      lines.push('')
      lines.push(`#### ${d.name}`)
      lines.push(`- id: \`${d.customerId}\``)
      if (d.detail.invoices.length) {
        lines.push('- فواتير CREDIT CONFIRMED:')
        for (const i of d.detail.invoices) {
          lines.push(`  - ${i.no}: total=${i.total} paid=${i.paid}`)
        }
      } else {
        lines.push('- لا فواتير آجلة مؤكدة')
      }
      if (d.detail.receipts.length) {
        lines.push('- سندات قبض:')
        for (const v of d.detail.receipts) {
          lines.push(`  - ${v.no}: ${v.amount}`)
        }
      }
      if (d.detail.note) lines.push(`- ملاحظة: ${d.detail.note}`)
    }
  }

  lines.push('')
  lines.push('## كل العملاء (مرجع)')
  lines.push('')
  lines.push('| العميل | المخزّن | المحسوب | الفرق | حالة |')
  lines.push('|--------|---------|---------|-------|------|')
  for (const r of all) {
    lines.push(
      `| ${r.name} | ${r.storedBalance.toFixed(2)} | ${r.computedBalance.toFixed(2)} | ${r.difference.toFixed(2)} | ${r.inSync ? '✅' : '❌'} |`,
    )
  }
  lines.push('')
  lines.push('---')
  lines.push('لتطبيق التسوية لاحقاً (بعد موافقتك): `POST /api/customers/:id/reconcile` أو سكربت منفصل — **هذا الملف dry-run فقط**.')
  lines.push('')

  fs.writeFileSync(outFile, lines.join('\n'), 'utf8')
  console.log(JSON.stringify({ ok: true, outFile, summary: report.summary, driftsCount: drifts.length }, null, 2))
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
