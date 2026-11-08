import { Router } from 'express'
import { verifyToken } from '../middleware/auth'
import { requireRole } from '../middleware/requireRole'
import { getAuditLogs } from '../controllers/audit.controller'

const router = Router()
router.use(verifyToken)
router.get('/', requireRole('ADMIN'), getAuditLogs)

export default router
