import { Prisma } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'
import { CreateSalesInvoiceInput } from '../validators/sales.validator'
import { ensureDefaultWarehouse, stockOut, stockIn } from './stock-ops.service'
import { prisma } from '../db/prisma'
import {
  computeInvoiceTotals,
  computeInclusiveInvoiceTotals,
  parseDiscountType,
  proportionalReturnShare,
  proportionalReturnTotalInclusive,
  roundMoney,
  safeDecimal,
  type DiscountType,
} from '../utils/salesTotals'
import {
  assertCanEditPrice,
  catalogUnitPrice,
  getTaxPolicySnapshot,
  userMayEditPrice,
} from './salesPolicy.service'

async function getTaxPct(): Promise<Decimal> {
  const policy = await getTaxPolicySnapshot()
  return policy.taxPct
}

import {
  creditLimitExceededError,
  creditNotAllowedError,
  isCreditError,
} from '../utils/creditErrors'
import { logAudit } from './audit.service'
import { buildEtaPayload, enqueueEtaDocument } from './eta.service'

function invoiceConflictError(): Error & { statusCode: number } {
  const err = new Error('INVOICE_MODIFIED_ELSEWHERE') as Error & { statusCode: number }
  err.statusCode = 409
  return err
}

function assertInvoiceVersion(invoice: { updatedAt: Date }, expectedUpdatedAt?: string) {
  if (!expectedUpdatedAt) return
  const expected = new Date(expectedUpdatedAt).getTime()
  if (!Number.isFinite(expected)) return
  if (Math.abs(invoice.updatedAt.getTime() - expected) > 1500) {
    throw invoiceConflictError()
  }
}

async function assertCreditAllowed(customerId: string, invoiceTotal: Decimal) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } })
  if (!customer) throw new Error('CUSTOMER_NOT_FOUND')
  const limit = Number(customer.creditLimit)
  if (limit <= 0) {
    throw creditNotAllowedError()
  }
  const balance = Number(customer.balance)
  const invoiceAmt = invoiceTotal.toNumber()
  const available = Math.max(0, limit - balance)
  if (balance + invoiceAmt > limit + 1e-6) {
    throw creditLimitExceededError(available, invoiceAmt)
  }
}

async function restoreSerialsForLine(
  tx: Prisma.TransactionClient,
  line: { id: string; itemId: string; serialNumber: string | null; item?: { trackSerial?: boolean } },
) {
  if (!line.item?.trackSerial && line.serialNumber == null) return
  const serial = line.serialNumber?.trim()
  if (serial) {
    await tx.itemSerial.updateMany({
      where: { salesInvoiceItemId: line.id },
      data: {
        status: 'IN_STOCK',
        salesInvoiceItemId: null,
        warrantyStart: null,
        warrantyEnd: null,
      },
    })
    return
  }
  await tx.itemSerial.updateMany({
    where: { salesInvoiceItemId: line.id },
    data: {
      status: 'IN_STOCK',
      salesInvoiceItemId: null,
      warrantyStart: null,
      warrantyEnd: null,
    },
  })
}

async function returnStockForLine(
  tx: Prisma.TransactionClient,
  opts: {
    line: { itemId: string; id: string; serialNumber: string | null; item?: { trackSerial?: boolean } }
    warehouseId: string
    qty: number
    userId: string
    notes: string
  },
) {
  await stockIn(tx, {
    itemId: opts.line.itemId,
    warehouseId: opts.warehouseId,
    qty: opts.qty,
    type: 'IN',
    reason: 'RETURN',
    userId: opts.userId,
    notes: opts.notes,
    updateAvgCost: false,
  })
  await restoreSerialsForLine(tx, opts.line)
}

function invoiceDiscountMeta(data: CreateSalesInvoiceInput): { discountType: DiscountType; discountValue: Decimal } {
  return {
    discountType: parseDiscountType(data.discountType),
    discountValue: safeDecimal(data.discount ?? 0),
  }
}

async function generateInvoiceNumberInTx(tx: Prisma.TransactionClient): Promise<string> {
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '')
  const prefix = `INV-${dateStr}-`
  // SQLite-compatible: use SUBSTR instead of PostgreSQL SUBSTRING ... FROM
  const startPos = prefix.length + 1
  const result = await tx.$queryRaw<{ max_num: number | null }[]>`
    SELECT MAX(CAST(SUBSTR("invoiceNumber", ${startPos}) AS INTEGER)) AS max_num
    FROM "SalesInvoice"
    WHERE "invoiceNumber" LIKE ${prefix + '%'}
  `
  const maxNum = result[0]?.max_num ? Number(result[0].max_num) : 0
  return `${prefix}${String(maxNum + 1).padStart(4, '0')}`
}

