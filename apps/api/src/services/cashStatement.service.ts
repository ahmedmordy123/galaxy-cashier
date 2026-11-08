
import { prisma } from '../db/prisma'
import {
  localDayRange,
  sumNetCashFromPayments,
  sumCreditSalesInvoices,
  sumNetSalesEGP,
} from '../utils/salesAggregates'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DayData {
  openingBalanceEGP: number
  openingBalanceUSD: number
  cashSalesEGP: number
  cashSalesUSD: number
  creditSales: number
  receipts: number
  disbursements: number
  expenses: number
  closingBalanceEGP: number
  closingBalanceUSD: number
}

interface StatementResult extends DayData {
  isClosed: boolean
  date: string
  id?: string
  notes?: string | null
}

// ─── Raw query result types ───────────────────────────────────────────────────

interface RawSalesRow {
  total_sum: string | null
}

interface RawVoucherRow {
  total_iqd: string | null
}

interface RawExpenseRow {
  total_iqd: string | null
}

// ─── calculateDayData ─────────────────────────────────────────────────────────

export async function calculateDayData(date: Date): Promise<DayData> {
  const { start: dayStart, end: dayEnd } = localDayRange(date)

  const previousDay = new Date(date)
  previousDay.setDate(date.getDate() - 1)
  previousDay.setHours(0, 0, 0, 0)

  // Opening balances from previous day's closed statement
  const prevStatement = await prisma.cashStatement.findFirst({
    where: {
      date: {
        gte: previousDay,
        lt: dayStart,
      },
    },
  })

  const openingBalanceEGP = prevStatement ? Number(prevStatement.closingBalanceEGP) : 0
  const openingBalanceUSD = prevStatement ? Number(prevStatement.closingBalanceUSD) : 0

  const { netCash: cashSalesEGP } = await sumNetCashFromPayments(prisma, dayStart, dayEnd)
  const cashSalesUSD = 0

  const creditSales = await sumCreditSalesInvoices(prisma, dayStart, dayEnd)

  // Receipts
  const receiptsRows = await prisma.$queryRaw<RawVoucherRow[]>`
    SELECT CAST(COALESCE(SUM(amount), 0) AS TEXT) AS total_iqd
    FROM "PaymentVoucher"
    WHERE type = 'RECEIPT'
      AND "createdAt" >= ${dayStart}
      AND "createdAt" <= ${dayEnd}
  `
  const receipts = Number(receiptsRows[0]?.total_iqd ?? 0)

  // Disbursements
  const disbursementsRows = await prisma.$queryRaw<RawVoucherRow[]>`
    SELECT CAST(COALESCE(SUM(amount), 0) AS TEXT) AS total_iqd
    FROM "PaymentVoucher"
    WHERE type = 'DISBURSEMENT'
      AND "createdAt" >= ${dayStart}
      AND "createdAt" <= ${dayEnd}
  `
  const disbursements = Number(disbursementsRows[0]?.total_iqd ?? 0)

  // Expenses
  const expensesRows = await prisma.$queryRaw<RawExpenseRow[]>`
    SELECT CAST(COALESCE(SUM(amount), 0) AS TEXT) AS total_iqd
    FROM "Expense"
    WHERE "isActive" = true
      AND date >= ${dayStart}
      AND date <= ${dayEnd}
  `
  const expenses = Number(expensesRows[0]?.total_iqd ?? 0)

  // Closing balances in EGP (openingBalanceEGP / cashSalesEGP / closingBalanceEGP)
  const closingBalanceEGP = openingBalanceEGP + cashSalesEGP + receipts - disbursements - expenses
  const closingBalanceUSD = openingBalanceUSD

  return {
    openingBalanceEGP,
    openingBalanceUSD,
    cashSalesEGP,
    cashSalesUSD,
    creditSales,
    receipts,
    disbursements,
    expenses,
    closingBalanceEGP,
    closingBalanceUSD,
  }
}

// ─── getTodayStatement ────────────────────────────────────────────────────────

