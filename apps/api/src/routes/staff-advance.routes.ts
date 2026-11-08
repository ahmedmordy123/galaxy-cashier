import { Router } from 'express'
import { verifyToken } from '../middleware/auth'
import { requireRole } from '../middleware/requireRole'
import {
  listEmployeesHandler,
  listAdvancesHandler,
  summaryHandler,
  ledgerHandler,
  createAdvanceHandler,
  deleteAdvanceHandler,
} from '../controllers/staff-advance.controller'

const router = Router()
router.use(verifyToken)

const roles = ['ADMIN', 'MANAGER', 'ACCOUNTANT'] as const

router.get('/employees/:id/ledger', requireRole(...roles), ledgerHandler)
router.get('/employees', requireRole(...roles), listEmployeesHandler)
router.get('/summary', requireRole(...roles), summaryHandler)
router.get('/', requireRole(...roles), listAdvancesHandler)
router.post('/', requireRole(...roles), createAdvanceHandler)
router.delete('/:id', requireRole(...roles), deleteAdvanceHandler)

export default router
