import { Prisma } from '@ims-pro/db'
import { prisma } from '../db/prisma'
import {
  localDayRange,
  sumNetCashFromPayments,
  sumNetSalesEGP,
} from '../utils/salesAggregates'

// ─── Date helpers ──────────────────────────────────────────────────────────────

function startOfDay(dateStr: string): Date {
  const d = new Date(dateStr)
  d.setHours(0, 0, 0, 0)
  return d
}

function endOfDay(dateStr: string): Date {
  const d = new Date(dateStr)
  d.setHours(23, 59, 59, 999)
  return d
}

// ─── Today Summary ─────────────────────────────────────────────────────────────

export async function getTodaySummary() {
  const now = new Date()
  const { start: todayStart, end: todayEnd } = localDayRange(now)

  const [netCash, netSalesUnified, todaysSalesInvoices, returnedTodayInvoices, expenses] = await Promise.all([
    sumNetCashFromPayments(prisma, todayStart, todayEnd),
    sumNetSalesEGP(prisma, todayStart, todayEnd),
    prisma.salesInvoice.findMany({
      where: {
        isActive: true,
        status: { in: ['CONFIRMED', 'RETURNED'] },
        createdAt: { gte: todayStart, lte: todayEnd },
      },
      select: {
        status: true,
        total: true,
        items: { select: { quantity: true, unitCost: true, subtotal: true } },
      },
    }),
    prisma.salesInvoice.findMany({
      where: {
        isActive: true,
        status: 'RETURNED',
        updatedAt: { gte: todayStart, lte: todayEnd },
      },
      select: {
        total: true,
        createdAt: true,
        items: { select: { quantity: true, unitCost: true } },
      },
    }),
    prisma.expense.findMany({
      where: {
        isActive: true,
        date: { gte: todayStart, lte: todayEnd },
      },
      select: { amount: true },
    }),
  ])

  const confirmedInvoices = todaysSalesInvoices.filter((inv) => inv.status === 'CONFIRMED')
  const returnedInvoices = returnedTodayInvoices

  const salesTotalEGP = todaysSalesInvoices.reduce((s, inv) => s + Number(inv.total), 0)
  const returnsTotalEGP = returnedInvoices.reduce((s, inv) => s + Number(inv.total), 0)
  const expensesTotalEGP = expenses.reduce((s, e) => s + Number(e.amount), 0)

  const cogsSales = confirmedInvoices.reduce(
    (s, inv) =>
      s +
      inv.items.reduce(
        (ls, line) => ls + Number(line.quantity) * Number(line.unitCost),
        0
      ),
    0
  )
  // Same-day full returns leave status=RETURNED so they are already excluded from
  // cogsSales / confirmed revenue. Only reverse COGS for returns of *prior-day*
  // invoices (matching sumNetSalesEGP prior-day REFUND handling).
  const cogsPriorDayReturns = returnedInvoices.reduce((s, inv) => {
    if (inv.createdAt >= todayStart) return s
    return (
      s +
      inv.items.reduce(
        (ls, line) => ls + Number(line.quantity) * Number(line.unitCost),
        0,
      )
    )
  }, 0)
  const cogsTotalEGP = Math.max(0, cogsSales - cogsPriorDayReturns)

  const netSalesEGP = netSalesUnified
  const grossProfitEGP = netSalesEGP - cogsTotalEGP
  const netProfitEGP = grossProfitEGP - expensesTotalEGP

  const last7Days: number[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(todayStart)
    d.setDate(d.getDate() - i)
    const { start, end } = localDayRange(d)
    last7Days.push(await sumNetSalesEGP(prisma, start, end))
  }

  return {
    date: todayStart.toISOString().slice(0, 10),
    salesCount: confirmedInvoices.length,
    invoiceCount: confirmedInvoices.length,
    salesTotalEGP,
    returnsCount: returnedInvoices.length,
    returnsTotalEGP,
    netSalesEGP,
    cashSalesEGP: netCash.netCash,
    cashRefundsEGP: netCash.cashRefunds,
    cogsTotalEGP,
    grossProfitEGP,
    expensesTotalEGP,
    netProfitEGP,
    last7Days,
  }
}

// ─── Sales Report ──────────────────────────────────────────────────────────────

