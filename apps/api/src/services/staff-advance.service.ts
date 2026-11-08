import { Prisma } from '@prisma/client'
import { CreateStaffAdvanceInput } from '../validators/staff-advance.validator'
import { notFoundError, isPlausibleId } from '../utils/apiError'
import { prisma } from '../db/prisma'

function parseLocalDateOnly(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y || !m || !d) return new Date(dateStr)
  return new Date(y, m - 1, d, 12, 0, 0, 0)
}

function localDayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function monthRange(year: number, month: number): { from: Date; to: Date } {
  return {
    from: new Date(year, month - 1, 1, 0, 0, 0, 0),
    to: new Date(year, month, 0, 23, 59, 59, 999),
  }
}

function statusError(message: string, statusCode: number): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number }
  err.statusCode = statusCode
  return err
}

const employeeSelect = { id: true, name: true, username: true, role: true, isActive: true }
const createdBySelect = { id: true, name: true, username: true }

export async function resolveOpenShift(userId: string) {
  const mine = await prisma.cashierShift.findFirst({
    where: { userId, status: 'OPEN' },
    orderBy: { openedAt: 'desc' },
  })
  if (mine) return mine
  return prisma.cashierShift.findFirst({
    where: { status: 'OPEN' },
    orderBy: { openedAt: 'desc' },
  })
}

export async function listAdvanceEmployees() {
  return prisma.user.findMany({
    where: { isActive: true },
    select: employeeSelect,
    orderBy: { name: 'asc' },
  })
}

export async function listStaffAdvances(params: {
  page?: number
  limit?: number
  employeeId?: string
  from?: string
  to?: string
}) {
  const { page = 1, limit = 20, employeeId, from, to } = params
  const skip = (page - 1) * limit
  const where: Prisma.StaffAdvanceWhereInput = { isActive: true }
  if (employeeId) where.employeeId = employeeId
  if (from || to) {
    where.date = {}
    if (from) where.date.gte = parseLocalDateOnly(from)
    if (to) {
      const end = parseLocalDateOnly(to)
      end.setHours(23, 59, 59, 999)
      where.date.lte = end
    }
  }

  const [data, total] = await Promise.all([
    prisma.staffAdvance.findMany({
      where,
      skip,
      take: limit,
      orderBy: { date: 'desc' },
      include: {
        employee: { select: employeeSelect },
        createdBy: { select: createdBySelect },
        shift: { select: { id: true, openedAt: true, status: true } },
      },
    }),
    prisma.staffAdvance.count({ where }),
  ])

  return { data, total, page, limit }
}

export async function createStaffAdvance(input: CreateStaffAdvanceInput, createdById: string) {
  const employee = await prisma.user.findUnique({ where: { id: input.employeeId } })
  if (!employee) throw statusError('EMPLOYEE_NOT_FOUND', 404)
  if (!employee.isActive) throw statusError('EMPLOYEE_INACTIVE', 400)

  const shift = await resolveOpenShift(createdById)
  if (!shift) throw statusError('NO_OPEN_SHIFT', 400)

  return prisma.staffAdvance.create({
    data: {
      employeeId: input.employeeId,
      amount: input.amount,
      currency: input.currency,
      exchangeRate: input.exchangeRate,
      date: parseLocalDateOnly(input.date),
      notes: input.notes || null,
      shiftId: shift.id,
      createdById,
    },
    include: {
      employee: { select: employeeSelect },
      createdBy: { select: createdBySelect },
      shift: { select: { id: true, openedAt: true, status: true } },
    },
  })
}

export async function deleteStaffAdvance(id: string) {
  if (!isPlausibleId(id)) throw notFoundError()
  const existing = await prisma.staffAdvance.findUnique({ where: { id } })
  if (!existing || !existing.isActive) throw notFoundError()
  return prisma.staffAdvance.update({
    where: { id },
    data: { isActive: false },
  })
}

export async function getMonthlySummary(year: number, month: number) {
  const { from, to } = monthRange(year, month)
  const rows = await prisma.staffAdvance.findMany({
    where: { isActive: true, date: { gte: from, lte: to } },
    include: { employee: { select: employeeSelect } },
    orderBy: { date: 'asc' },
  })

  type DayAgg = { date: string; total: number; count: number }
  type EmpAgg = {
    employeeId: string
    name: string
    username: string
    role: string
    total: number
    count: number
    days: DayAgg[]
  }

  const byEmp = new Map<string, EmpAgg>()
  for (const row of rows) {
    const amount = Number(row.amount)
    const day = localDayKey(row.date)
    let emp = byEmp.get(row.employeeId)
    if (!emp) {
      emp = {
        employeeId: row.employeeId,
        name: row.employee.name,
        username: row.employee.username,
        role: row.employee.role,
        total: 0,
        count: 0,
        days: [],
      }
      byEmp.set(row.employeeId, emp)
    }
    emp.total += amount
    emp.count += 1
    let dayRow = emp.days.find((d) => d.date === day)
    if (!dayRow) {
      dayRow = { date: day, total: 0, count: 0 }
      emp.days.push(dayRow)
    }
    dayRow.total += amount
    dayRow.count += 1
  }

  const employees = Array.from(byEmp.values()).sort((a, b) => a.name.localeCompare(b.name, 'ar'))
  const grandTotal = employees.reduce((s, e) => s + e.total, 0)
  return { year, month, employees, grandTotal }
}

export async function getEmployeeLedger(employeeId: string, year: number, month: number) {
  const employee = await prisma.user.findUnique({
    where: { id: employeeId },
    select: employeeSelect,
  })
  if (!employee) throw notFoundError()

  const { from, to } = monthRange(year, month)
  const rows = await prisma.staffAdvance.findMany({
    where: { isActive: true, employeeId, date: { gte: from, lte: to } },
    include: {
      createdBy: { select: createdBySelect },
      shift: { select: { id: true, openedAt: true, status: true } },
    },
    orderBy: { date: 'asc' },
  })

  type DayRow = {
    date: string
    total: number
    count: number
    entries: Array<{
      id: string
      amount: number
      notes: string | null
      createdAt: Date
      createdBy: { id: string; name: string; username: string }
      shift: { id: string; openedAt: Date; status: string }
    }>
  }

  const days: DayRow[] = []
  for (const row of rows) {
    const day = localDayKey(row.date)
    let dayRow = days.find((d) => d.date === day)
    if (!dayRow) {
      dayRow = { date: day, total: 0, count: 0, entries: [] }
      days.push(dayRow)
    }
    const amount = Number(row.amount)
    dayRow.total += amount
    dayRow.count += 1
    dayRow.entries.push({
      id: row.id,
      amount,
      notes: row.notes,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
      shift: row.shift,
    })
  }

  const total = days.reduce((s, d) => s + d.total, 0)
  const count = days.reduce((s, d) => s + d.count, 0)
  return { employee, year, month, total, count, days }
}
