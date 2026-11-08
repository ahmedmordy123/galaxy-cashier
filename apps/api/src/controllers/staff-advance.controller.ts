import { Request, Response } from 'express'
import { createStaffAdvanceSchema } from '../validators/staff-advance.validator'
import {
  listStaffAdvances,
  createStaffAdvance,
  deleteStaffAdvance,
  getMonthlySummary,
  getEmployeeLedger,
  listAdvanceEmployees,
} from '../services/staff-advance.service'
import { sendRouteError } from '../utils/apiError'

function currentYearMonth(query: Request['query']): { year: number; month: number } {
  const now = new Date()
  const year = query.year ? Number(query.year) : now.getFullYear()
  const month = query.month ? Number(query.month) : now.getMonth() + 1
  return { year, month }
}

export async function listEmployeesHandler(_req: Request, res: Response) {
  try {
    const data = await listAdvanceEmployees()
    return res.json({ success: true, data })
  } catch (e) {
    return sendRouteError(res, e, 'فشل تحميل الموظفين')
  }
}

export async function listAdvancesHandler(req: Request, res: Response) {
  try {
    const { page, limit, employeeId, from, to } = req.query
    const data = await listStaffAdvances({
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
      employeeId: employeeId as string | undefined,
      from: from as string | undefined,
      to: to as string | undefined,
    })
    return res.json({ success: true, data })
  } catch (e) {
    return sendRouteError(res, e, 'فشل تحميل السلف')
  }
}

export async function summaryHandler(req: Request, res: Response) {
  try {
    const { year, month } = currentYearMonth(req.query)
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ success: false, error: 'شهر غير صالح' })
    }
    const data = await getMonthlySummary(year, month)
    return res.json({ success: true, data })
  } catch (e) {
    return sendRouteError(res, e, 'فشل تحميل ملخص السلف')
  }
}

export async function ledgerHandler(req: Request, res: Response) {
  try {
    const { year, month } = currentYearMonth(req.query)
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ success: false, error: 'شهر غير صالح' })
    }
    const data = await getEmployeeLedger(req.params.id, year, month)
    return res.json({ success: true, data })
  } catch (e) {
    return sendRouteError(res, e, 'فشل تحميل كشف الموظف')
  }
}

export async function createAdvanceHandler(req: Request, res: Response) {
  try {
    const parsed = createStaffAdvanceSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: 'بيانات غير صحيحة',
        details: parsed.error.flatten().fieldErrors,
      })
    }
    const data = await createStaffAdvance(parsed.data, req.user!.id)
    return res.status(201).json({ success: true, data })
  } catch (e) {
    return sendRouteError(res, e, 'فشل تسجيل السلفة')
  }
}

export async function deleteAdvanceHandler(req: Request, res: Response) {
  try {
    await deleteStaffAdvance(req.params.id)
    return res.json({ success: true })
  } catch (e) {
    return sendRouteError(res, e, 'فشل إلغاء السلفة')
  }
}
