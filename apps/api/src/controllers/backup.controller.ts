import { Request, Response } from 'express'
import fs from 'fs'
import { prisma } from '../db/prisma'
import {
  createDatabaseBackup,
  getAutoBackupConfig,
  listBackupFiles,
  resolveDbPath,
  restoreFromBackupFile,
  runScheduledBackupIfDue,
} from '../services/backup.service'
import { sendRouteError } from '../utils/apiError'
import { logAudit } from '../services/audit.service'

export async function createBackup(_req: Request, res: Response) {
  try {
    const data = await createDatabaseBackup('manual')
    res.json({ success: true, data })
  } catch (e: unknown) {
    return sendRouteError(res, e, 'فشل إنشاء النسخة الاحتياطية')
  }
}

export async function downloadBackup(_req: Request, res: Response) {
  try {
    const dbPath = resolveDbPath()
    const stamp = new Date().toISOString().slice(0, 10)
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename="cashier-${stamp}.db"`)
    fs.createReadStream(dbPath).pipe(res)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Download failed'
    res.status(500).json({ success: false, error: msg })
  }
}

export async function listBackups(_req: Request, res: Response) {
  try {
    const files = await listBackupFiles()
    res.json({ success: true, data: files })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'List failed'
    res.status(500).json({ success: false, error: msg })
  }
}

export async function backupAutoStatus(_req: Request, res: Response) {
  try {
    const cfg = await getAutoBackupConfig()
    let nextDueAt: string | null = null
    if (cfg.enabled && cfg.lastAt) {
      const lastMs = new Date(cfg.lastAt).getTime()
      if (Number.isFinite(lastMs)) {
        nextDueAt = new Date(lastMs + cfg.intervalHours * 3600 * 1000).toISOString()
      }
    } else if (cfg.enabled) {
      nextDueAt = new Date().toISOString()
    }
    res.json({ success: true, data: { ...cfg, nextDueAt } })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Status failed'
    res.status(500).json({ success: false, error: msg })
  }
}

export async function runAutoBackupNow(_req: Request, res: Response) {
  try {
    const result = await runScheduledBackupIfDue(true)
    if (!result.ran) {
      return res.status(400).json({ success: false, error: 'لم يتم إنشاء نسخة' })
    }
    res.json({ success: true, data: { path: result.file } })
  } catch (e: unknown) {
    return sendRouteError(res, e, 'فشل النسخ الاحتياطي التلقائي')
  }
}

export async function restoreBackup(req: Request, res: Response) {
  try {
    const fileName = String(req.body?.fileName || '').trim()
    const data = await restoreFromBackupFile(fileName)
    await logAudit(prisma, {
      userId: req.user!.id,
      action: 'BACKUP_RESTORE',
      entityType: 'BACKUP',
      entityId: fileName,
    })
    res.json({
      success: true,
      data: {
        ...data,
        message: 'تمت الاستعادة وتطبيق البيانات فوراً.',
      },
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Restore failed'
    if (msg === 'INVALID_FILE_NAME') {
      return res.status(400).json({ success: false, error: 'اسم ملف غير صالح' })
    }
    if (msg === 'BACKUP_NOT_FOUND') {
      return res.status(404).json({ success: false, error: 'النسخة غير موجودة' })
    }
    res.status(500).json({ success: false, error: msg })
  }
}
