import { Request, Response } from 'express'
import {
  getEtaConfig,
  getEtaDocumentForInvoice,
  listEtaDocuments,
  processPendingEtaDocuments,
  retryEtaDocument,
} from '../services/eta.service'

export async function etaStatus(_req: Request, res: Response) {
  try {
    const cfg = await getEtaConfig()
    const pending = await listEtaDocuments({ status: 'PENDING', limit: 1 })
    const retry = await listEtaDocuments({ status: 'RETRY', limit: 1 })
    res.json({
      success: true,
      data: {
        ...cfg,
        pendingCount: pending.total,
        retryCount: retry.total,
      },
    })
  } catch {
    res.status(500).json({ success: false, error: 'فشل حالة ETA' })
  }
}

export async function etaForInvoice(req: Request, res: Response) {
  try {
    const doc = await getEtaDocumentForInvoice(req.params.invoiceId)
    res.json({ success: true, data: doc })
  } catch {
    res.status(500).json({ success: false, error: 'فشل حالة ETA للفاتورة' })
  }
}

export async function listEta(req: Request, res: Response) {
  try {
    const { status, page, limit } = req.query
    const data = await listEtaDocuments({
      status: status as string | undefined,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 30,
    })
    res.json({ success: true, data })
  } catch {
    res.status(500).json({ success: false, error: 'فشل قائمة ETA' })
  }
}

export async function runEtaWorker(_req: Request, res: Response) {
  try {
    const result = await processPendingEtaDocuments(20)
    res.json({ success: true, data: result })
  } catch {
    res.status(500).json({ success: false, error: 'فشل معالجة ETA' })
  }
}

export async function retryEta(req: Request, res: Response) {
  try {
    const doc = await retryEtaDocument(req.params.id)
    res.json({ success: true, data: doc })
  } catch {
    res.status(404).json({ success: false, error: 'المستند غير موجود' })
  }
}