export async function getTodayStatement(): Promise<StatementResult> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const saved = await prisma.cashStatement.findFirst({
    where: {
      date: {
        gte: today,
        lt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
      },
    },
  })

  if (saved && saved.isClosed) {
    return {
      id: saved.id,
      isClosed: true,
      date: today.toISOString().slice(0, 10),
      openingBalanceEGP: Number(saved.openingBalanceEGP),
      openingBalanceUSD: Number(saved.openingBalanceUSD),
      cashSalesEGP: Number(saved.cashSalesEGP),
      cashSalesUSD: Number(saved.cashSalesUSD),
      creditSales: Number(saved.creditSales),
      receipts: Number(saved.receipts),
      disbursements: Number(saved.disbursements),
      expenses: Number(saved.expenses),
      closingBalanceEGP: Number(saved.closingBalanceEGP),
      closingBalanceUSD: Number(saved.closingBalanceUSD),
      notes: saved.notes,
    }
  }

  const calculated = await calculateDayData(today)
  return {
    isClosed: false,
    date: today.toISOString().slice(0, 10),
    ...calculated,
  }
}

// ─── getStatementByDate ───────────────────────────────────────────────────────

export async function getStatementByDate(dateStr: string): Promise<StatementResult> {
  const parsed = new Date(dateStr)
  parsed.setHours(0, 0, 0, 0)
  const dayEnd = new Date(parsed.getTime() + 24 * 60 * 60 * 1000)

  const saved = await prisma.cashStatement.findFirst({
    where: {
      date: {
        gte: parsed,
        lt: dayEnd,
      },
    },
  })

  if (saved) {
    return {
      id: saved.id,
      isClosed: saved.isClosed,
      date: dateStr,
      openingBalanceEGP: Number(saved.openingBalanceEGP),
      openingBalanceUSD: Number(saved.openingBalanceUSD),
      cashSalesEGP: Number(saved.cashSalesEGP),
      cashSalesUSD: Number(saved.cashSalesUSD),
      creditSales: Number(saved.creditSales),
      receipts: Number(saved.receipts),
      disbursements: Number(saved.disbursements),
      expenses: Number(saved.expenses),
      closingBalanceEGP: Number(saved.closingBalanceEGP),
      closingBalanceUSD: Number(saved.closingBalanceUSD),
      notes: saved.notes,
    }
  }

  const calculated = await calculateDayData(parsed)
  return {
    isClosed: false,
    date: dateStr,
    ...calculated,
  }
}

// ─── closeStatement ───────────────────────────────────────────────────────────

export async function closeStatement(notes?: string) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const calculated = await calculateDayData(today)

  const saved = await prisma.cashStatement.upsert({
    where: { date: today },
    create: {
      date: today,
      openingBalanceEGP: calculated.openingBalanceEGP,
      openingBalanceUSD: calculated.openingBalanceUSD,
      cashSalesEGP: calculated.cashSalesEGP,
      cashSalesUSD: calculated.cashSalesUSD,
      creditSales: calculated.creditSales,
      receipts: calculated.receipts,
      disbursements: calculated.disbursements,
      expenses: calculated.expenses,
      closingBalanceEGP: calculated.closingBalanceEGP,
      closingBalanceUSD: calculated.closingBalanceUSD,
      isClosed: true,
      notes: notes ?? null,
    },
    update: {
      openingBalanceEGP: calculated.openingBalanceEGP,
      openingBalanceUSD: calculated.openingBalanceUSD,
      cashSalesEGP: calculated.cashSalesEGP,
      cashSalesUSD: calculated.cashSalesUSD,
      creditSales: calculated.creditSales,
      receipts: calculated.receipts,
      disbursements: calculated.disbursements,
      expenses: calculated.expenses,
      closingBalanceEGP: calculated.closingBalanceEGP,
      closingBalanceUSD: calculated.closingBalanceUSD,
      isClosed: true,
      notes: notes ?? null,
    },
  })

  return {
    id: saved.id,
    isClosed: saved.isClosed,
    date: today.toISOString().slice(0, 10),
    openingBalanceEGP: Number(saved.openingBalanceEGP),
    openingBalanceUSD: Number(saved.openingBalanceUSD),
    cashSalesEGP: Number(saved.cashSalesEGP),
    cashSalesUSD: Number(saved.cashSalesUSD),
    creditSales: Number(saved.creditSales),
    receipts: Number(saved.receipts),
    disbursements: Number(saved.disbursements),
    expenses: Number(saved.expenses),
    closingBalanceEGP: Number(saved.closingBalanceEGP),
    closingBalanceUSD: Number(saved.closingBalanceUSD),
    notes: saved.notes,
  }
}

// ─── getStatementRange ────────────────────────────────────────────────────────

export async function getStatementRange(from: string, to: string) {
  return prisma.cashStatement.findMany({
    where: {
      date: {
        gte: new Date(from),
        lte: new Date(to),
      },
    },
    orderBy: { date: 'desc' },
  })
}
