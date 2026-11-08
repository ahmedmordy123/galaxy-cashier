import api from '@/lib/api'

export const quotesService = {
  getAll: (params?: Record<string, string | number | undefined>) =>
    api.get('/api/quotes', { params }).then((r) => r.data),
  getById: (id: string) =>
    api.get(`/api/quotes/${id}`).then((r) => r.data),
  create: (data: Record<string, unknown>) =>
    api.post('/api/quotes', data).then((r) => r.data),
  convertToSale: (id: string) =>
    api.post(`/api/quotes/${id}/convert`).then((r) => r.data),
  delete: (id: string) =>
    api.delete(`/api/quotes/${id}`).then((r) => r.data),
}
