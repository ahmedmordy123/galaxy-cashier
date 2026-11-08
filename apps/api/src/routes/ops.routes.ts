import { Router } from 'express'
import { verifyToken } from '../middleware/auth'
import { requireRole } from '../middleware/requireRole'
import * as wh from '../services/warehouse.service'
import * as shift from '../services/shift.service'
import * as analysis from '../services/analysis.service'
import * as vs from '../services/variant-serial.service'
import { returnPurchaseInvoice } from '../services/purchase.service'

const router = Router()
router.use(verifyToken)

// Warehouses
router.get('/warehouses', async (_req, res) => {
  try {
    res.json({ success: true, data: await wh.listWarehouses() })
  } catch (e: unknown) {
    res.status(500).json({ success: false, error: e instanceof Error ? e.message : 'error' })
  }
})

router.post('/warehouses', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { name, code, isDefault } = req.body
    if (!name || !code) return res.status(400).json({ success: false, error: 'name and code required' })
    res.status(201).json({ success: true, data: await wh.createWarehouse({ name, code, isDefault }) })
  } catch (e: unknown) {
    res.status(500).json({ success: false, error: e instanceof Error ? e.message : 'error' })
  }
})

router.post('/warehouses/transfer', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { itemId, fromWarehouseId, toWarehouseId, quantity, notes } = req.body
    await wh.warehouseTransfer({ itemId, fromWarehouseId, toWarehouseId, quantity: Number(quantity), notes }, req.user!.id)
    res.json({ success: true })
  } catch (e: unknown) {
    res.status(400).json({ success: false, error: e instanceof Error ? e.message : 'error' })
  }
})

// Stock counts
router.get('/stock-counts', requireRole('ADMIN', 'MANAGER'), async (_req, res) => {
  try {
    res.json({ success: true, data: await wh.listStockCounts() })
  } catch (e: unknown) {
    res.status(500).json({ success: false, error: e instanceof Error ? e.message : 'error' })
  }
})

router.post('/stock-counts', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { warehouseId, lines } = req.body
    res.status(201).json({
      success: true,
      data: await wh.createStockCount(warehouseId, req.user!.id, lines || []),
    })
  } catch (e: unknown) {
    res.status(400).json({ success: false, error: e instanceof Error ? e.message : 'error' })
  }
})

router.post('/stock-counts/:id/confirm', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    res.json({ success: true, data: await wh.confirmStockCount(req.params.id, req.user!.id) })
  } catch (e: unknown) {
    res.status(400).json({ success: false, error: e instanceof Error ? e.message : 'error' })
  }
})

// Item ledger
router.get('/item-ledger/:itemId', async (req, res) => {
  try {
    res.json({ success: true, data: await wh.getItemLedger(req.params.itemId) })
  } catch (e: unknown) {
    res.status(500).json({ success: false, error: e instanceof Error ? e.message : 'error' })
  }
})

// Shifts
router.get('/shifts/current', async (req, res) => {
  try {
    res.json({ success: true, data: await shift.currentShift(req.user!.id) })
  } catch (e: unknown) {
    res.status(500).json({ success: false, error: e instanceof Error ? e.message : 'error' })
  }
})

router.get('/shifts/current/summary', async (req, res) => {
  try {
    const open = await shift.currentShift(req.user!.id)
    if (!open) {
      return res.json({ success: true, data: null })
    }
    res.json({ success: true, data: await shift.getShiftSummary(open.id) })
  } catch (e: unknown) {
    res.status(500).json({ success: false, error: e instanceof Error ? e.message : 'error' })
  }
})

router.get('/shifts', requireRole('ADMIN', 'MANAGER'), async (_req, res) => {
  try {
    res.json({ success: true, data: await shift.listShifts() })
  } catch (e: unknown) {
    res.status(500).json({ success: false, error: e instanceof Error ? e.message : 'error' })
  }
})

router.post('/shifts/open', async (req, res) => {
  try {
    res.status(201).json({
      success: true,
      data: await shift.openShift(req.user!.id, Number(req.body.openingCash || 0)),
    })
  } catch (e: unknown) {
    res.status(400).json({ success: false, error: e instanceof Error ? e.message : 'error' })
  }
})

router.post('/shifts/close', async (req, res) => {
  try {
    res.json({
      success: true,
      data: await shift.closeShift(req.user!.id, Number(req.body.closingCash || 0), req.body.notes),
    })
  } catch (e: unknown) {
    res.status(400).json({ success: false, error: e instanceof Error ? e.message : 'error' })
  }
})

// Analysis
router.get('/sales-analysis', requireRole('ADMIN', 'MANAGER', 'ACCOUNTANT'), async (req, res) => {
  try {
    const groupBy = (req.query.groupBy as string) || 'item'
    res.json({
      success: true,
      data: await analysis.salesAnalysis({
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
        groupBy: groupBy as 'item' | 'customer' | 'cashier' | 'day' | 'month' | 'warehouse',
      }),
    })
  } catch (e: unknown) {
    res.status(500).json({ success: false, error: e instanceof Error ? e.message : 'error' })
  }
})

router.get('/invoice-profit/:id', requireRole('ADMIN', 'MANAGER', 'ACCOUNTANT'), async (req, res) => {
  try {
    const data = await analysis.invoiceProfitability(req.params.id)
    if (!data) return res.status(404).json({ success: false, error: 'not found' })
    res.json({ success: true, data })
  } catch (e: unknown) {
    res.status(500).json({ success: false, error: e instanceof Error ? e.message : 'error' })
  }
})

// Serials & variants
router.get('/serials', async (req, res) => {
  try {
    res.json({
      success: true,
      data: await vs.listSerials(req.query.itemId as string | undefined, req.query.status as string | undefined),
    })
  } catch (e: unknown) {
    res.status(500).json({ success: false, error: e instanceof Error ? e.message : 'error' })
  }
})

router.post('/serials', requireRole('ADMIN', 'MANAGER', 'STAFF'), async (req, res) => {
  try {
    res.status(201).json({ success: true, data: await vs.addSerial(req.body) })
  } catch (e: unknown) {
    res.status(400).json({ success: false, error: e instanceof Error ? e.message : 'error' })
  }
})

router.post('/variants', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    res.status(201).json({ success: true, data: await vs.createVariant(req.body) })
  } catch (e: unknown) {
    res.status(400).json({ success: false, error: e instanceof Error ? e.message : 'error' })
  }
})

// Purchase return (mounted helper under /api/ops for simplicity; also add to purchases)
router.post('/purchase-return/:id', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const data = await returnPurchaseInvoice(req.params.id, req.user!.id, req.body.items)
    res.json({ success: true, data })
  } catch (e: unknown) {
    res.status(400).json({ success: false, error: e instanceof Error ? e.message : 'error' })
  }
})

export default router
