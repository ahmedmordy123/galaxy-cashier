import fs from 'fs'
import path from 'path'

/** User Documents folder (Windows/macOS/Linux). */
export function userDocumentsDir(): string {
  if (process.env.CASR_DOCUMENTS_DIR) {
    return process.env.CASR_DOCUMENTS_DIR
  }
  return path.join(process.env.USERPROFILE || process.env.HOME || process.cwd(), 'Documents')
}

/**
 * Live database folder — survives app reinstall; NOT under Electron AppData.
 * Default: Documents\CASR\data\cashier.db
 */
export function liveDataDir(): string {
  if (process.env.CASR_DATA_DIR) {
    const d = process.env.CASR_DATA_DIR
    fs.mkdirSync(d, { recursive: true })
    return d
  }
  const d = path.join(userDocumentsDir(), 'CASR', 'data')
  fs.mkdirSync(d, { recursive: true })
  return d
}

export function liveDbPath(): string {
  return path.join(liveDataDir(), 'cashier.db')
}

export function defaultBackupsDir(): string {
  return path.join(userDocumentsDir(), 'CASR-Backups')
}

/**
 * Sidecar config so Electron can backup-on-exit without querying the DB.
 * Written whenever backup settings change.
 */
export type BackupPathConfig = {
  directory: string
  /** Optional mirror path (USB / external). Best-effort; never blocks exit. */
  secondaryDirectory?: string | null
  onExit: boolean
}

export function backupConfigFilePath(): string {
  return path.join(liveDataDir(), 'backup-config.json')
}

export function readBackupPathConfig(): BackupPathConfig {
  const fallback: BackupPathConfig = {
    directory: defaultBackupsDir(),
    secondaryDirectory: null,
    onExit: true,
  }
  try {
    const raw = fs.readFileSync(backupConfigFilePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<BackupPathConfig>
    const directory =
      typeof parsed.directory === 'string' && parsed.directory.trim()
        ? parsed.directory.trim()
        : fallback.directory
    const secondaryDirectory =
      typeof parsed.secondaryDirectory === 'string' && parsed.secondaryDirectory.trim()
        ? sanitizeBackupDirectory(parsed.secondaryDirectory)
        : null
    return {
      directory,
      secondaryDirectory,
      onExit: parsed.onExit !== false,
    }
  } catch {
    return fallback
  }
}

export function writeBackupPathConfig(cfg: BackupPathConfig): void {
  const directory = sanitizeBackupDirectory(cfg.directory) || defaultBackupsDir()
  fs.mkdirSync(directory, { recursive: true })
  const secondaryDirectory = sanitizeBackupDirectory(cfg.secondaryDirectory || '') || null
  const payload: BackupPathConfig = {
    directory,
    secondaryDirectory,
    onExit: cfg.onExit !== false,
  }
  fs.writeFileSync(backupConfigFilePath(), JSON.stringify(payload, null, 2), 'utf8')
}

/** Reject relative / traversal / empty paths. */
export function sanitizeBackupDirectory(input: string | undefined | null): string | null {
  if (!input || typeof input !== 'string') return null
  const trimmed = input.trim().replace(/^["']|["']$/g, '')
  if (!trimmed) return null
  if (trimmed.includes('..')) return null
  if (!path.isAbsolute(trimmed)) return null
  const lower = trimmed.toLowerCase().replace(/\//g, '\\')
  if (lower === 'c:\\' || lower === '/') return null
  return path.normalize(trimmed)
}

/**
 * Backups live in a SEPARATE folder from live data (default Documents\CASR-Backups),
 * or a user-chosen absolute path from settings / backup-config.json.
 */
export function backupsRootDir(): string {
  if (process.env.CASR_BACKUP_DIR) {
    const envDir = sanitizeBackupDirectory(process.env.CASR_BACKUP_DIR)
    if (envDir) {
      fs.mkdirSync(envDir, { recursive: true })
      return envDir
    }
  }
  const fromFile = sanitizeBackupDirectory(readBackupPathConfig().directory)
  const d = fromFile || defaultBackupsDir()
  fs.mkdirSync(d, { recursive: true })
  return d
}

/** One-time: move files from old Documents\CASR\backups → default CASR-Backups */
export function migrateLegacyBackupsIfNeeded(): void {
  const legacy = path.join(userDocumentsDir(), 'CASR', 'backups')
  const dest = defaultBackupsDir()
  fs.mkdirSync(dest, { recursive: true })
  if (!fs.existsSync(legacy)) return
  let names: string[] = []
  try {
    names = fs.readdirSync(legacy).filter((f) => f.endsWith('.db'))
  } catch {
    return
  }
  for (const name of names) {
    const from = path.join(legacy, name)
    const to = path.join(dest, name)
    if (fs.existsSync(to)) continue
    try {
      fs.copyFileSync(from, to)
    } catch {
      /* ignore */
    }
  }
}

/** Marker: AppData → Documents migration runs at most once per machine profile. */
export function appDataMigrationMarkerPath(): string {
  return path.join(liveDataDir(), '.appdata-migrated')
}

export type AppDataMigrationResult = {
  dest: string
  migrated: boolean
  skippedReason?: string
  source?: string
}

/**
 * Canonical live DB is Documents\CASR\data\cashier.db.
 * One-time copy from legacy AppData only when Documents DB is missing and
 * migration has never been recorded. Later absence of Documents DB uses seed
 * (Electron) / empty create — never re-applies a stale AppData copy.
 */
export function migrateLiveDbFromAppDataIfNeeded(): string {
  return migrateLiveDbFromAppDataDetailed().dest
}

export function migrateLiveDbFromAppDataDetailed(): AppDataMigrationResult {
  const dest = liveDbPath()
  if (fs.existsSync(dest)) {
    return { dest, migrated: false, skippedReason: 'documents-db-exists' }
  }

  const marker = appDataMigrationMarkerPath()
  if (fs.existsSync(marker)) {
    return { dest, migrated: false, skippedReason: 'already-migrated-once' }
  }

  const appDataCandidates = [
    path.join(process.env.APPDATA || '', 'CASR', 'cashier.db'),
    path.join(process.env.APPDATA || '', 'IMS-Pro', 'cashier.db'),
  ]
  for (const src of appDataCandidates) {
    if (!src || !fs.existsSync(src)) continue
    try {
      fs.copyFileSync(src, dest)
      fs.writeFileSync(
        marker,
        JSON.stringify(
          {
            at: new Date().toISOString(),
            source: src,
            dest,
            note: 'One-time AppData → Documents migration. Will not repeat.',
          },
          null,
          2,
        ),
        'utf8',
      )
      return { dest, migrated: true, source: src }
    } catch {
      /* try next */
    }
  }
  return { dest, migrated: false, skippedReason: 'no-appdata-source' }
}
