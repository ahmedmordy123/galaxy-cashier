/** Shared cashier prompt when DRAFT tax snapshot ≠ live settings. */

export type TaxPolicyChangeDetails = {
  previous: { total: number; tax: number }
  next: { total: number; tax: number }
}

export function isTaxPolicyChangedError(err: unknown): {
  details: TaxPolicyChangeDetails
  message: string
} | null {
  const axiosErr = err as {
    response?: {
      status?: number
      data?: {
        code?: string
        error?: string
        details?: TaxPolicyChangeDetails
      }
    }
  }
  const data = axiosErr.response?.data
  if (axiosErr.response?.status !== 409 || data?.code !== 'TAX_POLICY_CHANGED' || !data.details) {
    return null
  }
  return {
    details: data.details,
    message: data.error ?? 'إعدادات الضريبة تغيّرت',
  }
}

/** Returns true if cashier accepts confirming with the new (live) total. */
export function promptTaxPolicyChange(details: TaxPolicyChangeDetails): boolean {
  const prev = Number(details.previous.total).toFixed(2)
  const next = Number(details.next.total).toFixed(2)
  const prevTax = Number(details.previous.tax).toFixed(2)
  const nextTax = Number(details.next.tax).toFixed(2)
  return window.confirm(
    `تنبيه: إعدادات الضريبة تغيّرت أثناء المسودة.\n\n` +
      `الإجمالي السابق: ${prev} (ضريبة ${prevTax})\n` +
      `الإجمالي الجديد: ${next} (ضريبة ${nextTax})\n\n` +
      `هل تريد التأكيد بالإجمالي الجديد؟`,
  )
}
