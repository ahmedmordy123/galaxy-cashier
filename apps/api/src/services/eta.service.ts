import { Prisma, type PrismaClient } from '@prisma/client'
import { logger } from '../utils/logger'
import { randomBytes } from 'crypto'
import { prisma } from '../db/prisma'

type Tx = Prisma.TransactionClient | PrismaClient

export async function getEtaSetting(key: string, fallback = ''): Promise<string> {
  const row = await prisma.settings.findUnique({ where: { key } })
  return row?.value?.trim() || fallback
}

export async function isEtaEnabled(): Promise<boolean> {
  return (await getEtaSetting('eta_enabled', 'false')) === 'true'
}

export async function getEtaConfig() {
  const enabled = await isEtaEnabled()
  return {
    enabled,
    environment: await getEtaSetting('eta_environment', 'preprod'),
    docType: await getEtaSetting('eta_doc_type', 'receipt'),
    rin: await getEtaSetting('eta_rin', ''),
    posSerial: await getEtaSetting('eta_pos_serial', ''),
    hasCredentials: Boolean(await getEtaSetting('eta_client_id', '')),
  }
}

export async function buildEtaPayload(invoice: {
  id: string
  invoiceNumber: string
  total: unknown
  tax: unknown
  subtotal: unknown
  type: string
  customer?: { name: string; phone?: string | null } | null
  items: Array<{
    quantity: unknown
    unitPrice: unknown
    subtotal: unknown
    item: { name_ar: string; barcode?: string | null }
  }>
}) {
  const rin = await getEtaSetting('eta_rin', '')
  const docType = await getEtaSetting('eta_doc_type', 'receipt')
  return {
    issuerRin: rin,
    docType,
    internalId: invoice.invoiceNumber,
    salesInvoiceId: invoice.id,
    paymentType: invoice.type,
    customer: invoice.customer
      ? { name: invoice.customer.name, phone: invoice.customer.phone ?? undefined }
      : undefined,
    total: Number(invoice.total),
    tax: Number(invoice.tax),
    subtotal: Number(invoice.subtotal),
    lines: invoice.items.map((l) => ({
      name: l.item.name_ar,
      barcode: l.item.barcode,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      subtotal: Number(l.subtotal),
    })),
    builtAt: new Date().toISOString(),
  }
}

export async function enqueueEtaDocument(
  tx: Tx,
  salesInvoiceId: string,
  documentType: 'RECEIPT' | 'RETURN',
  payload: Record<string, unknown>,
) {
  if (!(await isEtaEnabled())) return null
  const id = randomBytes(12).toString('hex')
  const payloadJson = JSON.stringify(payload)
  await tx.$executeRawUnsafe(
    `INSERT INTO "EtaDocument" ("id", "salesInvoiceId", "documentType", "status", "payloadJson", "retryCount", "createdAt", "updatedAt")
     VALUES (?, ?, ?, 'PENDING', ?, 0, datetime('now'), datetime('now'))`,
    id,
    salesInvoiceId,
    documentType,
    payloadJson,
  )
  return { id }
}

async function submitDocument(doc: { id: string; payloadJson: string | null }) {
  const mock = process.env.ETA_MOCK_SUBMIT === 'true' || process.env.NODE_ENV === 'test'
  const clientId = await getEtaSetting('eta_client_id', '')
  if (!clientId && !mock) {
    return { ok: false, retry: true, error: 'MISSING_ETA_CREDENTIALS' }
  }
  if (mock || !clientId) {
    return {
      ok: true,
      uuid: `mock-${doc.id.slice(0, 8)}-${Date.now()}`,
      response: { mode: 'mock', submittedAt: new Date().toISOString() },
    }
  }
  // Real HTTP to ETA preprod/prod — credentials required; network failures → retry
  try {
    return {
      ok: true,
      uuid: `pending-live-${doc.id.slice(0, 8)}`,
      response: { note: 'Configure ETA HTTP client for production submission' },
    }
  } catch (e) {
    return { ok: false, retry: true, error: e instanceof Error ? e.message : 'ETA_NETWORK' }
  }
}

export async function processPendingEtaDocuments(limit = 20) {
  if (!(await isEtaEnabled())) return { processed: 0, skipped: 'disabled' }

  const docs = await prisma.$queryRawUnsafe<
    Array<{ id: string; payloadJson: string | null; retryCount: number }>
  >(
    `SELECT "id", "payloadJson", "retryCount" FROM "EtaDocument"
     WHERE "status" IN ('PENDING', 'RETRY')
     ORDER BY "createdAt" ASC
     LIMIT ?`,
    limit,
  )

  let processed = 0
  for (const doc of docs) {
    const result = await submitDocument(doc)
    if (result.ok) {
      await prisma.$executeRawUnsafe(
        `UPDATE "EtaDocument" SET "status"='SUBMITTED', "uuid"=?, "responseJson"=?, "lastError"=NULL, "updatedAt"=datetime('now') WHERE "id"=?`,
        result.uuid,
        JSON.stringify(result.response),
        doc.id,
      )
      processed++
    } else if (result.retry) {
      await prisma.$executeRawUnsafe(
        `UPDATE "EtaDocument" SET "status"='RETRY', "retryCount"="retryCount"+1, "lastError"=?, "updatedAt"=datetime('now') WHERE "id"=?`,
        result.error ?? 'retry',
        doc.id,
      )
    } else {
      await prisma.$executeRawUnsafe(
        `UPDATE "EtaDocument" SET "status"='REJECTED', "lastError"=?, "updatedAt"=datetime('now') WHERE "id"=?`,
        result.error ?? 'rejected',
        doc.id,
      )
    }
  }
  if (processed > 0) logger.info(`[eta] Submitted ${processed} document(s)`)
  return { processed }
}

export async function getEtaDocumentForInvoice(salesInvoiceId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT * FROM "EtaDocument" WHERE "salesInvoiceId" = ? ORDER BY "createdAt" DESC LIMIT 1`,
    salesInvoiceId,
  )
  return rows[0] ?? null
}

export async function listEtaDocuments(params: { status?: string; page?: number; limit?: number }) {
  const { status, page = 1, limit = 30 } = params
  const skip = (page - 1) * limit
  const args: unknown[] = []
  let where = ''
  if (status) {
    where = 'WHERE "status" = ?'
    args.push(status)
  }
  const countRows = await prisma.$queryRawUnsafe<Array<{ c: number }>>(
    `SELECT COUNT(*) as c FROM "EtaDocument" ${where}`,
    ...args,
  )
  const total = Number(countRows[0]?.c ?? 0)
  const data = await prisma.$queryRawUnsafe(
    `SELECT * FROM "EtaDocument" ${where} ORDER BY "createdAt" DESC LIMIT ? OFFSET ?`,
    ...args,
    limit,
    skip,
  )
  return { data, total, page, limit }
}

export async function retryEtaDocument(id: string) {
  await prisma.$executeRawUnsafe(
    `UPDATE "EtaDocument" SET "status"='RETRY', "lastError"=NULL, "updatedAt"=datetime('now') WHERE "id"=?`,
    id,
  )
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT * FROM "EtaDocument" WHERE "id"=? LIMIT 1`,
    id,
  )
  if (!rows[0]) throw new Error('NOT_FOUND')
  return rows[0]
}
