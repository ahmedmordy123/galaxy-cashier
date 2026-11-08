import { Request, Response } from 'express'
import { listAuditLogs } from '../services/audit.service'

export async function getAuditLogs(req: Request, res: Response) {
  try {
    const { page, limit, userId, action, entityType, from, to } = req.query
    const data = await listAuditLogs({
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
      userId: userId as string | undefined,
      action: action as string | undefined,
      entityType: entityType as string | undefined,
      from: from as string | undefined,
      to: to as string | undefined,
    })
    res.json({ success: true, data })
  } catch {
    res.status(500).json({ success: false, error: 'فشل تحميل سجل العمليات' })
  }
}
