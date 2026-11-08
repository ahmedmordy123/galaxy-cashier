import { PrismaClient } from '@ims-pro/db'

export function localDayRange(date: Date): { start: Date; end: Date } {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  const end = new Date(date)
  end.setHours(23, 59, 59, 999)
  return { start, end }
}

export function localDayRangeFromIso(dateStr: string): { start: Date; end: Date } {
  const d = new Date(dateStr)
  d.setHours(0, 0, 0, 0)
  const end = new Date(d)
  end.setHours(23, 59, 59, 999)
  return { start: d, end }
}

interface RawSumRow {
  total_sum: string | null
}

/** Net cash from register: CASH payments in − REFUND payments out (by payment `createdAt`). */
export async function sumNetCashFromPayments(
  prisma: PrismaClient,
  start: Date,
  end: Date,
): Promise<{ cashIn: number; cashRefunds: number; netCash: number }> {
  const cashInRows = await prisma.$queryRaw<RawSumRow[]>`
    SELECT CAST(COALESCE(SUM(p.amount), 0) AS TEXT) AS total_sum
    FROM "SalesPayment" p
    INNER JOIN "SalesInvoice" i ON i.id = p."invoiceId"
    WHERE p.method = 'CASH'
      AND i.status IN ('CONFIRMED', 'RETURNED')
      AND i."isActive" = true
      AND p."createdAt" >= ${start}
      AND p."createdAt" <= ${end}
  `
  const refundRows = await prisma.$queryRaw<RawSumRow[]>`
    SELECT CAST(COALESCE(SUM(p.amount), 0) AS TEXT) AS total_sum
    FROM "SalesPayment" p
    INNER JOIN "SalesInvoice" i ON i.id = p."invoiceId"
    WHERE p.method = 'REFUND'
      AND i."isActive" = true
      AND p."createdAt" >= ${start}
      AND p."createdAt" <= ${end}
  `
  const cashIn = Number(cashInRows[0]?.total_sum ?? 0)
  const cashRefunds = Number(refundRows[0]?.total_sum ?? 0)
  return { cashIn, cashRefunds, netCash: Math.max(0, cashIn - cashRefunds) }
}

/** Credit sales total (invoice `createdAt` in range, CONFIRMED). */
export async function sumCreditSalesInvoices(prisma: PrismaClient, start: Date, end: Date): Promise<number> {
  const rows = await prisma.$queryRaw<RawSumRow[]>`
    SELECT CAST(COALESCE(SUM(total), 0) AS TEXT) AS total_sum
    FROM "SalesInvoice"
    WHERE type = 'CREDIT'
      AND status = 'CONFIRMED'
      AND "isActive" = true
      AND "createdAt" >= ${start}
      AND "createdAt" <= ${end}
  `
  return Number(rows[0]?.total_sum ?? 0)
}

/**
 * Net sales for a calendar day (local device time):
 * − CONFIRMED invoice totals created that day (partial returns already in `total`)
 * − REFUND payments that day **only** for invoices created before this day (returns on prior sales)
 */
export async function sumNetSalesEGP(prisma: PrismaClient, start: Date, end: Date): Promise<number> {
  const confirmedRows = await prisma.$queryRaw<RawSumRow[]>`
    SELECT CAST(COALESCE(SUM(total), 0) AS TEXT) AS total_sum
    FROM "SalesInvoice"
    WHERE status = 'CONFIRMED'
      AND "isActive" = true
      AND "createdAt" >= ${start}
      AND "createdAt" <= ${end}
  `
  const refundRows = await prisma.$queryRaw<RawSumRow[]>`
    SELECT CAST(COALESCE(SUM(p.amount), 0) AS TEXT) AS total_sum
    FROM "SalesPayment" p
    INNER JOIN "SalesInvoice" i ON i.id = p."invoiceId"
    WHERE p.method = 'REFUND'
      AND i."isActive" = true
      AND p."createdAt" >= ${start}
      AND p."createdAt" <= ${end}
      AND i."createdAt" < ${start}
  `
  const confirmed = Number(confirmedRows[0]?.total_sum ?? 0)
  const priorDayRefunds = Number(refundRows[0]?.total_sum ?? 0)
  return Math.max(0, confirmed - priorDayRefunds)
}
