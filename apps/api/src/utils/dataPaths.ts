import fs from 'fs'
import path from 'path'

/** User Documents folder (Windows/macOS/Linux). */
export function userDocumentsDir(): string {
  if (process.env.CASR_DOCUMENTS_DIR) {
    return process.env.CASR_DOCUMENTS_DIR
  }
  return path.join(process.env.USERPROFILE || process.env.HOME || process.cwd(), 'Documents')
}

/** Machine-wide ProgramData root (Setup installs). */
export function programDataGalaxyRoot(): string {
  if (process.env.CASR_PROGRAMDATA_ROOT) return process.env.CASR_PROGRAMDATA_ROOT
  return path.join(process.env.ProgramData || 'C:\\ProgramData', 'GalaxyCashier')
}

/**
 * Live database folder — survives app reinstall; NOT under Electron AppData / $INSTDIR.
 * Prefer CASR_DATA_DIR (set by Electron). Fallback: ProgramData\GalaxyCashier\data (Setup).
 */
export function liveDataDir(): string {
  if (process.env.CASR_DATA_DIR) {
    const d = process.env.CASR_DATA_DIR
    fs.mkdirSync(d, { recursive: true })
    return d
  }
  const d = path.join(programDataGalaxyRoot(), 'data')
  fs.mkdirSync(d, { recursive: true })
  return d
}

export function liveDbPath(): string {
  return path.join(liveDataDir(), 'cashier.db')
}

/** Default backups: ProgramData\GalaxyCashier\backups (Setup machine-wide). */
export function defaultBackupsDir(): string {
  if (process.env.CASR_BACKUP_DIR_DEFAULT) {
    return process.env.CASR_BACKUP_DIR_DEFAULT
  }
  return path.join(programDataGalaxyRoot(), 'backups')
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
 * Backups live in a SEPARATE folder from live data
 * (default ProgramData\GalaxyCashier\backups), or a user-chosen absolute path.
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

/** One-time: copy legacy Documents backups → ProgramData\GalaxyCashier\backups */
export function migrateLegacyBackupsIfNeeded(): void {
  const dest = defaultBackupsDir()
  fs.mkdirSync(dest, { recursive: true })
  const legacies = [
    path.join(userDocumentsDir(), 'CASR', 'backups'),
    path.join(userDocumentsDir(), 'CASR-Backups'),
  ]
  for (const legacy of legacies) {
    if (!fs.existsSync(legacy)) continue
    let names: string[] = []
    try {
      names = fs.readdirSync(legacy).filter((f) => f.endsWith('.db'))
    } catch {
      continue
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
}

/** True if directory exists and is writable (for secondary backup mirror). */
export function isBackupDirectoryAvailable(dir: string | null | undefined): boolean {
  const d = sanitizeBackupDirectory(dir || '')
  if (!d) return false
  try {
    if (!fs.existsSync(path.parse(d).root)) return false
    fs.mkdirSync(d, { recursive: true })
    const probe = path.join(d, `.casr-write-probe-${Date.now()}`)
    fs.writeFileSync(probe, 'ok')
    fs.unlinkSync(probe)
    return true
  } catch {
    return false
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
 * Canonical live DB is CASR_DATA_DIR / ProgramData\GalaxyCashier\data\cashier.db.
 * One-time copy from legacy AppData only when live DB is missing and
 * migration has never been recorded. Later absence uses seed (Electron) /
 * empty create — never re-applies a stale AppData copy.
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
