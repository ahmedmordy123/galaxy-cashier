import { logger } from '../utils/logger'
import { runScheduledBackupIfDue } from '../services/backup.service'

const TICK_MS = 5 * 60 * 1000

let timer: ReturnType<typeof setInterval> | null = null

export function startAutoBackupScheduler() {
  if (timer) return

  const tick = async () => {
    try {
      const result = await runScheduledBackupIfDue(false)
      if (result.ran) {
        logger.info(`[backup] Auto backup saved: ${result.file}`)
      }
    } catch (e) {
      logger.warn(`[backup] Auto backup skipped: ${e instanceof Error ? e.message : e}`)
    }
  }

  void tick()
  timer = setInterval(() => void tick(), TICK_MS)
  logger.info('[backup] Auto backup scheduler started (checks every 5 min)')
}

export function stopAutoBackupScheduler() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
