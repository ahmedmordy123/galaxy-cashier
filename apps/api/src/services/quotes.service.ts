import { Prisma } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'
import { CreateSalesInvoiceInput } from '../validators/sales.validator'
import { prisma } from '../db/prisma'
import {
  computeInclusiveInvoiceTotals,
  parseDiscountType,
  safeDecimal,
} from '../utils/salesTotals'

async function generateQuoteNumberInTx(tx: Prisma.TransactionClient): Promise<string> {
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '')
  const prefix = `QUO-${dateStr}-`
  const startPos = prefix.length + 1
  const result = await tx.$queryRaw<{ max_num: number | null }[]>`
    SELECT MAX(CAST(SUBSTR("invoiceNumber", ${startPos}) AS INTEGER)) AS max_num
    FROM "SalesInvoice"
    WHERE "invoiceNumber" LIKE ${prefix + '%'}
  `
  const maxNum = result[0]?.max_num ? Number(result[0].max_num) : 0
  return `${prefix}${String(maxNum + 1).padStart(4, '0')}`
}

async function getTaxPct(): Promise<Decimal> {
  const row = await prisma.settings.findUnique({ where: { key: 'tax_rate' } })
  const raw = (row?.value ?? '').trim()
  const n = Number(raw)
  return new Decimal(Number.isFinite(n) && raw !== '' ? n : 14)
}

function buildLineData(data: CreateSalesInvoiceInput, taxPct: Decimal) {
  const discountType = parseDiscountType(data.discountType)
  const discountValue = safeDecimal(data.discount ?? 0)
  const lineData = data.items.map((line) => {
    const qty = new Decimal(line.quantity)
    const price = new Decimal(line.unitPrice)
    const discountFactor = new Decimal(1).minus(new Decimal(line.discount ?? 0).div(100))
    return {
      itemId: line.itemId,
      quantity: qty,
      unitPrice: price,
      subtotal: qty.mul(price).mul(discountFactor),
      currency: 'EGP' as const,
    }
  })
  const subtotal = lineData.reduce((acc, l) => acc.plus(l.subtotal), new Decimal(0))
  const { tax, total } = computeInclusiveInvoiceTotals({
    linesSubtotal: subtotal,
    discountType,
    discountValue,
    taxPct,
  })
  return { lineData, subtotal, total, tax, discountType, discountValue }
}

export async function getQuotes(params: { page?: number; limit?: number; search?: string }) {
  const { page = 1, limit = 20, search } = params
  const skip = (page - 1) * limit
  const where: Prisma.SalesInvoiceWhereInput = {
    isActive: true,
    status: 'QUOTE',
    ...(search ? { invoiceNumber: { contains: search } } : {}),
  }
  const [data, total] = await Promise.all([
    prisma.salesInvoice.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
    }),
    prisma.salesInvoice.count({ where }),
  ])
  return { data, total, page, limit }
}

export async function getQuoteById(id: string) {
  return prisma.salesInvoice.findFirst({
    where: { id, isActive: true, status: 'QUOTE' },
    include: {
      customer: true,
      createdBy: { select: { id: true, name: true, username: true } },
      items: {
        include: {
          item: { select: { id: true, name_ar: true, name_en: true, barcode: true } },
        },
      },
    },
  })
}

export async function createQuote(data: CreateSalesInvoiceInput, userId: string) {
  const taxPct = await getTaxPct()
  const { lineData, subtotal, total, tax, discountType, discountValue } = buildLineData(data, taxPct)

  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const invoiceNumber = await generateQuoteNumberInTx(tx)
        return tx.salesInvoice.create({
          data: {
            invoiceNumber,
            customerId: data.customerId ?? null,
            type: 'CASH',
            priceType: data.priceType,
            currency: 'EGP',
            exchangeRate: 1,
            subtotal,
            discountType,
            discount: discountValue,
            tax,
            total,
            balance: 0,
            amountPaid: 0,
            notes: data.notes ?? null,
            status: 'QUOTE',
            createdById: userId,
            items: {
              create: lineData.map((l) => ({
                itemId: l.itemId,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                subtotal: l.subtotal,
                currency: l.currency,
              })),
            },
          },
          include: {
            customer: true,
            items: {
              include: {
                item: { select: { id: true, name_ar: true, name_en: true, barcode: true } },
              },
            },
          },
        })
      })
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code
      if ((code === 'P2002' || code === 'P2034') && attempt < 9) {
        await new Promise((r) => setTimeout(r, Math.random() * 30 + 5))
        continue
      }
      throw e
    }
  }
  throw new Error('Failed to generate unique quote number')
}

export async function convertQuoteToSale(quoteId: string) {
  const quote = await prisma.salesInvoice.findFirst({
    where: { id: quoteId, isActive: true, status: 'QUOTE' },
  })
  if (!quote) throw new Error('QUOTE_NOT_FOUND')

  // Draft sale keeps customerId + notes from the quote
  return prisma.salesInvoice.update({
    where: { id: quoteId },
    data: {
      status: 'DRAFT',
      balance: quote.total,
    },
    include: {
      customer: true,
      items: {
        include: {
          item: { select: { id: true, name_ar: true, name_en: true, barcode: true } },
        },
      },
    },
  })
}

export async function deleteQuote(quoteId: string) {
  const quote = await prisma.salesInvoice.findFirst({
    where: { id: quoteId, isActive: true, status: 'QUOTE' },
  })
  if (!quote) throw new Error('QUOTE_NOT_FOUND')
  return prisma.salesInvoice.update({
    where: { id: quoteId },
    data: { isActive: false },
  })
}
