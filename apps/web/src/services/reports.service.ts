import api from '@/lib/api'

export const reportsService = {
  getTodaySummary: () =>
    api.get('/api/reports/today-summary').then((r) => r.data),
  getSales: (params: Record<string, string | undefined>) =>
    api.get('/api/reports/sales', { params }).then((r) => r.data),
  getPurchases: (params: Record<string, string | undefined>) =>
    api.get('/api/reports/purchases', { params }).then((r) => r.data),
  getProfit: (params: Record<string, string | undefined>) =>
    api.get('/api/reports/profit', { params }).then((r) => r.data),
  getInventory: () =>
    api.get('/api/reports/inventory').then((r) => r.data),
  getExpenseAnalysis: (params: Record<string, string | undefined>) =>
    api.get('/api/reports/expenses', { params }).then((r) => r.data),
  getInventoryAsOf: (date: string) =>
    api.get('/api/reports/inventory-as-of', { params: { date } }).then((r) => r.data),
  getPeriodCompare: (params: Record<string, string | undefined>) =>
    api.get('/api/reports/period-compare', { params }).then((r) => r.data),
  getProductMovement: (params: Record<string, string | number | undefined>) =>
    api.get('/api/reports/product-movement', { params }).then((r) => r.data),
  getCustomerStatement: (id: string, params?: Record<string, string | undefined>) =>
    api.get(`/api/reports/customer-statement/${id}`, { params }).then((r) => r.data),
  getSupplierStatement: (id: string, params?: Record<string, string | undefined>) =>
    api.get(`/api/reports/supplier-statement/${id}`, { params }).then((r) => r.data),
}