export async function getSalesReport(params: {
  from: string
  to: string
  customerId?: string
  status?: string
}) {
  const { from, to, customerId, status } = params
  const rangeStart = startOfDay(from)
  const rangeEnd = endOfDay(to)

  const where: Record<string, unknown> = {
    isActive: true,
    status: status ?? 'CONFIRMED',
    createdAt: {
      gte: rangeStart,
      lte: rangeEnd,
    },
  }

  if (customerId) where.customerId = customerId

  const invoices = await prisma.salesInvoice.findMany({
    where: where as Prisma.SalesInvoiceWhereInput,
    orderBy: { createdAt: 'desc' },
    include: {
      customer: { select: { id: true, name: true } },
      _count: { select: { items: true } },
    },
  })

  const netCash =
    !status || status === 'CONFIRMED'
      ? await sumNetCashFromPayments(prisma, rangeStart, rangeEnd)
      : { netCash: 0, cashIn: 0, cashRefunds: 0 }

  let creditSalesEGP = 0
  let totalEGP = 0

  for (const inv of invoices) {
    const total = Number(inv.total)
    totalEGP += total
    if (inv.type === 'CREDIT') {
      creditSalesEGP += total
    }
  }

  const cashSalesEGP = netCash.netCash

  return {
    invoices,
    summary: {
      totalInvoices: invoices.length,
      cashSalesEGP,
      cashSalesUSD: 0,
      creditSalesEGP,
      creditSalesUSD: 0,
      totalEGP,
      netSalesEGP: await sumNetSalesEGP(prisma, rangeStart, rangeEnd),
      cashRefundsEGP: netCash.cashRefunds,
    },
  }
}

// ─── Purchases Report ──────────────────────────────────────────────────────────

export async function getPurchasesReport(params: {
  from: string
  to: string
  supplierId?: string
}) {
  const { from, to, supplierId } = params

  const where: Record<string, unknown> = {
    isActive: true,
    status: 'CONFIRMED',
    createdAt: {
      gte: startOfDay(from),
      lte: endOfDay(to),
    },
  }

  if (supplierId) where.supplierId = supplierId

  const invoices = await prisma.purchaseInvoice.findMany({
    where: where as Prisma.PurchaseInvoiceWhereInput,
    orderBy: { createdAt: 'desc' },
    include: {
      supplier: { select: { id: true, name: true } },
    },
  })

  let totalEGP = 0
  const totalUSD = 0

  for (const inv of invoices) {
    totalEGP += Number(inv.total)
  }

  return {
    invoices,
    summary: {
      totalInvoices: invoices.length,
      totalEGP,
      totalUSD,
    },
  }
}

// ─── Profit Report ─────────────────────────────────────────────────────────────

