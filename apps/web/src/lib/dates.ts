/** Local calendar YYYY-MM-DD (not UTC — avoids Egypt timezone off-by-one) */
export function localDateISO(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Format a DB Date/ISO string as local YYYY-MM-DD for <input type="date"> */
export function toLocalDateInput(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return localDateISO()
  return localDateISO(d)
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Display date: 21/07/2026 (Latin digits, Egypt order) */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return '—'
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

/** Display date+time: 21/07/2026 00:53 — no English AM/PM */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return '—'
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
