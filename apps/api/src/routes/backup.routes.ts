import { Router } from 'express'
import { verifyToken } from '../middleware/auth'
import { requireRole } from '../middleware/requireRole'
import { createBackup, downloadBackup, listBackups, restoreBackup, backupAutoStatus, runAutoBackupNow } from '../controllers/backup.controller'

const router = Router()
router.use(verifyToken)
router.use(requireRole('ADMIN', 'MANAGER'))

router.get('/auto-status', backupAutoStatus)
router.post('/auto-run', runAutoBackupNow)
router.post('/', createBackup)
router.post('/restore', restoreBackup)
router.get('/download', downloadBackup)
router.get('/', listBackups)

export default router
