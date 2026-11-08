import { Request, Response } from 'express'
import { prisma } from '../db/prisma'
import {
  getCustomers, getCustomerById, createCustomer, updateCustomer,
  softDeleteCustomer, getCustomerStatement,
  getCustomerReconcile, applyCustomerReconcile, listCustomersReconcileOutOfSync,
} from '../services/customer.service'
import { sendRouteError } from '../utils/apiError'
import { logAudit } from '../services/audit.service'

export async function listCustomers(req: Request, res: Response) {
  try {
    const { search, type, page, pageSize } = req.query
    const result = await getCustomers({
      search: search as string,
      type: type as string,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
    })
    res.json({ success: true, data: result })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch customers' })
  }
}

export async function getCustomer(req: Request, res: Response) {
  try {
    const customer = await getCustomerById(req.params.id)
    if (!customer) return res.status(404).json({ success: false, error: 'Customer not found' })
    res.json({ success: true, data: customer })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch customer' })
  }
}

export async function addCustomer(req: Request, res: Response) {
  try {
    const customer = await createCustomer(req.body)
    res.status(201).json({ success: true, data: customer })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to create customer' })
  }
}

export async function editCustomer(req: Request, res: Response) {
  try {
    const customer = await updateCustomer(req.params.id, req.body)
    res.json({ success: true, data: customer })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to update customer' })
  }
}

export async function deleteCustomer(req: Request, res: Response) {
  try {
    const id = req.params.id
    await softDeleteCustomer(id)
    await logAudit(prisma, {
      userId: req.user!.id,
      action: 'DELETE_CUSTOMER',
      entityType: 'CUSTOMER',
      entityId: id,
    })
    res.json({ success: true })
  } catch (e) {
    return sendRouteError(res, e, 'فشل حذف العميل')
  }
}

export async function customerStatement(req: Request, res: Response) {
  try {
    const { from, to } = req.query
    const data = await getCustomerStatement(req.params.id, from as string, to as string)
    res.json({ success: true, data })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to get customer statement' })
  }
}

export async function reconcileCustomer(req: Request, res: Response) {
  try {
    const data = await getCustomerReconcile(req.params.id)
    res.json({ success: true, data })
  } catch (e) {
    return sendRouteError(res, e, 'فشل قراءة تسوية العميل')
  }
}

export async function reconcileCustomerApply(req: Request, res: Response) {
  try {
    const data = await applyCustomerReconcile(req.params.id, req.user!.id)
    res.json({ success: true, data })
  } catch (e) {
    return sendRouteError(res, e, 'فشل تسوية رصيد العميل')
  }
}

export async function reconcileAllCustomers(req: Request, res: Response) {
  try {
    const data = await listCustomersReconcileOutOfSync()
    res.json({ success: true, data })
  } catch (e) {
    return sendRouteError(res, e, 'فشل تقرير التسوية')
  }
}
