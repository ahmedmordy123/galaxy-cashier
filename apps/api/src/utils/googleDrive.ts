import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'

export type GoogleDriveDetectResult = {
  installed: boolean
  roots: string[]
  suggestedBackupDir: string | null
  driveProcessRunning: boolean
  hints: string[]
}

function existsDir(p: string): boolean {
  try {
    return Boolean(p) && fs.existsSync(p) && fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

function uniqueExisting(paths: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of paths) {
    const n = path.normalize(raw)
    const key = n.toLowerCase()
    if (seen.has(key)) continue
    if (!existsDir(n)) continue
    seen.add(key)
    out.push(n)
  }
  return out
}

/** Candidate sync roots used by Google Drive Desktop / Drive File Stream / DriveFS. */
export function discoverGoogleDriveRoots(): string[] {
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir()
  const candidates: string[] = [
    path.join(home, 'Google Drive'),
    path.join(home, 'GoogleDrive'),
    path.join(home, 'My Drive'),
    'G:\\My Drive',
    'G:\\',
    'H:\\My Drive',
    'H:\\',
  ]

  // Drive for Desktop sometimes mirrors under Letters; scan A–Z for "My Drive"
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    candidates.push(`${letter}:\\My Drive`)
    candidates.push(`${letter}:\\Google Drive`)
  }

  // DriveFS local metadata — if present, app is (or was) installed
  const driveFs = path.join(process.env.LOCALAPPDATA || '', 'Google', 'DriveFS')
  if (existsDir(driveFs)) {
    candidates.push(driveFs)
  }

  return uniqueExisting(candidates)
}

export function isGoogleDriveProcessLikelyRunning(): boolean {
  // Soft signal only — used for UI warning, not a hard requirement for local write
  try {
    if (process.platform === 'win32') {
      const out = execSync('tasklist /FI "IMAGENAME eq GoogleDriveFS.exe" /NH', {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 4000,
      })
      return /GoogleDriveFS\.exe/i.test(out) && !/No tasks/i.test(out)
    }
  } catch {
    /* ignore */
  }
  return false
}

export function isPathUnderGoogleDrive(targetPath: string, roots?: string[]): boolean {
  const normalized = path.normalize(targetPath).toLowerCase().replace(/\//g, '\\')
  const rootList = (roots ?? discoverGoogleDriveRoots()).map((r) =>
    path.normalize(r).toLowerCase().replace(/\//g, '\\'),
  )
  for (const root of rootList) {
    if (!root) continue
    if (normalized === root || normalized.startsWith(root.endsWith('\\') ? root : root + '\\')) {
      return true
    }
  }
  // Name heuristics (custom letter / renamed mirror)
  return (
    normalized.includes('\\google drive\\') ||
    normalized.includes('\\googledrive\\') ||
    normalized.includes('\\my drive\\') ||
    /\\my drive$/i.test(normalized) ||
    /\\google drive$/i.test(normalized)
  )
}

export function detectGoogleDrive(): GoogleDriveDetectResult {
  const roots = discoverGoogleDriveRoots().filter((r) => {
    // Exclude DriveFS metadata folder itself as a backup root
    const low = r.toLowerCase()
    return !low.includes('\\google\\drivefs')
  })
  const driveFsMeta = existsDir(path.join(process.env.LOCALAPPDATA || '', 'Google', 'DriveFS'))
  const programFiles = [
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Google', 'Drive File Stream'),
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Google', 'Drive for desktop'),
  ].some(existsDir)

  const installed = roots.length > 0 || driveFsMeta || programFiles
  const driveProcessRunning = isGoogleDriveProcessLikelyRunning()

  let suggestedBackupDir: string | null = null
  if (roots.length > 0) {
    suggestedBackupDir = path.join(roots[0], 'CASR-Backups')
  }

  const hints: string[] = []
  if (!installed) {
    hints.push(
      'تطبيق Google Drive Desktop غير موجود أو لم يُكتشف على هذا الجهاز. ثبّته من Google ثم اختر مجلد «My Drive».',
    )
  } else if (!driveProcessRunning) {
    hints.push(
      'تم اكتشاف مجلد Google Drive، لكن يبدو أن تطبيق المزامنة غير شغّال حالياً. الحفظ المحلي سيعمل؛ الرفع للسحابة يحتاج تشغيل Drive والاتصال بالنت.',
    )
  } else {
    hints.push('تم اكتشاف Google Drive. يُفضّل حفظ النسخ داخل مجلد مزامن (مثل My Drive\\CASR-Backups).')
  }

  return {
    installed,
    roots,
    suggestedBackupDir,
    driveProcessRunning,
    hints,
  }
}

export function assertBackupPathWritable(dir: string): { ok: true } | { ok: false; error: string } {
  try {
    fs.mkdirSync(dir, { recursive: true })
    const probe = path.join(dir, `.casr-write-probe-${Date.now()}`)
    fs.writeFileSync(probe, 'ok')
    fs.unlinkSync(probe)
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/ENOENT/i.test(msg)) {
      return {
        ok: false,
        error: 'المسار غير موجود. تأكد إن Google Drive Desktop مثبّت والمجلد ظاهر على الجهاز.',
      }
    }
    if (/EACCES|EPERM|readonly/i.test(msg)) {
      return { ok: false, error: 'لا يمكن الكتابة في هذا المجلد — تحقق من الصلاحيات أو إن Drive غير معلّق.' }
    }
    return { ok: false, error: `فشل الوصول للمجلد: ${msg}` }
  }
}
