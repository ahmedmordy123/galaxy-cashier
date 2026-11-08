import { Router } from 'express'
import { verifyToken } from '../middleware/auth'
import { requireRole } from '../middleware/requireRole'
import { etaStatus, etaForInvoice, listEta, runEtaWorker, retryEta } from '../controllers/eta.controller'

const router = Router()
router.use(verifyToken)

router.get('/status', requireRole('ADMIN', 'MANAGER'), etaStatus)
router.get('/invoice/:invoiceId', requireRole('ADMIN', 'MANAGER', 'CASHIER', 'STAFF'), etaForInvoice)
router.get('/documents', requireRole('ADMIN', 'MANAGER'), listEta)
router.post('/process', requireRole('ADMIN'), runEtaWorker)
router.post('/documents/:id/retry', requireRole('ADMIN', 'MANAGER'), retryEta)

export default router
