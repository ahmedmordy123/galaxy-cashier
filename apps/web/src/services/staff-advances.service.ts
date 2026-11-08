import api from '@/lib/api'

export const staffAdvancesService = {
  listEmployees: () => api.get('/api/staff-advances/employees').then((r) => r.data),
  list: (params?: Record<string, string | number>) =>
    api.get('/api/staff-advances', { params }).then((r) => r.data),
  summary: (year: number, month: number) =>
    api.get('/api/staff-advances/summary', { params: { year, month } }).then((r) => r.data),
  ledger: (employeeId: string, year: number, month: number) =>
    api
      .get(`/api/staff-advances/employees/${employeeId}/ledger`, { params: { year, month } })
      .then((r) => r.data),
  create: (data: {
    employeeId: string
    amount: number
    date: string
    notes?: string
  }) => api.post('/api/staff-advances', data).then((r) => r.data),
  remove: (id: string) => api.delete(`/api/staff-advances/${id}`).then((r) => r.data),
}
