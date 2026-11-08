import { Prisma } from '@prisma/client'
import { CreateCustomerInput, UpdateCustomerInput } from '../validators/customer.validator'
import { notFoundError, isPlausibleId } from '../utils/apiError'
import { logger } from '../utils/logger'
import { logAudit } from './audit.service'
import { prisma } from '../db/prisma'

export async function getCustomers(params: {
  search?: string
  type?: string
  page?: number
  pageSize?: number
}) {
  const { search, type, page = 1, pageSize = 20 } = params
  const skip = (page - 1) * pageSize
  const where: Record<string, unknown> = { isActive: true }
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { phone: { contains: search } },
    ]
  }
  if (type) where.type = type

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where: where as Prisma.CustomerWhereInput,
      skip,
      take: pageSize,
      orderBy: { name: 'asc' },
    }),
    prisma.customer.count({ where: where as Prisma.CustomerWhereInput }),
  ])
  return { customers, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
}

export async function getCustomerById(id: string) {
  return prisma.customer.findFirst({ where: { id, isActive: true } })
}

export async function createCustomer(data: CreateCustomerInput) {
  return prisma.customer.create({ data })
}

export async function updateCustomer(id: string, data: UpdateCustomerInput) {
  return prisma.customer.update({ where: { id }, data })
}

export async function softDeleteCustomer(id: string) {
  if (!isPlausibleId(id)) throw notFoundError()
  const result = await prisma.customer.updateMany({
    where: { id, isActive: true },
    data: { isActive: false },
  })
  if (result.count === 0) throw notFoundError()
}

export async function getCustomerStatement(id: string, from?: string, to?: string) {
  const dateFilter: Record<string, unknown> = {}
  if (from) dateFilter.gte = new Date(from)
  if (to) dateFilter.lte = new Date(to)

  const [invoices, vouchers] = await Promise.all([
    prisma.salesInvoice.findMany({
      where: {
        customerId: id,
        isActive: true,
        status: 'CONFIRMED',
        ...(from || to ? { createdAt: dateFilter } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, invoiceNumber: true, createdAt: true,
        total: true, amountPaid: true, balance: true, currency: true, type: true,
      },
    }),
    prisma.paymentVoucher.findMany({
      where: {
        entityType: 'CUSTOMER',
        entityId: id,
        ...(from || to ? { createdAt: dateFilter } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, voucherNumber: true, createdAt: true, amount: true, currency: true, type: true, description: true },
    }),
  ])

  const customer = await getCustomerById(id)
  return { customer, invoices, vouchers }
}

const BALANCE_EPS = 0.01

/** Ledger balance from CREDIT invoices + receipt vouchers (matches runtime balance rules). */
export async function computeCustomerBalance(customerId: string): Promise<number> {
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
  const fromInvoices = Number(invoiceAgg._sum.total ?? 0)
  const receipts = Number(receiptAgg._sum.amount ?? 0)
  return fromInvoices - receipts
}

export async function getCustomerReconcile(id: string) {
  if (!isPlausibleId(id)) throw notFoundError()
  const customer = await getCustomerById(id)
  if (!customer) throw notFoundError()
  const computedBalance = await computeCustomerBalance(id)
  const storedBalance = Number(customer.balance)
  const difference = storedBalance - computedBalance
  return {
    customerId: id,
    customerName: customer.name,
    storedBalance,
    computedBalance,
    difference,
    inSync: Math.abs(difference) <= BALANCE_EPS,
  }
}

export async function applyCustomerReconcile(id: string, userId: string) {
  const snapshot = await getCustomerReconcile(id)
  if (snapshot.inSync) {
    return { ...snapshot, adjusted: false }
  }
  await prisma.$transaction(async (tx) => {
    await tx.customer.update({
      where: { id },
      data: { balance: snapshot.computedBalance },
    })
    await logAudit(tx, {
      userId,
      action: 'RECONCILE_BALANCE',
      entityType: 'CUSTOMER',
      entityId: id,
      details: {
        from: snapshot.storedBalance,
        to: snapshot.computedBalance,
      },
    })
  })
  logger.info('[reconcile] customer balance corrected', {
    customerId: id,
    userId,
    from: snapshot.storedBalance,
    to: snapshot.computedBalance,
  })
  return {
    ...snapshot,
    storedBalance: snapshot.computedBalance,
    difference: 0,
    inSync: true,
    adjusted: true,
  }
}

export async function listCustomersReconcileOutOfSync() {
  const customers = await prisma.customer.findMany({
    where: { isActive: true },
    select: { id: true, name: true, balance: true },
    orderBy: { name: 'asc' },
  })
  const rows = []
  for (const c of customers) {
    const computed = await computeCustomerBalance(c.id)
    const stored = Number(c.balance)
    const difference = stored - computed
    if (Math.abs(difference) > BALANCE_EPS) {
      rows.push({
        customerId: c.id,
        customerName: c.name,
        storedBalance: stored,
        computedBalance: computed,
        difference,
      })
    }
  }
  return { count: rows.length, customers: rows }
}