export async function getProfitReport(params: { from: string; to: string }) {
  const { from, to } = params

  // Confirmed invoices in range — revenue must match sales report (invoice.total
  // after invoice-level discount), not raw line subtotals.
  const invoices = await prisma.salesInvoice.findMany({
    where: {
      isActive: true,
      status: 'CONFIRMED',
      createdAt: {
        gte: startOfDay(from),
        lte: endOfDay(to),
      },
    },
    include: {
      items: {
        include: {
          item: {
            select: {
              id: true,
              name_ar: true,
              name_en: true,
              costPrice: true,
            },
          },
        },
      },
    },
  })

  // Group by itemId — allocate invoice.total across lines by subtotal share
  const grouped: Record<
    string,
    {
      itemId: string
      nameAr: string
      nameEn: string
      quantitySold: number
      revenue: number
      costOfGoods: number
      originalRevenue: number
    }
  > = {}

  for (const inv of invoices) {
    // Profit uses net-of-tax (excludes VAT). Prefer snapshot netOfTax.
    const invNet = Number(
      (inv as { netOfTax?: unknown }).netOfTax != null &&
        Number((inv as { netOfTax?: unknown }).netOfTax) > 0
        ? (inv as { netOfTax: unknown }).netOfTax
        : Number(inv.total) - Number(inv.tax || 0),
    )
    const linesSub = inv.items.reduce((s, li) => s + Number(li.subtotal), 0)
    const scale = linesSub > 0 ? invNet / linesSub : 1

    for (const si of inv.items) {
      const { itemId } = si
      const qty = Number(si.quantity)
      const revenueEGP = Number(si.subtotal) * scale
      const unitCost = Number((si as { unitCost?: unknown }).unitCost ?? si.item.costPrice)
      const originalUnitPrice = Number(
        (si as { originalUnitPrice?: unknown }).originalUnitPrice ?? si.unitPrice,
      )
      const unitPrice = Number(si.unitPrice)
      const cogForLine = qty * unitCost

      if (!grouped[itemId]) {
        grouped[itemId] = {
          itemId,
          nameAr: si.item.name_ar,
          nameEn: si.item.name_en,
          quantitySold: 0,
          revenue: 0,
          costOfGoods: 0,
          originalRevenue: 0,
        }
      }
      grouped[itemId].quantitySold += qty
      grouped[itemId].revenue += revenueEGP
      grouped[itemId].costOfGoods += cogForLine
      grouped[itemId].originalRevenue += originalUnitPrice * qty * scale
      void unitPrice
    }
  }

  const items = Object.values(grouped).map((g) => ({
    ...g,
    grossProfit: g.revenue - g.costOfGoods,
  }))

  const totalRevenue = invoices.reduce((s, inv) => {
    const net = Number((inv as { netOfTax?: unknown }).netOfTax)
    if (Number.isFinite(net) && net > 0) return s + net
    return s + (Number(inv.total) - Number(inv.tax || 0))
  }, 0)
  const totalCostOfGoods = items.reduce((s, i) => s + i.costOfGoods, 0)
  const totalGrossProfit = totalRevenue - totalCostOfGoods

  // Sum expenses in range (legacy USD rows may use exchangeRate; EGP as-is)
  const expenses = await prisma.expense.findMany({
    where: {
      isActive: true,
      date: {
        gte: startOfDay(from),
        lte: endOfDay(to),
      },
    },
    select: { amount: true, currency: true, exchangeRate: true },
  })

  const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount), 0)

  const netProfit = totalGrossProfit - totalExpenses

  return {
    items,
    summary: {
      totalRevenue,
      totalCostOfGoods,
      totalGrossProfit,
      totalExpenses,
      netProfit,
    },
  }
}

// ─── Inventory Report ──────────────────────────────────────────────────────────

export async function getInventoryReport() {
  const dbItems = await prisma.item.findMany({
    where: { isActive: true },
    include: {
      category: { select: { name_ar: true } },
    },
    orderBy: { name_ar: 'asc' },
  })

  const LOW_STOCK_THRESHOLD = 5

  const items = dbItems.map((item) => {
    const stockQty = Number(item.stockQty)
    const costPrice = Number(item.costPrice)
    const retailPrice = Number(item.retailPrice)
    return {
      id: item.id,
      nameAr: item.name_ar,
      nameEn: item.name_en,
      barcode: item.barcode ?? null,
      stockQty,
      costPrice,
      retailPrice,
      minimumStock: Number(item.minimumStock),
      costValue: stockQty * costPrice,
      retailValue: stockQty * retailPrice,
      category: item.category?.name_ar ?? '',
    }
  })

  const totalCostValue = items.reduce((s, i) => s + i.costValue, 0)
  const totalRetailValue = items.reduce((s, i) => s + i.retailValue, 0)
  const lowStockCount = items.filter(
    (i) => i.stockQty <= (i.minimumStock > 0 ? i.minimumStock : LOW_STOCK_THRESHOLD)
  ).length

  return {
    items,
    summary: {
      totalItems: items.length,
      totalCostValue,
      totalRetailValue,
      lowStockCount,
    },
  }
}

// ─── Product Movement (top sellers + slow movers) ─────────────────────────────

