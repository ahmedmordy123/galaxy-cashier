import { Router } from 'express'
import { verifyToken } from '../middleware/auth'
import { requireRole } from '../middleware/requireRole'
import * as ctrl from '../controllers/reports.controller'

const router = Router()
router.use(verifyToken)

const reportRoles = ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'VIEWER'] as const

router.get('/today-summary',              requireRole('ADMIN', 'MANAGER', 'CASHIER', 'ACCOUNTANT', 'STAFF'), ctrl.todaySummaryHandler)
router.get('/sales',                      requireRole(...reportRoles), ctrl.salesReport)
router.get('/purchases',                  requireRole(...reportRoles), ctrl.purchasesReport)
router.get('/profit',                     requireRole('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.profitReport)
router.get('/inventory',                  requireRole(...reportRoles), ctrl.inventoryReport)
router.get('/product-movement',           requireRole(...reportRoles), ctrl.productMovementReport)
router.get('/expenses',                   requireRole(...reportRoles), ctrl.expenseAnalysisReport)
router.get('/inventory-as-of',            requireRole(...reportRoles), ctrl.inventoryAsOfReport)
router.get('/period-compare',             requireRole(...reportRoles), ctrl.periodCompareReport)
router.get('/customer-statement/:id',     requireRole(...reportRoles), ctrl.customerStatement)
router.get('/supplier-statement/:id',     requireRole(...reportRoles), ctrl.supplierStatement)

export default router
