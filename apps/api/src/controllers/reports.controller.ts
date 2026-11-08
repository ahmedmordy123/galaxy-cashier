import { Request, Response } from 'express'
import {
  getTodaySummary,
  getSalesReport,
  getPurchasesReport,
  getProfitReport,
  getInventoryReport,
  getCustomerStatement,
  getSupplierStatement,
  getProductMovementReport,
  getExpenseAnalysis,
  getInventoryAsOf,
  getPeriodCompare,
} from '../services/reports.service'

export async function todaySummaryHandler(req: Request, res: Response) {
  try {
    const data = await getTodaySummary()
    if (req.user?.role === 'CASHIER') {
      const { cogsTotalEGP: _c, grossProfitEGP: _g, netProfitEGP: _n, ...rest } = data as Record<string, unknown>
      return res.json({ success: true, data: rest })
    }
    res.json({ success: true, data })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to get today summary'
    res.status(500).json({ success: false, error: msg })
  }
}

export async function salesReport(req: Request, res: Response) {
  try {
    const { from, to, customerId, status } = req.query
    const data = await getSalesReport({
      from: (from as string) ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
      to: (to as string) ?? new Date().toISOString().slice(0, 10),
      customerId: customerId as string | undefined,
      status: status as string | undefined,
    })
    res.json({ success: true, data })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to generate sales report'
    res.status(500).json({ success: false, error: msg })
  }
}

export async function purchasesReport(req: Request, res: Response) {
  try {
    const { from, to, supplierId } = req.query
    const data = await getPurchasesReport({
      from: (from as string) ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
      to: (to as string) ?? new Date().toISOString().slice(0, 10),
      supplierId: supplierId as string | undefined,
    })
    res.json({ success: true, data })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to generate purchases report'
    res.status(500).json({ success: false, error: msg })
  }
}

export async function profitReport(req: Request, res: Response) {
  try {
    const { from, to } = req.query
    if (!from || !to) {
      return res.status(400).json({ success: false, error: 'يجب تحديد تاريخ البداية والنهاية' })
    }
    const data = await getProfitReport({
      from: from as string,
      to: to as string,
    })
    res.json({ success: true, data })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to generate profit report'
    res.status(500).json({ success: false, error: msg })
  }
}

export async function inventoryReport(_req: Request, res: Response) {
  try {
    const data = await getInventoryReport()
    res.json({ success: true, data })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to generate inventory report'
    res.status(500).json({ success: false, error: msg })
  }
}

export async function customerStatement(req: Request, res: Response) {
  try {
    const { from, to } = req.query
    const data = await getCustomerStatement({
      customerId: req.params.id,
      from: from as string | undefined,
      to: to as string | undefined,
    })
    res.json({ success: true, data })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to generate customer statement'
    if (msg === 'CUSTOMER_NOT_FOUND') {
      return res.status(404).json({ success: false, error: 'العميل غير موجود' })
    }
    res.status(500).json({ success: false, error: msg })
  }
}

export async function productMovementReport(req: Request, res: Response) {
  try {
    const { from, to, slowDays, limit } = req.query
    const data = await getProductMovementReport({
      from: (from as string) ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
      to: (to as string) ?? new Date().toISOString().slice(0, 10),
      slowDays: slowDays ? Number(slowDays) : 30,
      limit: limit ? Number(limit) : 10,
    })
    res.json({ success: true, data })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to generate product movement report'
    res.status(500).json({ success: false, error: msg })
  }
}

export async function expenseAnalysisReport(req: Request, res: Response) {
  try {
    const { from, to } = req.query
    const data = await getExpenseAnalysis({
      from: (from as string) ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
      to: (to as string) ?? new Date().toISOString().slice(0, 10),
    })
    res.json({ success: true, data })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to generate expense analysis'
    res.status(500).json({ success: false, error: msg })
  }
}

export async function inventoryAsOfReport(req: Request, res: Response) {
  try {
    const date = (req.query.date as string) ?? new Date().toISOString().slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, error: 'تاريخ غير صالح' })
    }
    const data = await getInventoryAsOf(date)
    res.json({ success: true, data })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to generate inventory as-of report'
    res.status(500).json({ success: false, error: msg })
  }
}

export async function periodCompareReport(req: Request, res: Response) {
  try {
    const { fromA, toA, fromB, toB } = req.query
    if (!fromA || !toA || !fromB || !toB) {
      return res.status(400).json({ success: false, error: 'يجب تحديد الفترتين للمقارنة' })
    }
    const data = await getPeriodCompare({
      fromA: fromA as string,
      toA: toA as string,
      fromB: fromB as string,
      toB: toB as string,
    })
    if (req.user?.role === 'VIEWER') {
      const { grossProfit: _g, ...diffRest } = data.diff
      const strip = (p: typeof data.periodA) => {
        const { grossProfit: _gp, ...rest } = p
        return rest
      }
      return res.json({
        success: true,
        data: { periodA: strip(data.periodA), periodB: strip(data.periodB), diff: diffRest },
      })
    }
    res.json({ success: true, data })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to generate period compare'
    res.status(500).json({ success: false, error: msg })
  }
}

export async function supplierStatement(req: Request, res: Response) {
  try {
    const { from, to } = req.query
    const data = await getSupplierStatement({
      supplierId: req.params.id,
      from: from as string | undefined,
      to: to as string | undefined,
    })
    res.json({ success: true, data })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to generate supplier statement'
    if (msg === 'SUPPLIER_NOT_FOUND') {
      return res.status(404).json({ success: false, error: 'المورد غير موجود' })
    }
    res.status(500).json({ success: false, error: msg })
  }
}