export async function getSalesInvoices(params: {
  page?: number
  limit?: number
  status?: string
  customerId?: string
  from?: string
  to?: string
  search?: string
}) {
  const { page = 1, limit = 20, status, customerId, from, to, search } = params
  const skip = (page - 1) * limit

  const where: Prisma.SalesInvoiceWhereInput = {
    isActive: true,
    status: status ? status : { not: 'QUOTE' },
  }

  if (status) where.status = status
  if (customerId) where.customerId = customerId
  if (from || to) {
    where.createdAt = {}
    if (from) where.createdAt.gte = new Date(from)
    if (to) where.createdAt.lte = new Date(to)
  }
  if (search) {
    where.invoiceNumber = { contains: search }
  }

  const [data, total] = await Promise.all([
    prisma.salesInvoice.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: {
          select: { id: true, name: true, currency: true },
        },
        _count: {
          select: { items: true },
        },
      },
    }),
    prisma.salesInvoice.count({ where }),
  ])

  return { data, total, page, limit }
}

export async function getSalesInvoiceById(id: string) {
  // Allow lookup by UUID or invoice number (INV-...)
  const where = id.startsWith('INV-') || id.startsWith('QUO-')
    ? { invoiceNumber: id, isActive: true }
    : { id, isActive: true }
  return prisma.salesInvoice.findFirst({
    where,
    include: {
      customer: true,
      warehouse: true,
      payments: true,
      createdBy: {
        select: { id: true, name: true, username: true },
      },
      items: {
        include: {
          item: {
            select: {
              id: true, name_ar: true, name_en: true, barcode: true,
              costPrice: true, trackSerial: true, size: true, color: true,
            },
          },
        },
      },
    },
  })
}

type SalesActor = { id: string; role: string; canEditPrice?: boolean }

