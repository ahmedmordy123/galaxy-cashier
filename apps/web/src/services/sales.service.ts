import api from '@/lib/api'

export const salesService = {
  getAll: (params?: Record<string, string | number | undefined>) =>
    api.get('/api/sales', { params }).then((r) => r.data),
  getById: (id: string) =>
    api.get(`/api/sales/${id}`).then((r) => r.data),
  create: (data: Record<string, unknown>) =>
    api.post('/api/sales', data).then((r) => r.data),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch(`/api/sales/${id}`, data).then((r) => r.data),
  confirm: (id: string, data?: { amountPaid?: number; payments?: Array<{ method: string; amount: number }>; updatedAt?: string }) =>
    api.post(`/api/sales/${id}/confirm`, data ?? {}).then((r) => r.data),
  park: (id: string) =>
    api.post(`/api/sales/${id}/park`).then((r) => r.data),
  listParked: () =>
    api.get('/api/sales/parked/list').then((r) => r.data),
  cancel: (id: string) =>
    api.post(`/api/sales/${id}/cancel`).then((r) => r.data),
  returnInvoice: (id: string) =>
    api.post(`/api/sales/${id}/return`).then((r) => r.data),
  partialReturn: (id: string, items: { itemId: string; quantity: number }[]) =>
    api.post(`/api/sales/${id}/partial-return`, { items }).then((r) => r.data),
}
