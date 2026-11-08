import fs from 'fs'
import path from 'path'

type Statfs = { bfree: number; bsize: number }

function statfsSync(targetPath: string): Statfs | null {
  const fn = (fs as typeof fs & { statfsSync?: (p: string) => Statfs }).statfsSync
  if (typeof fn !== 'function') return null
  try {
    return fn(targetPath)
  } catch {
    return null
  }
}

/** Returns free bytes or null if OS API unavailable. */
export function freeDiskBytes(dirPath: string): number | null {
  const st = statfsSync(dirPath)
  if (!st) return null
  return st.bfree * st.bsize
}

export function assertEnoughDiskSpace(dirPath: string, bytesRequired: number, minReserveBytes = 50 * 1024 * 1024) {
  const free = freeDiskBytes(dirPath)
  if (free == null) return
  const need = bytesRequired + minReserveBytes
  if (free < need) {
    const err = new Error('DISK_FULL') as Error & { statusCode: number }
    err.statusCode = 507
    throw err
  }
}

export function fileSizeSafe(filePath: string): number {
  try {
    return fs.statSync(filePath).size
  } catch {
    return 0
  }
}

export function backupsRootFromDbPath(dbPath: string): string {
  return path.dirname(dbPath)
}
