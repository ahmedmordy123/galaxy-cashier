
import { prisma } from '../db/prisma'

export interface ShiftCashBreakdown {
  openingCash: number
  cashIn: number
  cashRefunds: number
  receipts: number
  disbursements: number
  expenses: number
  staffAdvances: number
  expectedCash: number
}

export async function computeShiftCashBreakdown(
  shift: { id: string; userId: string; openedAt: Date; closedAt: Date | null; openingCash: unknown },
): Promise<ShiftCashBreakdown> {
  const end = shift.closedAt ?? new Date()
  const openingCash = Number(shift.openingCash)

  const invoices = await prisma.salesInvoice.findMany({
    where: { shiftId: shift.id, status: 'CONFIRMED', isActive: true },
    include: { payments: true },
  })

  let cashIn = 0
  let cashRefunds = 0
  for (const inv of invoices) {
    for (const p of inv.payments) {
      if (p.method === 'CASH') cashIn += Number(p.amount)
      if (p.method === 'REFUND') cashRefunds += Number(p.amount)
    }
  }

  const vouchers = await prisma.paymentVoucher.findMany({
    where: {
      createdById: shift.userId,
      createdAt: { gte: shift.openedAt, lte: end },
    },
    select: { type: true, amount: true },
  })

  let receipts = 0
  let disbursements = 0
  for (const v of vouchers) {
    if (v.type === 'RECEIPT') receipts += Number(v.amount)
    if (v.type === 'DISBURSEMENT') disbursements += Number(v.amount)
  }

  const expenseAgg = await prisma.expense.aggregate({
    where: {
      createdById: shift.userId,
      isActive: true,
      createdAt: { gte: shift.openedAt, lte: end },
    },
    _sum: { amount: true },
  })
  const expenses = Number(expenseAgg._sum.amount ?? 0)

  const advanceAgg = await prisma.staffAdvance.aggregate({
    where: { shiftId: shift.id, isActive: true },
    _sum: { amount: true },
  })
  const staffAdvances = Number(advanceAgg._sum.amount ?? 0)

  const expectedCash =
    openingCash + cashIn - cashRefunds + receipts - disbursements - expenses - staffAdvances

  return {
    openingCash,
    cashIn,
    cashRefunds,
    receipts,
    disbursements,
    expenses,
    staffAdvances,
    expectedCash,
  }
}

export async function openShift(userId: string, openingCash: number) {
  const existing = await prisma.cashierShift.findFirst({
    where: { userId, status: 'OPEN' },
  })
  if (existing) throw new Error('SHIFT_ALREADY_OPEN')
  return prisma.cashierShift.create({
    data: { userId, openingCash, status: 'OPEN' },
  })
}

export async function closeShift(userId: string, closingCash: number, notes?: string) {
  const shift = await prisma.cashierShift.findFirst({
    where: { userId, status: 'OPEN' },
    orderBy: { openedAt: 'desc' },
  })
  if (!shift) throw new Error('NO_OPEN_SHIFT')

  const breakdown = await computeShiftCashBreakdown(shift)

  const updated = await prisma.cashierShift.update({
    where: { id: shift.id },
    data: {
      status: 'CLOSED',
      closedAt: new Date(),
      closingCash,
      expectedCash: breakdown.expectedCash,
      shiftCashIn: breakdown.cashIn,
      shiftCashRefunds: breakdown.cashRefunds,
      shiftReceipts: breakdown.receipts,
      shiftDisbursements: breakdown.disbursements,
      shiftExpenses: breakdown.expenses,
      shiftStaffAdvances: breakdown.staffAdvances,
      notes: notes || null,
    },
  })

  // Best-effort shift-close backup + prune to keep last N auto/manual copies.
  try {
    const { createDatabaseBackup, getAutoBackupConfig, pruneOldBackups } = await import(
      './backup.service'
    )
    await createDatabaseBackup('auto')
    const cfg = await getAutoBackupConfig()
    await pruneOldBackups(cfg.keepCount)
  } catch {
    /* never block shift close on backup failure */
  }

  return {
    ...updated,
    cashBreakdown: breakdown,
    cashDifference: closingCash - breakdown.expectedCash,
  }
}

export async function currentShift(userId: string) {
  return prisma.cashierShift.findFirst({
    where: { userId, status: 'OPEN' },
    orderBy: { openedAt: 'desc' },
  })
}

/** Sales tied to an open shift (what the cashier sees on the register). */
export async function getShiftSummary(shiftId: string) {
  const shift = await prisma.cashierShift.findUnique({ where: { id: shiftId } })
  if (!shift) throw new Error('SHIFT_NOT_FOUND')

  const invoices = await prisma.salesInvoice.findMany({
    where: { shiftId, status: 'CONFIRMED', isActive: true },
    select: {
      total: true,
      type: true,
      payments: { select: { method: true, amount: true } },
    },
  })

  let cashSales = 0
  let creditSales = 0
  for (const inv of invoices) {
    if (inv.type === 'CREDIT') {
      creditSales += Number(inv.total)
      continue
    }
    let cashFromPayments = 0
    for (const p of inv.payments) {
      if (p.method === 'CASH') cashFromPayments += Number(p.amount)
    }
    cashSales += cashFromPayments > 0 ? cashFromPayments : Number(inv.total)
  }

  const breakdown = await computeShiftCashBreakdown(shift)

  return {
    shiftId: shift.id,
    salesCount: invoices.length,
    cashSales,
    creditSales,
    totalSales: cashSales + creditSales,
    openingCash: breakdown.openingCash,
    expectedCash: breakdown.expectedCash,
    staffAdvances: breakdown.staffAdvances,
    cashBreakdown: breakdown,
    openedAt: shift.openedAt,
  }
}

export async function listShifts(limit = 30) {
  return prisma.cashierShift.findMany({
    include: { user: { select: { id: true, name: true, username: true } } },
    orderBy: { openedAt: 'desc' },
    take: limit,
  })
}
