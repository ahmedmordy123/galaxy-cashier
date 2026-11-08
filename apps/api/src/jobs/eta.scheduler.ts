import { logger } from '../utils/logger'
import { processPendingEtaDocuments } from '../services/eta.service'

const TICK_MS = 60 * 1000

let timer: ReturnType<typeof setInterval> | null = null

export function startEtaScheduler() {
  if (timer) return

  const tick = async () => {
    try {
      await processPendingEtaDocuments(20)
    } catch (e) {
      logger.warn(`[eta] Worker tick skipped: ${e instanceof Error ? e.message : e}`)
    }
  }

  void tick()
  timer = setInterval(() => void tick(), TICK_MS)
  logger.info('[eta] Submission scheduler started (every 60s when enabled)')
}

export function stopEtaScheduler() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
