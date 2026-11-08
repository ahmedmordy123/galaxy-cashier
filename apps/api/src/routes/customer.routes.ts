import { Router } from 'express'
import { listCustomers, getCustomer, addCustomer, editCustomer, deleteCustomer, customerStatement, reconcileCustomer, reconcileCustomerApply, reconcileAllCustomers } from '../controllers/customer.controller'
import { verifyToken } from '../middleware/auth'
import { requireRole } from '../middleware/requireRole'
import { validateRequest } from '../middleware/validateRequest'
import { createCustomerSchema, updateCustomerSchema } from '../validators/customer.validator'

const router = Router()
router.use(verifyToken)

router.get('/', listCustomers)
router.get('/reconcile-all', requireRole('ADMIN', 'MANAGER'), reconcileAllCustomers)
router.get('/:id', getCustomer)
router.get('/:id/statement', customerStatement)
router.get('/:id/reconcile', requireRole('ADMIN', 'MANAGER', 'ACCOUNTANT'), reconcileCustomer)
router.post('/:id/reconcile', requireRole('ADMIN', 'MANAGER'), reconcileCustomerApply)
router.post('/', requireRole('ADMIN', 'MANAGER', 'STAFF', 'ACCOUNTANT', 'CASHIER'), validateRequest(createCustomerSchema), addCustomer)
router.put('/:id', requireRole('ADMIN', 'MANAGER', 'STAFF', 'ACCOUNTANT'), validateRequest(updateCustomerSchema), editCustomer)
router.delete('/:id', requireRole('ADMIN'), deleteCustomer)

export default router