export async function createSalesInvoice(data: CreateSalesInvoiceInput, userId: string, actor?: SalesActor) {
  if (data.paymentType === 'CREDIT' && !data.customerId) {
    throw new Error('CREDIT_REQUIRES_CUSTOMER')
  }

  const exchangeRateDecimal = safeDecimal(1)
  const { discountType, discountValue } = invoiceDiscountMeta(data)
  const defaultWh = await ensureDefaultWarehouse(prisma)
  const warehouseId = (data as { warehouseId?: string }).warehouseId || defaultWh.id
  const policy = await getTaxPolicySnapshot()

  const itemIds = data.items.map((l) => l.itemId)
  const dbItems = await prisma.item.findMany({ where: { id: { in: itemIds } } })
  const itemMap = new Map(dbItems.map((i) => [i.id, i]))

  const mayEdit =
    actor
      ? actor.role === 'ADMIN' || actor.role === 'MANAGER' || Boolean(actor.canEditPrice)
      : await userMayEditPrice(userId)

  const lineData = buildSalesLineData(data, itemMap, mayEdit, actor)
  const belowCostLines = lineData.filter((l) => l.unitCost.gt(0) && l.unitPrice.lt(l.unitCost))
  if (belowCostLines.length > 0) {
    if (policy.belowCostPolicy === 'BLOCK') {
      const err = new Error('BELOW_COST_BLOCKED') as Error & { statusCode: number }
      err.statusCode = 400
      throw err
    }
    if (!data.belowCostConfirmed) {
      const err = new Error('BELOW_COST_CONFIRM_REQUIRED') as Error & { statusCode: number }
      err.statusCode = 400
      throw err
    }
  }

  const subtotal = lineData.reduce((acc, l) => acc.plus(l.subtotal), new Decimal(0))
  const taxableSubtotal = lineData
    .filter((l) => !l.taxExempt)
    .reduce((acc, l) => acc.plus(l.subtotal), new Decimal(0))
  const totals = computeInvoiceTotals({
    linesSubtotal: subtotal,
    taxableLinesSubtotal: taxableSubtotal,
    discountType,
    discountValue,
    taxPct: policy.taxPct,
    taxMode: policy.taxMode,
    taxEnabled: policy.vatEnabled,
  })
  const { tax, total, netOfTax } = totals

  if (data.paymentType === 'CREDIT' && data.customerId) {
    await assertCreditAllowed(data.customerId, total)
  }

  const openShift = await prisma.cashierShift.findFirst({
    where: { userId, status: 'OPEN' },
    orderBy: { openedAt: 'desc' },
  })

  const hasPriceOverride = lineData.some((l) => l.priceOverridden)
  const soldBelowCost = belowCostLines.length > 0

  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const created = await prisma.$transaction(async (tx) => {
        const invoiceNumber = await generateInvoiceNumberInTx(tx)
        const inv = await tx.salesInvoice.create({
          data: {
            invoiceNumber,
            customerId: data.customerId ?? null,
            warehouseId,
            shiftId: openShift?.id ?? null,
            type: data.paymentType,
            priceType: data.priceType,
            currency: 'EGP',
            exchangeRate: exchangeRateDecimal,
            subtotal,
            discountType,
            discount: discountValue,
            tax,
            taxEnabled: policy.vatEnabled && policy.taxPct.gt(0),
            taxMode: policy.taxMode,
            taxRate: policy.vatEnabled ? policy.taxPct : new Decimal(0),
            netOfTax,
            soldBelowCost,
            hasPriceOverride,
            total,
            balance: total,
            notes: data.notes ?? null,
            status: 'DRAFT',
            createdById: userId,
            items: {
              create: lineData.map((l) => ({
                itemId: l.itemId,
                quantity: l.quantity,
                originalUnitPrice: l.originalUnitPrice,
                unitPrice: l.unitPrice,
                unitCost: l.unitCost,
                subtotal: l.subtotal,
                priceOverridden: l.priceOverridden,
                taxExempt: l.taxExempt,
                currency: l.currency,
                serialNumber: l.serialNumber,
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

        for (const l of lineData) {
          if (!l.priceOverridden) continue
          await logAudit(tx, {
            userId,
            action: 'PRICE_OVERRIDE',
            entityType: 'SALES_INVOICE',
            entityId: inv.id,
            details: {
              invoiceNumber: inv.invoiceNumber,
              itemId: l.itemId,
              originalUnitPrice: l.originalUnitPrice.toNumber(),
              unitPrice: l.unitPrice.toNumber(),
              unitCost: l.unitCost.toNumber(),
            },
          })
        }
        return inv
      })
      return created
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code
      if ((code === 'P2002' || code === 'P2034') && attempt < 9) {
        await new Promise((r) => setTimeout(r, Math.random() * 30 + 5))
        continue
      }
      throw e
    }
  }
  throw new Error('Failed to generate unique invoice number after retries')
}

function buildSalesLineData(
  data: CreateSalesInvoiceInput,
  itemMap: Map<string, {
    id: string
    costPrice: unknown
    retailPrice: unknown
    wholesalePrice?: unknown
    specialPrice?: unknown
    dollarPrice?: unknown
    dinarPrice?: unknown
    taxExempt?: boolean | null
  }>,
  mayEditPrice: boolean,
  actor?: SalesActor,
) {
  return data.items.map((line) => {
    const item = itemMap.get(line.itemId)
    if (!item) throw new Error(`ITEM_NOT_FOUND:${line.itemId}`)
    const catalog = catalogUnitPrice(item, data.priceType)
    const original =
      line.originalUnitPrice != null && Number.isFinite(Number(line.originalUnitPrice))
        ? Number(line.originalUnitPrice)
        : catalog
    const sold = Number(line.unitPrice)
    const overridden =
      Boolean(line.priceOverridden) || Math.abs(sold - original) > 0.001
    if (overridden) {
      if (!mayEditPrice) {
        assertCanEditPrice(actor || { id: '', role: 'CASHIER', canEditPrice: false })
      }
    }
    const qty = safeDecimal(line.quantity)
    const price = safeDecimal(sold)
    const discountFactor = new Decimal(1).minus(safeDecimal(line.discount ?? 0).div(100))
    const serialNumber = (line as { serialNumber?: string }).serialNumber || null
    return {
      itemId: line.itemId,
      quantity: qty,
      originalUnitPrice: safeDecimal(original),
      unitPrice: price,
      unitCost: safeDecimal(item.costPrice ?? 0),
      subtotal: qty.mul(price).mul(discountFactor),
      priceOverridden: overridden,
      taxExempt: Boolean(item.taxExempt),
      currency: 'EGP' as const,
      serialNumber,
    }
  })
}

async function computeSalesTotals(data: CreateSalesInvoiceInput, lineData: ReturnType<typeof buildSalesLineData>) {
  const { discountType, discountValue } = invoiceDiscountMeta(data)
  const subtotal = lineData.reduce((acc, l) => acc.plus(l.subtotal), new Decimal(0))
  const taxableSubtotal = lineData
    .filter((l) => !l.taxExempt)
    .reduce((acc, l) => acc.plus(l.subtotal), new Decimal(0))
  const policy = await getTaxPolicySnapshot()
  const totals = computeInvoiceTotals({
    linesSubtotal: subtotal,
    taxableLinesSubtotal: taxableSubtotal,
    discountType,
    discountValue,
    taxPct: policy.taxPct,
    taxMode: policy.taxMode,
    taxEnabled: policy.vatEnabled,
  })
  return {
    subtotal,
    discountType,
    discountValue,
    tax: totals.tax,
    total: totals.total,
    netOfTax: totals.netOfTax,
    taxMode: totals.taxMode,
    taxEnabled: totals.taxEnabled,
    taxRate: policy.vatEnabled ? policy.taxPct : new Decimal(0),
    policy,
  }
}

export async function updateSalesInvoice(
  invoiceId: string,
  data: CreateSalesInvoiceInput,
  userId: string,
  expectedUpdatedAt?: string,
  actor?: SalesActor,
) {
  if (data.paymentType === 'CREDIT' && !data.customerId) {
    throw new Error('CREDIT_REQUIRES_CUSTOMER')
  }

  const invoice = await prisma.salesInvoice.findFirst({
    where: { id: invoiceId, isActive: true },
  })
  if (!invoice) throw new Error('INVOICE_NOT_FOUND')
  if (invoice.status !== 'DRAFT' && invoice.status !== 'PARKED') {
    const err = new Error('INVOICE_NOT_EDITABLE')
    ;(err as Error & { statusCode: number }).statusCode = 400
    throw err
  }
  assertInvoiceVersion(invoice, expectedUpdatedAt)

  const exchangeRateDecimal = safeDecimal(1)
  const defaultWh = await ensureDefaultWarehouse(prisma)
  const warehouseId = (data as { warehouseId?: string }).warehouseId || invoice.warehouseId || defaultWh.id

  const itemIds = data.items.map((l) => l.itemId)
  const dbItems = await prisma.item.findMany({ where: { id: { in: itemIds } } })
  const itemMap = new Map(dbItems.map((i) => [i.id, i]))
  const mayEdit =
    actor
      ? actor.role === 'ADMIN' || actor.role === 'MANAGER' || Boolean(actor.canEditPrice)
      : await userMayEditPrice(userId)
  const lineData = buildSalesLineData(data, itemMap, mayEdit, actor)
  const totals = await computeSalesTotals(data, lineData)
  const { subtotal, discountType, discountValue, tax, total, netOfTax, taxMode, taxEnabled, taxRate, policy } =
    totals

  const belowCostLines = lineData.filter((l) => l.unitCost.gt(0) && l.unitPrice.lt(l.unitCost))
  if (belowCostLines.length > 0) {
    if (policy.belowCostPolicy === 'BLOCK') {
      const err = new Error('BELOW_COST_BLOCKED') as Error & { statusCode: number }
      err.statusCode = 400
      throw err
    }
    if (!data.belowCostConfirmed) {
      const err = new Error('BELOW_COST_CONFIRM_REQUIRED') as Error & { statusCode: number }
      err.statusCode = 400
      throw err
    }
  }

  if (data.paymentType === 'CREDIT' && data.customerId) {
    await assertCreditAllowed(data.customerId, total)
  }

  return prisma.$transaction(async (tx) => {
    if (expectedUpdatedAt) {
      const locked = await tx.salesInvoice.updateMany({
        where: {
          id: invoiceId,
          status: { in: ['DRAFT', 'PARKED'] },
          updatedAt: new Date(expectedUpdatedAt),
        },
        data: { notes: data.notes ?? invoice.notes },
      })
      if (locked.count === 0) throw invoiceConflictError()
    }
    await tx.salesInvoiceItem.deleteMany({ where: { invoiceId } })
    const updated = await tx.salesInvoice.update({
      where: { id: invoiceId },
      data: {
        customerId: data.customerId ?? null,
        warehouseId,
        type: data.paymentType,
        priceType: data.priceType,
        currency: 'EGP',
        exchangeRate: exchangeRateDecimal,
        subtotal,
        discountType,
        discount: discountValue,
        tax,
        taxEnabled,
        taxMode,
        taxRate,
        netOfTax,
        soldBelowCost: belowCostLines.length > 0,
        hasPriceOverride: lineData.some((l) => l.priceOverridden),
        total,
        balance: total,
        notes: data.notes ?? null,
        items: {
          create: lineData.map((l) => ({
            itemId: l.itemId,
            quantity: l.quantity,
            originalUnitPrice: l.originalUnitPrice,
            unitPrice: l.unitPrice,
            unitCost: l.unitCost,
            subtotal: l.subtotal,
            priceOverridden: l.priceOverridden,
            taxExempt: l.taxExempt,
            currency: l.currency,
            serialNumber: l.serialNumber,
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
    for (const l of lineData) {
      if (!l.priceOverridden) continue
      await logAudit(tx, {
        userId,
        action: 'PRICE_OVERRIDE',
        entityType: 'SALES_INVOICE',
        entityId: invoiceId,
        details: {
          originalUnitPrice: l.originalUnitPrice.toNumber(),
          unitPrice: l.unitPrice.toNumber(),
          itemId: l.itemId,
        },
      })
    }
    await logAudit(tx, {
      userId,
      action: 'INVOICE_UPDATE',
      entityType: 'SALES_INVOICE',
      entityId: invoiceId,
      details: { total: Number(total) },
    })
    return updated
  })
}

export async function confirmInvoice(
  invoiceId: string,
  userId: string,
  amountPaid?: number,
  payments?: Array<{ method: string; amount: number }>,
  expectedUpdatedAt?: string,
) {
  const invoice = await prisma.salesInvoice.findFirst({
    where: { id: invoiceId, isActive: true },
    include: { items: { include: { item: true } }, customer: true },
  })

  if (!invoice) throw new Error('INVOICE_NOT_FOUND')
  if (invoice.status !== 'DRAFT' && invoice.status !== 'PARKED') {
    const err = new Error('INVOICE_NOT_DRAFT')
    ;(err as Error & { statusCode: number }).statusCode = 400
    throw err
  }
  assertInvoiceVersion(invoice, expectedUpdatedAt)

  if (invoice.type === 'CREDIT' && invoice.customerId) {
    await assertCreditAllowed(invoice.customerId, new Decimal(invoice.total.toString()))
  }

  let nextShiftId = invoice.shiftId
  let shiftRebind: { from: string; to: string | null } | null = null
  if (nextShiftId) {
    const linked = await prisma.cashierShift.findUnique({ where: { id: nextShiftId } })
    if (linked?.status === 'CLOSED') {
      const open = await prisma.cashierShift.findFirst({ where: { userId, status: 'OPEN' } })
      shiftRebind = { from: nextShiftId, to: open?.id ?? null }
      nextShiftId = open?.id ?? null
    }
  }

  const wh = invoice.warehouseId
    ? { id: invoice.warehouseId }
    : await ensureDefaultWarehouse(prisma)

  await prisma.$transaction(async (tx) => {
    const claimWhere: Prisma.SalesInvoiceWhereInput = {
      id: invoiceId,
      status: { in: ['DRAFT', 'PARKED'] },
    }
    if (expectedUpdatedAt) claimWhere.updatedAt = new Date(expectedUpdatedAt)

    const claimed = await tx.salesInvoice.updateMany({
      where: claimWhere,
      data: { status: 'CONFIRMED', shiftId: nextShiftId },
    })
    if (claimed.count !== 1) {
      if (expectedUpdatedAt) throw invoiceConflictError()
      throw new Error('INVOICE_ALREADY_CONFIRMED')
    }

    for (const line of invoice.items) {
      const qty = new Decimal(line.quantity.toString()).toNumber()
      const unitCost = Number(line.item.costPrice)

      // Lock cost at confirm time
      await tx.salesInvoiceItem.update({
        where: { id: line.id },
        data: { unitCost },
      })

      await stockOut(tx, {
        itemId: line.itemId,
        warehouseId: wh.id,
        qty,
        type: 'OUT',
        reason: 'SALE',
        userId,
        notes: `فاتورة مبيعات: ${invoice.invoiceNumber}`,
      })

      // Serial tracking
      if (line.item.trackSerial) {
        const qty = new Decimal(line.quantity.toString()).toNumber()
        if (qty !== 1) throw new Error(`SERIAL_QTY_ONE:${line.item.name_ar}`)
        const serial = line.serialNumber?.trim()
        if (!serial) throw new Error(`SERIAL_REQUIRED:${line.item.name_ar}`)
        const row = await tx.itemSerial.findFirst({
          where: { itemId: line.itemId, serial, status: 'IN_STOCK' },
        })
        if (!row) throw new Error(`SERIAL_NOT_FOUND:${serial}`)
        const months = row.warrantyMonths || line.item.warrantyMonths || 0
        const start = new Date()
        const end = months > 0 ? new Date(start.getTime() + months * 30 * 24 * 3600 * 1000) : null
        await tx.itemSerial.update({
          where: { id: row.id },
          data: {
            status: 'SOLD',
            salesInvoiceItemId: line.id,
            warrantyStart: start,
            warrantyEnd: end,
          },
        })
      }
    }

    if (invoice.type === 'CREDIT' && invoice.customerId) {
      await tx.customer.update({
        where: { id: invoice.customerId },
        data: { balance: { increment: new Decimal(invoice.total.toString()).toNumber() } },
      })
    }

    const isCash = invoice.type === 'CASH'
    let paid = isCash
      ? new Decimal(amountPaid != null ? amountPaid : invoice.total.toString())
      : new Decimal(0)

    if (payments && payments.length > 0) {
      await tx.salesPayment.deleteMany({ where: { invoiceId } })
      for (const p of payments) {
        await tx.salesPayment.create({
          data: { invoiceId, method: p.method, amount: p.amount },
        })
      }
      paid = payments.reduce((s, p) => s.plus(p.amount), new Decimal(0))
    } else if (isCash) {
      await tx.salesPayment.create({
        data: { invoiceId, method: 'CASH', amount: paid },
      })
    } else {
      await tx.salesPayment.create({
        data: { invoiceId, method: 'CREDIT', amount: invoice.total },
      })
    }

    const newBalance = new Decimal(invoice.total.toString()).minus(paid)
    await tx.salesInvoice.update({
      where: { id: invoiceId },
      data: {
        amountPaid: paid,
        balance: newBalance.lt(0) ? new Decimal(0) : newBalance,
        warehouseId: wh.id,
      },
    })

    await logAudit(tx, {
      userId,
      action: 'CONFIRM_INVOICE',
      entityType: 'SALES_INVOICE',
      entityId: invoiceId,
      details: {
        total: Number(invoice.total),
        invoiceNumber: invoice.invoiceNumber,
        shiftRebind,
      },
    })

    if (shiftRebind) {
      await logAudit(tx, {
        userId,
        action: 'SHIFT_REBIND',
        entityType: 'SALES_INVOICE',
        entityId: invoiceId,
        details: shiftRebind,
      })
    }

    const payload = await buildEtaPayload({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      total: invoice.total,
      tax: invoice.tax,
      subtotal: invoice.subtotal,
      type: invoice.type,
      customer: invoice.customer,
      items: invoice.items.map((l) => ({
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        subtotal: l.subtotal,
        item: { name_ar: l.item.name_ar, barcode: l.item.barcode },
      })),
    })
    await enqueueEtaDocument(tx, invoiceId, 'RECEIPT', payload)
  })

  return getSalesInvoiceById(invoiceId)
}

export async function parkInvoice(invoiceId: string) {
  const invoice = await prisma.salesInvoice.findFirst({
    where: { id: invoiceId, isActive: true },
  })
  if (!invoice) throw new Error('INVOICE_NOT_FOUND')
  if (invoice.status !== 'DRAFT' && invoice.status !== 'PARKED') {
    throw new Error('CANNOT_PARK')
  }
  return prisma.salesInvoice.update({
    where: { id: invoiceId },
    data: { status: 'PARKED' },
  })
}

export async function listParkedInvoices() {
  return prisma.salesInvoice.findMany({
    where: { status: 'PARKED', isActive: true },
    include: {
      customer: { select: { id: true, name: true } },
      _count: { select: { items: true } },
    },
    orderBy: { updatedAt: 'desc' },
  })
}

export async function cancelInvoice(invoiceId: string, userId: string) {
  const invoice = await prisma.salesInvoice.findFirst({
    where: { id: invoiceId, isActive: true },
    include: { items: true },
  })

  if (!invoice) throw new Error('INVOICE_NOT_FOUND')
  if (invoice.status === 'CANCELLED') throw new Error('ALREADY_CANCELLED')

  const wasConfirmed = invoice.status === 'CONFIRMED'
  const wh = invoice.warehouseId
    ? { id: invoice.warehouseId }
    : await ensureDefaultWarehouse(prisma)

  await prisma.$transaction(async (tx) => {
    if (wasConfirmed) {
      for (const line of invoice.items) {
        await stockIn(tx, {
          itemId: line.itemId,
          warehouseId: wh.id,
          qty: new Decimal(line.quantity.toString()).toNumber(),
          type: 'IN',
          reason: 'RETURN',
          userId,
          notes: `إلغاء فاتورة: ${invoice.invoiceNumber}`,
          updateAvgCost: false,
        })
      }

      if (invoice.type === 'CREDIT' && invoice.customerId) {
        await tx.customer.update({
          where: { id: invoice.customerId },
          data: { balance: { decrement: new Decimal(invoice.total.toString()).toNumber() } },
        })
      }
    }

    await tx.salesInvoice.update({
      where: { id: invoiceId },
      data: { status: 'CANCELLED' },
    })
    await logAudit(tx, {
      userId,
      action: 'CANCEL_INVOICE',
      entityType: 'SALES_INVOICE',
      entityId: invoiceId,
      details: { invoiceNumber: invoice.invoiceNumber, wasConfirmed },
    })
  })

  return getSalesInvoiceById(invoiceId)
}

export async function partialReturnInvoice(
  invoiceId: string,
  returnItems: { itemId: string; quantity: number }[],
  userId: string
) {
  const invoice = await prisma.salesInvoice.findFirst({
    where: { id: invoiceId, isActive: true },
    include: { items: { include: { item: true } } },
  })

  if (!invoice) throw new Error('INVOICE_NOT_FOUND')
  if (invoice.status !== 'CONFIRMED') {
    const err = new Error('ONLY_CONFIRMED_CAN_BE_RETURNED')
    ;(err as Error & { statusCode: number }).statusCode = 400
    throw err
  }

  for (const ri of returnItems) {
    const invLine = invoice.items.find((l) => l.itemId === ri.itemId)
    if (!invLine) throw new Error(`ITEM_NOT_IN_INVOICE:${ri.itemId}`)
    if (ri.quantity <= 0) throw new Error(`INVALID_QUANTITY:${ri.itemId}`)
    if (ri.quantity > Number(invLine.quantity)) throw new Error(`RETURN_QTY_EXCEEDS_SOLD:${ri.itemId}`)
  }

  let returnSubtotal = new Decimal(0)
  for (const ri of returnItems) {
    const invLine = invoice.items.find((l) => l.itemId === ri.itemId)!
    const lineSub = new Decimal(invLine.subtotal.toString())
    const lineQty = Number(invLine.quantity)
    returnSubtotal = returnSubtotal.plus(lineSub.mul(ri.quantity).div(lineQty))
  }

  const discountType = parseDiscountType((invoice as { discountType?: string }).discountType)
  const discountValue = new Decimal(invoice.discount.toString())
  const invoiceSubtotal = new Decimal(invoice.subtotal.toString())
  // Use tax snapshot from the invoice — never live settings (returns keep original VAT)
  const snapTaxEnabled = (invoice as { taxEnabled?: boolean }).taxEnabled !== false
  const snapTaxMode =
    (invoice as { taxMode?: string }).taxMode === 'EXCLUSIVE' ? 'EXCLUSIVE' : 'INCLUSIVE'
  const snapTaxRate = safeDecimal((invoice as { taxRate?: unknown }).taxRate, 0)
  const snapNet = safeDecimal((invoice as { netOfTax?: unknown }).netOfTax, Number(invoice.total) - Number(invoice.tax))
  const snapTax = safeDecimal(invoice.tax)
  const snapTotal = safeDecimal(invoice.total)
  const shareResult = proportionalReturnShare({
    returnLinesSubtotal: returnSubtotal,
    invoiceSubtotal,
    invoiceNetOfTax: snapNet,
    invoiceTax: snapTax,
    invoiceTotal: snapTotal,
    discountType,
    discountValue,
    taxPct: snapTaxEnabled ? snapTaxRate : new Decimal(0),
    taxMode: snapTaxMode,
    taxEnabled: snapTaxEnabled && snapTaxRate.gt(0),
  })
  let returnTotal = shareResult.returnTotal
  // Full return of remaining lines: force exact residual so Σ returns == original total
  const isFullOfRemaining =
    returnItems.length === invoice.items.length &&
    returnItems.every((ri) => {
      const invLine = invoice.items.find((l) => l.itemId === ri.itemId)!
      return ri.quantity >= Number(invLine.quantity)
    })
  if (isFullOfRemaining) {
    returnTotal = snapTotal
  }

  const whId = invoice.warehouseId
    ? invoice.warehouseId
    : (await ensureDefaultWarehouse(prisma)).id

  const isFullReturn =
    returnItems.length === invoice.items.length &&
    returnItems.every((ri) => {
      const invLine = invoice.items.find((l) => l.itemId === ri.itemId)!
      return ri.quantity >= Number(invLine.quantity)
    })

  await prisma.$transaction(
    async (tx) => {
      for (const ri of returnItems) {
        const invLine = invoice.items.find((l) => l.itemId === ri.itemId)!
        const newQty = Number(invLine.quantity) - ri.quantity
        const oldSub = new Decimal(invLine.subtotal.toString())
        const newLineSub =
          newQty <= 0 ? new Decimal(0) : oldSub.mul(newQty).div(Number(invLine.quantity))

        await returnStockForLine(tx, {
          line: invLine,
          warehouseId: whId,
          qty: ri.quantity,
          userId,
          notes: `إرجاع${isFullReturn ? '' : ' جزئي'}: ${invoice.invoiceNumber}`,
        })

        if (newQty <= 0) {
          await tx.salesInvoiceItem.delete({ where: { id: invLine.id } })
        } else {
          await tx.salesInvoiceItem.update({
            where: { id: invLine.id },
            data: { quantity: newQty, subtotal: newLineSub },
          })
        }
      }

      const remainingLines = await tx.salesInvoiceItem.findMany({ where: { invoiceId } })
      const newSubtotal = remainingLines.reduce(
        (acc, l) => acc.plus(new Decimal(l.subtotal.toString())),
        new Decimal(0),
      )
      // FIXED invoice discount must scale with remaining lines; otherwise a partial
      // return would re-apply the full lump discount on the leftover subtotal.
      const remainingDiscountValue =
        discountType === 'FIXED' && invoiceSubtotal.gt(0)
          ? discountValue.mul(newSubtotal).div(invoiceSubtotal)
          : discountValue
      const remainingTaxable = remainingLines
        .filter((l) => !(l as { taxExempt?: boolean }).taxExempt)
        .reduce((acc, l) => acc.plus(new Decimal(l.subtotal.toString())), new Decimal(0))
      const remainingTotals = computeInvoiceTotals({
        linesSubtotal: newSubtotal,
        taxableLinesSubtotal: remainingTaxable,
        discountType,
        discountValue: remainingDiscountValue,
        taxPct: snapTaxEnabled ? snapTaxRate : new Decimal(0),
        taxMode: snapTaxMode,
        taxEnabled: snapTaxEnabled && snapTaxRate.gt(0),
      })
      // Keep exact residual: remaining total = original total − returnTotal (no piastre drift)
      const residualTotal = roundMoney(snapTotal.minus(returnTotal))
      const newTax = remainingTotals.taxMode === 'EXCLUSIVE'
        ? roundMoney(residualTotal.minus(remainingTotals.netOfTax))
        : remainingTotals.tax
      const newTotal = isFullOfRemaining || remainingLines.length === 0
        ? new Decimal(0)
        : residualTotal
      const newNetOfTax =
        remainingLines.length === 0
          ? new Decimal(0)
          : remainingTotals.taxMode === 'EXCLUSIVE'
            ? roundMoney(newTotal.minus(newTax))
            : roundMoney(newTotal.minus(remainingTotals.tax))

      const paid = new Decimal(invoice.amountPaid.toString())
      const newPaid =
        invoice.type === 'CASH' ? Decimal.max(new Decimal(0), paid.minus(returnTotal)) : paid
      const newBalance =
        invoice.type === 'CREDIT'
          ? Decimal.max(new Decimal(0), newTotal.minus(newPaid))
          : new Decimal(0)

      if (invoice.type === 'CREDIT' && invoice.customerId) {
        await tx.customer.update({
          where: { id: invoice.customerId },
          data: { balance: { decrement: returnTotal.toNumber() } },
        })
      }

      if (invoice.type === 'CASH' && returnTotal.gt(0)) {
        await tx.salesPayment.create({
          data: {
            invoiceId,
            method: 'REFUND',
            amount: returnTotal,
          },
        })
      }

      const allReturned = remainingLines.length === 0 || isFullReturn

      await tx.salesInvoice.update({
        where: { id: invoiceId },
        data: {
          subtotal: newSubtotal,
          discount: remainingDiscountValue,
          tax: allReturned ? new Decimal(0) : newTax,
          netOfTax: allReturned ? new Decimal(0) : newNetOfTax,
          total: allReturned ? new Decimal(0) : newTotal,
          amountPaid: newPaid,
          balance: newBalance,
          status: allReturned ? 'RETURNED' : 'CONFIRMED',
          notes: invoice.notes
            ? `${invoice.notes}\n[مرتجع ${returnTotal.toFixed(2)} ج.م]`
            : `[مرتجع ${returnTotal.toFixed(2)} ج.م]`,
        },
      })

      await logAudit(tx, {
        userId,
        action: allReturned ? 'RETURN_FULL' : 'RETURN_PARTIAL',
        entityType: 'SALES_INVOICE',
        entityId: invoiceId,
        details: {
          invoiceNumber: invoice.invoiceNumber,
          amount: returnTotal.toNumber(),
          items: returnItems,
        },
      })

      if (returnTotal.gt(0)) {
        await enqueueEtaDocument(tx, invoiceId, 'RETURN', {
          salesInvoiceId: invoiceId,
          returnAmount: returnTotal.toNumber(),
          documentType: 'RETURN',
        })
      }
    },
  )

  return getSalesInvoiceById(invoiceId)
}

export async function returnInvoice(invoiceId: string, userId: string) {
  const invoice = await prisma.salesInvoice.findFirst({
    where: { id: invoiceId, isActive: true },
    include: { items: { include: { item: true } } },
  })

  if (!invoice) throw new Error('INVOICE_NOT_FOUND')
  if (invoice.status !== 'CONFIRMED') {
    const err = new Error('ONLY_CONFIRMED_CAN_BE_RETURNED')
    ;(err as Error & { statusCode: number }).statusCode = 400
    throw err
  }

  const whId = invoice.warehouseId
    ? invoice.warehouseId
    : (await ensureDefaultWarehouse(prisma)).id

  const cashPaid = new Decimal(invoice.amountPaid.toString())

  await prisma.$transaction(async (tx) => {
    for (const line of invoice.items) {
      const qty = new Decimal(line.quantity.toString()).toNumber()
      await returnStockForLine(tx, {
        line,
        warehouseId: whId,
        qty,
        userId,
        notes: `إرجاع فاتورة: ${invoice.invoiceNumber}`,
      })
    }

    if (invoice.type === 'CREDIT' && invoice.customerId) {
      await tx.customer.update({
        where: { id: invoice.customerId },
        data: { balance: { decrement: new Decimal(invoice.total.toString()).toNumber() } },
      })
    }

    if (invoice.type === 'CASH' && cashPaid.gt(0)) {
      await tx.salesPayment.create({
        data: { invoiceId, method: 'REFUND', amount: cashPaid },
      })
    }

    await tx.salesInvoice.update({
      where: { id: invoiceId },
      data: { status: 'RETURNED', amountPaid: new Decimal(0), balance: new Decimal(0) },
    })

    await logAudit(tx, {
      userId,
      action: 'RETURN_FULL',
      entityType: 'SALES_INVOICE',
      entityId: invoiceId,
      details: { invoiceNumber: invoice.invoiceNumber, total: Number(invoice.total) },
    })
    await enqueueEtaDocument(tx, invoiceId, 'RETURN', {
      salesInvoiceId: invoiceId,
      returnAmount: Number(invoice.total),
      documentType: 'RETURN',
    })
  })

  return getSalesInvoiceById(invoiceId)
}
