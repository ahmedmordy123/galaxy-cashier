import { Router } from 'express'
import { verifyToken } from '../middleware/auth'
import { requireRole } from '../middleware/requireRole'
import {
  listQuotes,
  getQuote,
  createQuoteHandler,
  convertQuoteHandler,
  deleteQuoteHandler,
} from '../controllers/quotes.controller'

const router = Router()
router.use(verifyToken)

const roles = ['ADMIN', 'MANAGER', 'CASHIER', 'STAFF'] as const

router.get('/', requireRole(...roles), listQuotes)
router.post('/', requireRole(...roles), createQuoteHandler)
router.get('/:id', requireRole(...roles), getQuote)
router.post('/:id/convert', requireRole(...roles), convertQuoteHandler)
router.delete('/:id', requireRole('ADMIN', 'MANAGER'), deleteQuoteHandler)

export default router
