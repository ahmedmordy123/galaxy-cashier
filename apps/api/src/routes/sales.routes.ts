import { Router } from 'express'
import { verifyToken } from '../middleware/auth'
import { requireRole } from '../middleware/requireRole'
import {
  listInvoices,
  getInvoice,
  createInvoice,
  updateInvoice,
  confirmInvoiceHandler,
  cancelInvoiceHandler,
  returnInvoiceHandler,
  partialReturnHandler,
  parkInvoiceHandler,
  listParkedHandler,
} from '../controllers/sales.controller'

const router = Router()
router.use(verifyToken)

router.get('/', requireRole('ADMIN', 'MANAGER', 'CASHIER', 'STAFF'), listInvoices)
router.get('/parked/list', requireRole('ADMIN', 'MANAGER', 'CASHIER', 'STAFF'), listParkedHandler)
router.post('/', requireRole('ADMIN', 'MANAGER', 'CASHIER', 'STAFF'), createInvoice)
router.patch('/:id', requireRole('ADMIN', 'MANAGER', 'CASHIER', 'STAFF'), updateInvoice)
router.get('/:id', requireRole('ADMIN', 'MANAGER', 'CASHIER', 'STAFF'), getInvoice)
router.post('/:id/confirm', requireRole('ADMIN', 'MANAGER', 'CASHIER', 'STAFF'), confirmInvoiceHandler)
router.post('/:id/park', requireRole('ADMIN', 'MANAGER', 'CASHIER', 'STAFF'), parkInvoiceHandler)
router.post('/:id/cancel', requireRole('ADMIN', 'MANAGER'), cancelInvoiceHandler)
router.post('/:id/return', requireRole('ADMIN', 'MANAGER'), returnInvoiceHandler)
router.post('/:id/partial-return', requireRole('ADMIN', 'MANAGER', 'CASHIER', 'STAFF'), partialReturnHandler)

export default router
