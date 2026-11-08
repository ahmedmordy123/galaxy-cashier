import { Prisma } from '@prisma/client'
import { CreatePurchaseInvoiceInput } from '../validators/purchase.validator'
import { ensureDefaultWarehouse, stockIn, stockOut } from './stock-ops.service'
import { prisma } from '../db/prisma'

// ─── Invoice Number Generator ─────────────────────────────────────────────────

async function generatePurchaseNumberInTx(tx: Prisma.TransactionClient): Promise<string> {
  const now = new Date()
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  const startOfDay = new Date(now)
  startOfDay.setHours(0, 0, 0, 0)
  const count = await tx.purchaseInvoice.count({ where: { createdAt: { gte: startOfDay } } })
  return `PUR-${dateStr}-${String(count + 1).padStart(4, '0')}`
}

// ─── List ──────────────────────────────────────────────────────────────────────

export async function getPurchaseInvoices(params: {
  page?: number
  limit?: number
  status?: string
  supplierId?: string
  from?: string
  to?: string
  search?: string
}) {
  const { page = 1, limit = 20, status, supplierId, from, to, search } = params
  const skip = (page - 1) * limit

  const where: Prisma.PurchaseInvoiceWhereInput = { isActive: true }

  if (status) {
    where.status = status
  }
  if (supplierId) {
    where.supplierId = supplierId
  }
  if (from || to) {
    where.createdAt = {}
    if (from) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(from)
    if (to) (where.createdAt as Prisma.DateTimeFilter).lte = new Date(to)
  }
  if (search) {
    where.invoiceNumber = { contains: search }
  }

  const [data, total] = await Promise.all([
    prisma.purchaseInvoice.findMany({
      where,
      include: {
        supplier: { select: { id: true, name: true, currency: true } },
      },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.purchaseInvoice.count({ where }),
  ])

  return { data, total, page, limit }
}

// ─── Get By ID ────────────────────────────────────────────────────────────────

export async function getPurchaseInvoiceById(id: string) {
  return prisma.purchaseInvoice.findFirst({
    where: { id, isActive: true },
    include: {
      supplier: true,
      createdBy: { select: { id: true, name: true, username: true } },
      items: {
        include: {
          item: {
            select: {
              id: true,
              name_ar: true,
              name_en: true,
              barcode: true,
              unit: true,
              costPrice: true,
              stockQty: true,
            },
          },
        },
      },
    },
  })
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createPurchaseInvoice(
  data: CreatePurchaseInvoiceInput,
  userId: string
) {
  if (data.supplierRef) {
    const dup = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT "id" FROM "PurchaseInvoice" WHERE "supplierId" = ? AND "supplierRef" = ? AND "isActive" = 1 AND "status" != 'CANCELLED' LIMIT 1`,
      data.supplierId,
      data.supplierRef,
    )
    if (dup.length > 0) {
      const err = new Error('SUPPLIER_REF_DUPLICATE') as Error & { statusCode: number }
      err.statusCode = 409
      throw err
    }
  }

  const lines = data.items.map((line) => {
    const lineSubtotal = line.quantity * line.unitCost
    const lineTotal = lineSubtotal - lineSubtotal * (line.discount / 100)
    return { ...line, subtotal: lineTotal }
  })

  const subtotal = lines.reduce((sum, l) => sum + l.subtotal, 0)
  const invoiceDiscountAmount = subtotal * (data.discount / 100)
  const total = subtotal - invoiceDiscountAmount

  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const invoiceNumber = await generatePurchaseNumberInTx(tx)
        const created = await tx.purchaseInvoice.create({
          data: {
            invoiceNumber,
            supplierId: data.supplierId,
            paymentType: data.paymentType ?? 'CREDIT',
            currency: data.currency,
            exchangeRate: new Prisma.Decimal(data.exchangeRate),
            subtotal: new Prisma.Decimal(subtotal),
            discount: new Prisma.Decimal(invoiceDiscountAmount),
            total: new Prisma.Decimal(total),
            notes: data.notes ?? null,
            status: 'DRAFT',
            createdById: userId,
            items: {
              create: lines.map((line) => ({
                itemId: line.itemId,
                quantity: new Prisma.Decimal(line.quantity),
                unitCost: new Prisma.Decimal(line.unitCost),
                currency: data.currency,
                subtotal: new Prisma.Decimal(line.subtotal),
                expiryDate: line.expiryDate ? new Date(line.expiryDate) : null,
              })),
            },
          },
          include: {
            supplier: true,
            items: {
              include: {
                item: { select: { id: true, name_ar: true, name_en: true, barcode: true, unit: true } },
              },
            },
          },
        })
        if (data.supplierRef) {
          await tx.$executeRawUnsafe(
            `UPDATE "PurchaseInvoice" SET "supplierRef" = ? WHERE "id" = ?`,
            data.supplierRef,
            created.id,
          )
        }
        return created
      })
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code
      if ((code === 'P2002' || code === 'P2034') && attempt < 9) {
        await new Promise(r => setTimeout(r, Math.random() * 30 + 5))
        continue
      }
      throw e
    }
  }
  throw new Error('Failed to generate unique purchase invoice number after retries')
}

// ─── Confirm ──────────────────────────────────────────────────────────────────

export async function confirmInvoice(invoiceId: string, userId: string) {
  const invoice = await prisma.purchaseInvoice.findFirst({
    where: { id: invoiceId, isActive: true },
    include: { items: true },
  })

  if (!invoice) {
    throw new Error('INVOICE_NOT_FOUND')
  }
  if (invoice.status !== 'DRAFT') {
    throw new Error('INVALID_STATUS')
  }

  const wh = invoice.warehouseId
    ? { id: invoice.warehouseId }
    : await ensureDefaultWarehouse(prisma)

  await prisma.$transaction(async (tx) => {
      for (const line of invoice.items) {
        await stockIn(tx, {
          itemId: line.itemId,
          warehouseId: wh.id,
          qty: Number(line.quantity),
          unitCost: Number(line.unitCost),
          updateAvgCost: true,
          type: 'IN',
          reason: 'PURCHASE',
          userId,
          notes: `فاتورة شراء: ${invoice.invoiceNumber}`,
        })
      }

      // Update supplier balance for credit purchases only
      const payType = (invoice as { paymentType?: string }).paymentType ?? 'CREDIT'
      if (payType === 'CREDIT') {
        await tx.supplier.update({
          where: { id: invoice.supplierId },
          data: {
            balance: {
              increment: invoice.total,
            },
          },
        })
      }

      await tx.purchaseInvoice.update({
        where: { id: invoiceId },
        data: {
          status: 'CONFIRMED',
          balance: invoice.total,
          amountPaid: new Prisma.Decimal(0),
          warehouseId: wh.id,
        },
      })
  })

  return getPurchaseInvoiceById(invoiceId)
}

// ─── Cancel ───────────────────────────────────────────────────────────────────

export async function cancelInvoice(invoiceId: string, userId: string) {
  const invoice = await prisma.purchaseInvoice.findFirst({
    where: { id: invoiceId, isActive: true },
    include: { items: true },
  })

  if (!invoice) {
    throw new Error('INVOICE_NOT_FOUND')
  }
  if (invoice.status === 'CANCELLED') {
    throw new Error('ALREADY_CANCELLED')
  }

  const wasConfirmed = invoice.status === 'CONFIRMED'
  const wh = invoice.warehouseId
    ? { id: invoice.warehouseId }
    : await ensureDefaultWarehouse(prisma)

  await prisma.$transaction(async (tx) => {
      if (wasConfirmed) {
        for (const line of invoice.items) {
          await stockOut(tx, {
            itemId: line.itemId,
            warehouseId: wh.id,
            qty: Number(line.quantity),
            type: 'OUT',
            reason: 'ADJUSTMENT',
            userId,
            notes: `إلغاء فاتورة شراء: ${invoice.invoiceNumber}`,
          })
        }

        const payType = (invoice as { paymentType?: string }).paymentType ?? 'CREDIT'
        if (payType === 'CREDIT') {
          await tx.supplier.update({
            where: { id: invoice.supplierId },
            data: { balance: { decrement: invoice.total } },
          })
        }
      }

      await tx.purchaseInvoice.update({
        where: { id: invoiceId },
        data: {
          status: 'CANCELLED',
          ...(wasConfirmed ? { balance: new Prisma.Decimal(0) } : {}),
        },
      })
  })

  return getPurchaseInvoiceById(invoiceId)
}

/** Purchase return to supplier — reduce stock and supplier balance */
export async function returnPurchaseInvoice(
  invoiceId: string,
  userId: string,
  items?: Array<{ itemId: string; quantity: number }>
) {
  const invoice = await prisma.purchaseInvoice.findFirst({
    where: { id: invoiceId, isActive: true },
    include: { items: true },
  })
  if (!invoice) throw new Error('INVOICE_NOT_FOUND')
  if (invoice.status !== 'CONFIRMED') throw new Error('ONLY_CONFIRMED')

  const wh = invoice.warehouseId
    ? { id: invoice.warehouseId }
    : await ensureDefaultWarehouse(prisma)

  const lines = items?.length
    ? items
    : invoice.items.map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity) }))

  let returnTotal = 0
  await prisma.$transaction(async (tx) => {
    for (const ri of lines) {
      const invLine = invoice.items.find((l) => l.itemId === ri.itemId)
      if (!invLine) throw new Error(`ITEM_NOT_IN_INVOICE:${ri.itemId}`)
      if (ri.quantity > Number(invLine.quantity)) throw new Error('QTY_EXCEEDS')
      await stockOut(tx, {
        itemId: ri.itemId,
        warehouseId: wh.id,
        qty: ri.quantity,
        type: 'OUT',
        reason: 'RETURN',
        userId,
        notes: `مرتجع شراء: ${invoice.invoiceNumber}`,
      })
      returnTotal += ri.quantity * Number(invLine.unitCost)
    }
    await tx.supplier.update({
      where: { id: invoice.supplierId },
      data: { balance: { decrement: returnTotal } },
    })
    const full =
      lines.length === invoice.items.length &&
      lines.every((l) => {
        const inv = invoice.items.find((i) => i.itemId === l.itemId)!
        return l.quantity >= Number(inv.quantity)
      })
    if (full) {
      await tx.purchaseInvoice.update({
        where: { id: invoiceId },
        data: { status: 'RETURNED', balance: 0 },
      })
    }
  })

  return getPurchaseInvoiceById(invoiceId)
}
