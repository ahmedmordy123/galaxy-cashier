import { Prisma, type PrismaClient } from '@prisma/client'
import { randomBytes } from 'crypto'
import { prisma } from '../db/prisma'

type Tx = Prisma.TransactionClient | PrismaClient

function newId(): string {
  return randomBytes(12).toString('hex')
}

export type AuditAction =
  | 'CONFIRM_INVOICE'
  | 'CANCEL_INVOICE'
  | 'RETURN_FULL'
  | 'RETURN_PARTIAL'
  | 'DELETE_ITEM'
  | 'DELETE_CUSTOMER'
  | 'DELETE_SUPPLIER'
  | 'SETTINGS_CHANGE'
  | 'BACKUP_RESTORE'
  | 'RECONCILE_BALANCE'
  | 'SHIFT_REBIND'
  | 'LOGIN_FAILED_LOCK'
  | 'INVOICE_UPDATE'

export async function logAudit(
  tx: Tx,
  entry: {
    userId: string
    action: AuditAction | string
    entityType: string
    entityId?: string | null
    details?: Record<string, unknown>
    ip?: string | null
  },
) {
  const id = newId()
  const detailsJson = entry.details ? JSON.stringify(entry.details) : null
  await tx.$executeRawUnsafe(
    `INSERT INTO "AuditLog" ("id", "userId", "action", "entityType", "entityId", "detailsJson", "ip", "createdAt")
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    id,
    entry.userId,
    entry.action,
    entry.entityType,
    entry.entityId ?? null,
    detailsJson,
    entry.ip ?? null,
  )
}

export async function listAuditLogs(params: {
  page?: number
  limit?: number
  userId?: string
  action?: string
  entityType?: string
  from?: string
  to?: string
}) {
  const { page = 1, limit = 50, userId, action, entityType, from, to } = params
  const skip = (page - 1) * limit
  const clauses: string[] = []
  const args: unknown[] = []
  if (userId) {
    clauses.push(`"userId" = ?`)
    args.push(userId)
  }
  if (action) {
    clauses.push(`"action" = ?`)
    args.push(action)
  }
  if (entityType) {
    clauses.push(`"entityType" = ?`)
    args.push(entityType)
  }
  if (from) {
    clauses.push(`"createdAt" >= ?`)
    args.push(new Date(from).toISOString())
  }
  if (to) {
    clauses.push(`"createdAt" <= ?`)
    args.push(new Date(to).toISOString())
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const countRows = await prisma.$queryRawUnsafe<Array<{ c: number }>>(
    `SELECT COUNT(*) as c FROM "AuditLog" ${where}`,
    ...args,
  )
  const total = Number(countRows[0]?.c ?? 0)
  const data = await prisma.$queryRawUnsafe<
    Array<{
      id: string
      userId: string
      action: string
      entityType: string
      entityId: string | null
      detailsJson: string | null
      ip: string | null
      createdAt: string
      userName: string
      username: string
    }>
  >(
    `SELECT a.*, u.name as userName, u.username as username
     FROM "AuditLog" a
     INNER JOIN "User" u ON u.id = a.userId
     ${where}
     ORDER BY a."createdAt" DESC
     LIMIT ? OFFSET ?`,
    ...args,
    limit,
    skip,
  )
  return {
    data: data.map((row) => ({
      id: row.id,
      userId: row.userId,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      detailsJson: row.detailsJson,
      ip: row.ip,
      createdAt: row.createdAt,
      user: { id: row.userId, name: row.userName, username: row.username },
    })),
    total,
    page,
    limit,
  }
}
