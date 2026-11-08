import fs from 'fs'
import path from 'path'

import { assertEnoughDiskSpace, fileSizeSafe } from '../utils/diskSpace'
import { disconnectPrisma, prisma, reconnectPrisma } from '../db/prisma'
import {
  backupsRootDir,
  defaultBackupsDir,
  isBackupDirectoryAvailable,
  liveDbPath,
  migrateLegacyBackupsIfNeeded,
  migrateLiveDbFromAppDataIfNeeded,
  sanitizeBackupDirectory,
  writeBackupPathConfig,
} from '../utils/dataPaths'

export function resolveDbPath(): string {
  const url = (process.env.DATABASE_URL || '').replace(/^["']|["']$/g, '')
  const candidates: string[] = []

  if (url.startsWith('file:')) {
    const raw = url.slice('file:'.length)
    if (path.isAbsolute(raw)) {
      candidates.push(raw)
    } else {
      candidates.push(path.resolve(process.cwd(), raw))
      candidates.push(path.resolve(process.cwd(), '..', '..', 'data', 'cashier.db'))
      candidates.push(path.resolve(process.cwd(), '..', '..', '..', 'data', 'cashier.db'))
    }
  }

  try {
    candidates.push(migrateLiveDbFromAppDataIfNeeded())
  } catch {
    candidates.push(liveDbPath())
  }

  candidates.push(
    liveDbPath(),
    path.resolve(process.cwd(), 'data', 'cashier.db'),
    path.resolve(process.cwd(), '..', 'data', 'cashier.db'),
    path.resolve(process.cwd(), '..', '..', 'data', 'cashier.db'),
    path.join(process.env.APPDATA || '', 'CASR', 'cashier.db'),
    path.join(process.env.APPDATA || '', 'IMS-Pro', 'cashier.db'),
  )

  let dir = process.cwd()
  for (let i = 0; i < 6; i++) {
    candidates.push(path.join(dir, 'data', 'cashier.db'))
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c
  }

  throw new Error(
    `قاعدة البيانات غير موجودة. جرّبنا: ${candidates.filter(Boolean).slice(0, 5).join(' | ')}`,
  )
}

async function getSetting(key: string, fallback: string): Promise<string> {
  const row = await prisma.settings.findUnique({ where: { key } })
  return row?.value?.trim() ? row.value.trim() : fallback
}

/** Resolve active backup folder (custom setting or default Documents\CASR-Backups). */
export async function backupsDir(): Promise<string> {
  migrateLegacyBackupsIfNeeded()
  const custom = sanitizeBackupDirectory(await getSetting('backup_directory', ''))
  const dir = custom || backupsRootDir()
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export async function syncBackupPathConfigFromSettings(): Promise<void> {
  const custom = sanitizeBackupDirectory(await getSetting('backup_directory', ''))
  const secondary = sanitizeBackupDirectory(await getSetting('backup_directory_secondary', ''))
  const onExit = (await getSetting('backup_on_exit', 'true')) !== 'false'
  writeBackupPathConfig({
    directory: custom || defaultBackupsDir(),
    secondaryDirectory: secondary,
    onExit,
  })
}

/** Best-effort mirror copy; never throws (USB may be absent). */
export function mirrorBackupFile(srcFile: string, secondaryDir: string | null | undefined, fileName: string): string | null {
  const dir = sanitizeBackupDirectory(secondaryDir || '')
  if (!dir) return null
  try {
    if (!fs.existsSync(path.parse(dir).root)) return null
    fs.mkdirSync(dir, { recursive: true })
    assertEnoughDiskSpace(dir, fileSizeSafe(srcFile))
    const dest = path.join(dir, fileName)
    fs.copyFileSync(srcFile, dest)
    return dest
  } catch {
    return null
  }
}

export async function getAutoBackupConfig() {
  const enabled = (await getSetting('auto_backup_enabled', 'true')) === 'true'
  const intervalHours = Math.max(1, Math.min(168, Number(await getSetting('auto_backup_interval_hours', '24')) || 24))
  const keepCount = Math.max(5, Math.min(200, Number(await getSetting('auto_backup_keep_count', '30')) || 30))
  const lastAt = await getSetting('auto_backup_last_at', '')
  const directory = await backupsDir()
  const secondaryDirectory = sanitizeBackupDirectory(await getSetting('backup_directory_secondary', ''))
  const onExit = (await getSetting('backup_on_exit', 'true')) !== 'false'
  const defaultDirectory = defaultBackupsDir()
  const secondaryConfigured = Boolean(secondaryDirectory)
  const secondaryAvailable = secondaryConfigured && isBackupDirectoryAvailable(secondaryDirectory)
  const { detectGoogleDrive, isPathUnderGoogleDrive } = await import('../utils/googleDrive')
  const googleDrive = detectGoogleDrive()
  return {
    enabled,
    intervalHours,
    keepCount,
    lastAt,
    directory,
    secondaryDirectory,
    secondaryConfigured,
    secondaryAvailable,
    secondaryWarning: !secondaryConfigured
      ? 'لم يُضبط مسار النسخة الثانية (فلاشة/خارجي) — النسخ الأساسي فقط.'
      : !secondaryAvailable
        ? 'مسار النسخة الثانية غير متاح الآن (الفلاشة غير متصلة أو المسار غير قابل للكتابة).'
        : null,
    onExit,
    defaultDirectory,
    pathLooksLikeGoogleDrive: isPathUnderGoogleDrive(directory, googleDrive.roots),
    googleDrive,
  }
}

function stampForFile(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

export async function pruneOldBackups(keepCount: number): Promise<number> {
  const dir = await backupsDir()
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.db') && !f.startsWith('pre-restore-'))
    .map((f) => {
      const full = path.join(dir, f)
      return { name: f, full, mtime: fs.statSync(full).mtimeMs }
    })
    .sort((a, b) => b.mtime - a.mtime)

  let removed = 0
  for (let i = keepCount; i < files.length; i++) {
    try {
      fs.unlinkSync(files[i].full)
      removed++
    } catch {
      /* ignore */
    }
  }
  return removed
}

export async function createDatabaseBackup(kind: 'manual' | 'auto' | 'exit' = 'manual') {
  const dbPath = resolveDbPath()
  const destDir = await backupsDir()
  assertEnoughDiskSpace(destDir, fileSizeSafe(dbPath))
  const prefix =
    kind === 'auto' ? 'cashier-auto-' : kind === 'exit' ? 'cashier-exit-' : 'cashier-backup-'
  const fileName = `${prefix}${stampForFile()}.db`
  const dest = path.join(destDir, fileName)
  fs.copyFileSync(dbPath, dest)
  const stat = fs.statSync(dest)
  await syncBackupPathConfigFromSettings().catch(() => {})
  const secondary = sanitizeBackupDirectory(await getSetting('backup_directory_secondary', ''))
  const mirroredTo = mirrorBackupFile(dest, secondary, fileName)
  return {
    path: dest,
    name: path.basename(dest),
    source: dbPath,
    size: stat.size,
    createdAt: new Date().toISOString(),
    kind,
    directory: destDir,
    secondaryDirectory: secondary,
    mirroredTo,
  }
}

export async function runScheduledBackupIfDue(force = false): Promise<{ ran: boolean; file?: string; reason?: string }> {
  const cfg = await getAutoBackupConfig()
  if (!cfg.enabled && !force) {
    return { ran: false, reason: 'disabled' }
  }

  const now = Date.now()
  if (!force && cfg.lastAt) {
    const lastMs = new Date(cfg.lastAt).getTime()
    if (Number.isFinite(lastMs) && now - lastMs < cfg.intervalHours * 3600 * 1000) {
      return { ran: false, reason: 'not_due' }
    }
  }

  const backup = await createDatabaseBackup('auto')
  await prisma.settings.upsert({
    where: { key: 'auto_backup_last_at' },
    create: { key: 'auto_backup_last_at', value: backup.createdAt, description: 'Last automatic DB backup (ISO)' },
    update: { value: backup.createdAt },
  })
  await pruneOldBackups(cfg.keepCount)
  return { ran: true, file: backup.path }
}

export async function listBackupFiles() {
  const documents = await backupsDir()
  return fs
    .readdirSync(documents)
    .filter((f) => f.endsWith('.db'))
    .map((f) => {
      const full = path.join(documents, f)
      const st = fs.statSync(full)
      return {
        name: f,
        path: full,
        size: st.size,
        createdAt: st.mtime.toISOString(),
        kind: f.startsWith('cashier-auto-')
          ? 'auto'
          : f.startsWith('cashier-exit-')
            ? 'exit'
            : f.startsWith('pre-restore-')
              ? 'safety'
              : 'manual',
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function restoreFromBackupFile(fileName: string) {
  if (!fileName.endsWith('.db') || fileName.includes('..') || /[/\\]/.test(fileName)) {
    throw new Error('INVALID_FILE_NAME')
  }
  const dir = await backupsDir()
  const src = path.join(dir, fileName)
  if (!fs.existsSync(src)) throw new Error('BACKUP_NOT_FOUND')

  const dbPath = resolveDbPath()
  const safety = path.join(dir, `pre-restore-${stampForFile()}.db`)

  // Release SQLite file lock, swap DB on disk, then open a fresh Prisma client
  // so subsequent API calls see restored data without restarting the process.
  await disconnectPrisma()
  try {
    fs.copyFileSync(dbPath, safety)
    fs.copyFileSync(src, dbPath)
  } catch (e) {
    await reconnectPrisma().catch(() => {})
    throw e
  }
  await reconnectPrisma()

  return { restoredFrom: src, safetyBackup: safety, reconnected: true }
}