export async function getProductMovementReport(params: {
  from: string
  to: string
  slowDays?: number
  limit?: number
}) {
  const { from, to, slowDays = 30, limit = 10 } = params
  const periodStart = startOfDay(from)
  const periodEnd = endOfDay(to)
  const slowCutoff = new Date()
  slowCutoff.setDate(slowCutoff.getDate() - slowDays)
  slowCutoff.setHours(0, 0, 0, 0)

  const salesInPeriod = await prisma.salesInvoiceItem.findMany({
    where: {
      invoice: {
        isActive: true,
        status: 'CONFIRMED',
        createdAt: { gte: periodStart, lte: periodEnd },
      },
    },
    include: {
      item: {
        select: {
          id: true,
          name_ar: true,
          name_en: true,
          barcode: true,
          retailPrice: true,
          stockQty: true,
          category: { select: { name_ar: true } },
        },
      },
      invoice: { select: { createdAt: true } },
    },
  })

  type PeriodAgg = {
    itemId: string
    nameAr: string
    nameEn: string
    barcode: string | null
    category: string
    stockQty: number
    retailPrice: number
    quantitySold: number
    revenue: number
    invoiceCount: number
  }

  const periodMap: Record<string, PeriodAgg> = {}
  for (const row of salesInPeriod) {
    const id = row.itemId
    if (!periodMap[id]) {
      periodMap[id] = {
        itemId: id,
        nameAr: row.item.name_ar,
        nameEn: row.item.name_en,
        barcode: row.item.barcode,
        category: row.item.category?.name_ar ?? '',
        stockQty: Number(row.item.stockQty),
        retailPrice: Number(row.item.retailPrice),
        quantitySold: 0,
        revenue: 0,
        invoiceCount: 0,
      }
    }
    periodMap[id].quantitySold += Number(row.quantity)
    periodMap[id].revenue += Number(row.subtotal)
    periodMap[id].invoiceCount += 1
  }

  const topSelling = Object.values(periodMap)
    .sort((a, b) => b.quantitySold - a.quantitySold || b.revenue - a.revenue)
    .slice(0, limit)

  // Last sale date per item (all time, confirmed)
  const allSalesLines = await prisma.salesInvoiceItem.findMany({
    where: {
      invoice: { isActive: true, status: 'CONFIRMED' },
    },
    select: {
      itemId: true,
      invoice: { select: { createdAt: true } },
    },
  })

  const lastSaleByItem: Record<string, Date> = {}
  for (const line of allSalesLines) {
    const d = line.invoice.createdAt
    if (!lastSaleByItem[line.itemId] || d > lastSaleByItem[line.itemId]) {
      lastSaleByItem[line.itemId] = d
    }
  }

  const stockedItems = await prisma.item.findMany({
    where: { isActive: true, stockQty: { gt: 0 } },
    include: { category: { select: { name_ar: true } } },
    orderBy: { name_ar: 'asc' },
  })

  const slowMoving = stockedItems
    .map((item) => {
      const lastSale = lastSaleByItem[item.id] ?? null
      const daysSinceSale = lastSale
        ? Math.floor((Date.now() - lastSale.getTime()) / (1000 * 60 * 60 * 24))
        : null
      const soldInPeriod = periodMap[item.id]?.quantitySold ?? 0
      return {
        itemId: item.id,
        nameAr: item.name_ar,
        nameEn: item.name_en,
        barcode: item.barcode,
        category: item.category?.name_ar ?? '',
        stockQty: Number(item.stockQty),
        retailPrice: Number(item.retailPrice),
        stockValue: Number(item.stockQty) * Number(item.retailPrice),
        lastSaleAt: lastSale?.toISOString() ?? null,
        daysSinceSale,
        soldInPeriod,
        status: lastSale === null ? 'NEVER_SOLD' as const : daysSinceSale! >= slowDays ? 'STALE' as const : 'OK' as const,
      }
    })
    .filter((i) => i.status === 'NEVER_SOLD' || i.status === 'STALE')
    .sort((a, b) => {
      if (a.daysSinceSale === null && b.daysSinceSale === null) return b.stockValue - a.stockValue
      if (a.daysSinceSale === null) return -1
      if (b.daysSinceSale === null) return 1
      return b.daysSinceSale - a.daysSinceSale || b.stockValue - a.stockValue
    })
    .slice(0, limit)

  const notSoldInPeriod = stockedItems
    .filter((item) => !periodMap[item.id])
    .map((item) => ({
      itemId: item.id,
      nameAr: item.name_ar,
      nameEn: item.name_en,
      barcode: item.barcode,
      category: item.category?.name_ar ?? '',
      stockQty: Number(item.stockQty),
      retailPrice: Number(item.retailPrice),
      stockValue: Number(item.stockQty) * Number(item.retailPrice),
      lastSaleAt: lastSaleByItem[item.id]?.toISOString() ?? null,
    }))
    .sort((a, b) => b.stockValue - a.stockValue)
    .slice(0, limit)

  return {
    period: { from, to, slowDays },
    topSelling,
    slowMoving,
    notSoldInPeriod,
    summary: {
      itemsSoldInPeriod: topSelling.length,
      totalUnitsSold: topSelling.reduce((s, i) => s + i.quantitySold, 0),
      slowCount: slowMoving.length,
      notSoldInPeriodCount: notSoldInPeriod.length,
    },
  }
}

