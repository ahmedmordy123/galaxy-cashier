
import { prisma } from '../db/prisma'

export async function salesAnalysis(params: {
  from?: string
  to?: string
  groupBy?: 'item' | 'customer' | 'cashier' | 'day' | 'month' | 'warehouse'
}) {
  const from = params.from ? new Date(params.from) : new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const to = params.to ? new Date(params.to) : new Date()
  to.setHours(23, 59, 59, 999)

  const invoices = await prisma.salesInvoice.findMany({
    where: {
      status: 'CONFIRMED',
      isActive: true,
      createdAt: { gte: from, lte: to },
    },
    include: {
      items: { include: { item: true } },
      customer: true,
      createdBy: true,
      warehouse: true,
    },
  })

  type Row = {
    key: string
    label: string
    qty: number
    revenue: number
    cost: number
    profit: number
    invoices: number
  }
  const map = new Map<string, Row>()

  function bump(key: string, label: string, qty: number, revenue: number, cost: number) {
    const cur = map.get(key) || { key, label, qty: 0, revenue: 0, cost: 0, profit: 0, invoices: 0 }
    cur.qty += qty
    cur.revenue += revenue
    cur.cost += cost
    cur.profit = cur.revenue - cur.cost
    map.set(key, cur)
  }

  const groupBy = params.groupBy || 'item'
  const invoiceIds = new Set<string>()

  for (const inv of invoices) {
    invoiceIds.add(inv.id)
    for (const line of inv.items) {
      const qty = Number(line.quantity)
      const revenue = Number(line.subtotal)
      const cost = qty * Number(line.unitCost)
      if (groupBy === 'item') {
        bump(line.itemId, line.item.name_ar, qty, revenue, cost)
      } else if (groupBy === 'customer') {
        const key = inv.customerId || 'walkin'
        bump(key, inv.customer?.name || 'نقدي / زبون عابر', qty, revenue, cost)
      } else if (groupBy === 'cashier') {
        bump(inv.createdById, inv.createdBy.name, qty, revenue, cost)
      } else if (groupBy === 'warehouse') {
        const key = inv.warehouseId || 'none'
        bump(key, inv.warehouse?.name || 'غير محدد', qty, revenue, cost)
      } else if (groupBy === 'day') {
        const d = inv.createdAt.toISOString().slice(0, 10)
        bump(d, d, qty, revenue, cost)
      } else if (groupBy === 'month') {
        const m = inv.createdAt.toISOString().slice(0, 7)
        bump(m, m, qty, revenue, cost)
      }
    }
  }

  // Count invoices per group roughly
  for (const inv of invoices) {
    let key = ''
    if (groupBy === 'customer') key = inv.customerId || 'walkin'
    else if (groupBy === 'cashier') key = inv.createdById
    else if (groupBy === 'warehouse') key = inv.warehouseId || 'none'
    else if (groupBy === 'day') key = inv.createdAt.toISOString().slice(0, 10)
    else if (groupBy === 'month') key = inv.createdAt.toISOString().slice(0, 7)
    if (key && map.has(key)) map.get(key)!.invoices += 1
  }

  const rows = Array.from(map.values()).sort((a, b) => b.revenue - a.revenue)
  const totals = rows.reduce(
    (a, r) => ({
      revenue: a.revenue + r.revenue,
      cost: a.cost + r.cost,
      profit: a.profit + r.profit,
      qty: a.qty + r.qty,
    }),
    { revenue: 0, cost: 0, profit: 0, qty: 0 }
  )

  return {
    groupBy,
    from: from.toISOString(),
    to: to.toISOString(),
    invoiceCount: invoiceIds.size,
    totals: { ...totals, margin: totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : 0 },
    rows,
  }
}

export async function invoiceProfitability(invoiceId: string) {
  const inv = await prisma.salesInvoice.findFirst({
    where: { id: invoiceId, isActive: true },
    include: { items: { include: { item: true } }, payments: true },
  })
  if (!inv) return null
  const lines = inv.items.map((l) => {
    const qty = Number(l.quantity)
    const revenue = Number(l.subtotal)
    const cost = qty * Number(l.unitCost)
    return {
      itemId: l.itemId,
      name: l.item.name_ar,
      qty,
      unitPrice: Number(l.unitPrice),
      unitCost: Number(l.unitCost),
      revenue,
      cost,
      profit: revenue - cost,
    }
  })
  const revenue = lines.reduce((s, l) => s + l.revenue, 0)
  const cost = lines.reduce((s, l) => s + l.cost, 0)
  return {
    invoiceNumber: inv.invoiceNumber,
    status: inv.status,
    total: Number(inv.total),
    revenue,
    cost,
    profit: revenue - cost,
    lines,
  }
}