// ─── Customer Statement ────────────────────────────────────────────────────────

export async function getCustomerStatement(params: {
  customerId: string
  from?: string
  to?: string
}) {
  const { customerId, from, to } = params

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, isActive: true },
  })
  if (!customer) throw new Error('CUSTOMER_NOT_FOUND')

  const dateFilter: Record<string, Date> = {}
  if (from) dateFilter.gte = startOfDay(from)
  if (to) dateFilter.lte = endOfDay(to)
  const hasDateFilter = Object.keys(dateFilter).length > 0

  // CREDIT sales invoices
  const invoicesWhere: Record<string, unknown> = {
    customerId,
    type: 'CREDIT',
    status: 'CONFIRMED',
    isActive: true,
  }
  if (hasDateFilter) invoicesWhere.createdAt = dateFilter

  const salesInvoices = await prisma.salesInvoice.findMany({
    where: invoicesWhere as Prisma.SalesInvoiceWhereInput,
    select: {
      id: true,
      invoiceNumber: true,
      total: true,
      currency: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  // RECEIPT vouchers for this customer
  const vouchersWhere: Record<string, unknown> = {
    type: 'RECEIPT',
    entityType: 'CUSTOMER',
    entityId: customerId,
  }
  if (hasDateFilter) vouchersWhere.createdAt = dateFilter

  const receipts = await prisma.paymentVoucher.findMany({
    where: vouchersWhere as Prisma.PaymentVoucherWhereInput,
    select: {
      id: true,
      voucherNumber: true,
      amount: true,
      currency: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  type TxRow = {
    date: string
    type: 'INVOICE' | 'RECEIPT'
    reference: string
    amount: number
    currency: string
    balanceEffect: number
  }

  const transactions: TxRow[] = [
    ...salesInvoices.map((inv): TxRow => ({
      date: inv.createdAt.toISOString(),
      type: 'INVOICE',
      reference: inv.invoiceNumber,
      amount: Number(inv.total),
      currency: inv.currency,
      balanceEffect: Number(inv.total), // increases debt
    })),
    ...receipts.map((v): TxRow => ({
      date: v.createdAt.toISOString(),
      type: 'RECEIPT',
      reference: v.voucherNumber,
      amount: Number(v.amount),
      currency: v.currency,
      balanceEffect: -Number(v.amount), // decreases debt
    })),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  const totalInvoiced = salesInvoices.reduce((s, i) => s + Number(i.total), 0)
  const totalPaid = receipts.reduce((s, v) => s + Number(v.amount), 0)
  const currentBalance = Number(customer.balance)

  return {
    customer,
    transactions,
    summary: {
      totalInvoiced,
      totalPaid,
      currentBalance,
    },
  }
}

// ─── Supplier Statement ────────────────────────────────────────────────────────

export async function getSupplierStatement(params: {
  supplierId: string
  from?: string
  to?: string
}) {
  const { supplierId, from, to } = params

  const supplier = await prisma.supplier.findFirst({
    where: { id: supplierId, isActive: true },
  })
  if (!supplier) throw new Error('SUPPLIER_NOT_FOUND')

  const dateFilter: Record<string, Date> = {}
  if (from) dateFilter.gte = startOfDay(from)
  if (to) dateFilter.lte = endOfDay(to)
  const hasDateFilter = Object.keys(dateFilter).length > 0

  // Confirmed purchase invoices
  const purchasesWhere: Record<string, unknown> = {
    supplierId,
    status: 'CONFIRMED',
    isActive: true,
  }
  if (hasDateFilter) purchasesWhere.createdAt = dateFilter

  const purchaseInvoices = await prisma.purchaseInvoice.findMany({
    where: purchasesWhere as Prisma.PurchaseInvoiceWhereInput,
    select: {
      id: true,
      invoiceNumber: true,
      total: true,
      currency: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  // DISBURSEMENT vouchers for this supplier
  const vouchersWhere: Record<string, unknown> = {
    type: 'DISBURSEMENT',
    entityType: 'SUPPLIER',
    entityId: supplierId,
  }
  if (hasDateFilter) vouchersWhere.createdAt = dateFilter

  const disbursements = await prisma.paymentVoucher.findMany({
    where: vouchersWhere as Prisma.PaymentVoucherWhereInput,
    select: {
      id: true,
      voucherNumber: true,
      amount: true,
      currency: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  type TxRow = {
    date: string
    type: 'INVOICE' | 'RECEIPT'
    reference: string
    amount: number
    currency: string
    balanceEffect: number
  }

  const transactions: TxRow[] = [
    ...purchaseInvoices.map((inv): TxRow => ({
      date: inv.createdAt.toISOString(),
      type: 'INVOICE',
      reference: inv.invoiceNumber,
      amount: Number(inv.total),
      currency: inv.currency,
      balanceEffect: Number(inv.total), // increases what we owe
    })),
    ...disbursements.map((v): TxRow => ({
      date: v.createdAt.toISOString(),
      type: 'RECEIPT',
      reference: v.voucherNumber,
      amount: Number(v.amount),
      currency: v.currency,
      balanceEffect: -Number(v.amount), // decreases what we owe
    })),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  const totalInvoiced = purchaseInvoices.reduce((s, i) => s + Number(i.total), 0)
  const totalPaid = disbursements.reduce((s, v) => s + Number(v.amount), 0)
  const currentBalance = Number(supplier.balance)

  return {
    supplier,
    transactions,
    summary: {
      totalInvoiced,
      totalPaid,
      currentBalance,
    },
  }
}

function localDayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function daysInclusive(from: string, to: string): number {
  const a = startOfDay(from).getTime()
  const b = startOfDay(to).getTime()
  return Math.max(1, Math.round((b - a) / 86400000) + 1)
}

export async function getExpenseAnalysis(params: { from: string; to: string }) {
  const { from, to } = params
  const start = startOfDay(from)
  const end = endOfDay(to)
  const expenses = await prisma.expense.findMany({
    where: { isActive: true, date: { gte: start, lte: end } },
    include: { category: true },
    orderBy: { date: 'asc' },
  })

  const byCategory: Record<string, {
    categoryId: string
    categoryNameAr: string
    categoryNameEn: string
    totalEGP: number
    count: number
  }> = {}
  const byDay: Record<string, number> = {}
  let totalEGP = 0

  for (const e of expenses) {
    const amount = Number(e.amount)
    totalEGP += amount
    const catId = e.categoryId
    if (!byCategory[catId]) {
      byCategory[catId] = {
        categoryId: catId,
        categoryNameAr: e.category.name_ar,
        categoryNameEn: e.category.name_en,
        totalEGP: 0,
        count: 0,
      }
    }
    byCategory[catId].totalEGP += amount
    byCategory[catId].count += 1
    const day = localDayKey(e.date)
    byDay[day] = (byDay[day] ?? 0) + amount
  }

  const dayCount = daysInclusive(from, to)
  const daily = Object.entries(byDay)
    .map(([date, total]) => ({ date, total }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return {
    from,
    to,
    summary: {
      totalEGP,
      count: expenses.length,
      dayCount,
      dailyAverage: totalEGP / dayCount,
    },
    byCategory: Object.values(byCategory).sort((a, b) => b.totalEGP - a.totalEGP),
    daily,
  }
}

function addDelta(map: Map<string, number>, itemId: string, n: number) {
  map.set(itemId, (map.get(itemId) ?? 0) + n)
}

export async function getInventoryAsOf(date: string) {
  const asOfEnd = endOfDay(date)
  const dbItems = await prisma.item.findMany({
    where: { isActive: true },
    include: { category: { select: { name_ar: true } } },
    orderBy: { name_ar: 'asc' },
  })

  const deltaAfter = new Map<string, number>()

  const salesAfter = await prisma.salesInvoiceItem.findMany({
    where: {
      invoice: { isActive: true, status: 'CONFIRMED', createdAt: { gt: asOfEnd } },
    },
    select: { itemId: true, quantity: true },
  })
  for (const l of salesAfter) addDelta(deltaAfter, l.itemId, -Number(l.quantity))

  const returnsAfter = await prisma.salesInvoiceItem.findMany({
    where: {
      invoice: {
        isActive: true,
        status: 'RETURNED',
        updatedAt: { gt: asOfEnd },
        createdAt: { lte: asOfEnd },
      },
    },
    select: { itemId: true, quantity: true },
  })
  for (const l of returnsAfter) addDelta(deltaAfter, l.itemId, Number(l.quantity))

  const purchAfter = await prisma.purchaseInvoiceItem.findMany({
    where: {
      invoice: { isActive: true, status: 'CONFIRMED', createdAt: { gt: asOfEnd } },
    },
    select: { itemId: true, quantity: true },
  })
  for (const l of purchAfter) addDelta(deltaAfter, l.itemId, Number(l.quantity))

  const purchRetAfter = await prisma.purchaseInvoiceItem.findMany({
    where: {
      invoice: {
        isActive: true,
        status: 'RETURNED',
        updatedAt: { gt: asOfEnd },
        createdAt: { lte: asOfEnd },
      },
    },
    select: { itemId: true, quantity: true },
  })
  for (const l of purchRetAfter) addDelta(deltaAfter, l.itemId, -Number(l.quantity))

  const transfersAfter = await prisma.stockTransfer.findMany({
    where: { createdAt: { gt: asOfEnd } },
    select: { itemId: true, quantity: true, type: true },
  })
  for (const t of transfersAfter) {
    const q = Number(t.quantity)
    addDelta(deltaAfter, t.itemId, t.type === 'IN' ? q : -q)
  }

  const items = dbItems.map((item) => {
    const currentQty = Number(item.stockQty)
    const asOfQty = currentQty - (deltaAfter.get(item.id) ?? 0)
    const costPrice = Number(item.costPrice)
    const retailPrice = Number(item.retailPrice)
    return {
      id: item.id,
      nameAr: item.name_ar,
      nameEn: item.name_en,
      barcode: item.barcode ?? null,
      currentQty,
      asOfQty,
      costPrice,
      retailPrice,
      costValue: asOfQty * costPrice,
      retailValue: asOfQty * retailPrice,
      category: item.category?.name_ar ?? '',
    }
  })

  const totalCostValue = items.reduce((s, i) => s + i.costValue, 0)
  const totalRetailValue = items.reduce((s, i) => s + i.retailValue, 0)

  return {
    date,
    items,
    summary: {
      totalItems: items.length,
      totalCostValue,
      totalRetailValue,
      totalQty: items.reduce((s, i) => s + i.asOfQty, 0),
    },
  }
}

export interface PeriodMetrics {
  netSales: number
  invoiceCount: number
  expenses: number
  grossProfit: number
}

async function getPeriodMetrics(from: string, to: string): Promise<PeriodMetrics> {
  const start = startOfDay(from)
  const end = endOfDay(to)
  const [netSales, invoiceCount, expenseAgg, profit] = await Promise.all([
    sumNetSalesEGP(prisma, start, end),
    prisma.salesInvoice.count({
      where: { isActive: true, status: 'CONFIRMED', createdAt: { gte: start, lte: end } },
    }),
    prisma.expense.aggregate({
      where: { isActive: true, date: { gte: start, lte: end } },
      _sum: { amount: true },
    }),
    getProfitReport({ from, to }),
  ])
  return {
    netSales,
    invoiceCount,
    expenses: Number(expenseAgg._sum.amount ?? 0),
    grossProfit: profit.summary.totalGrossProfit,
  }
}

function metricDiff(a: number, b: number) {
  const abs = a - b
  const pct = b === 0 ? (a === 0 ? 0 : 100) : (abs / b) * 100
  return { a, b, abs, pct }
}

export async function getPeriodCompare(params: {
  fromA: string
  toA: string
  fromB: string
  toB: string
}) {
  const [periodA, periodB] = await Promise.all([
    getPeriodMetrics(params.fromA, params.toA),
    getPeriodMetrics(params.fromB, params.toB),
  ])
  return {
    periodA: { from: params.fromA, to: params.toA, ...periodA },
    periodB: { from: params.fromB, to: params.toB, ...periodB },
    diff: {
      netSales: metricDiff(periodA.netSales, periodB.netSales),
      invoiceCount: metricDiff(periodA.invoiceCount, periodB.invoiceCount),
      expenses: metricDiff(periodA.expenses, periodB.expenses),
      grossProfit: metricDiff(periodA.grossProfit, periodB.grossProfit),
    },
  }
}
