export type CreditErrorCode = 'CREDIT_NOT_ALLOWED' | 'CREDIT_LIMIT_EXCEEDED'

export type CreditError = Error & {
  statusCode: number
  code: CreditErrorCode
  userMessage: string
}

export function creditNotAllowedError(): CreditError {
  const err = new Error('CREDIT_NOT_ALLOWED') as CreditError
  err.code = 'CREDIT_NOT_ALLOWED'
  err.statusCode = 400
  err.userMessage = 'العميل غير مسموح له بالبيع الآجل'
  return err
}

export function creditLimitExceededError(available: number, invoiceTotal: number): CreditError {
  const err = new Error('CREDIT_LIMIT_EXCEEDED') as CreditError
  err.code = 'CREDIT_LIMIT_EXCEEDED'
  err.statusCode = 400
  const avail = Math.max(0, available)
  err.userMessage = `تجاوز حد الائتمان: الحد المتاح ${avail.toFixed(2)} والفاتورة ${invoiceTotal.toFixed(2)}`
  return err
}

export function isCreditError(error: unknown): error is CreditError {
  return (
    error instanceof Error &&
    (error.message === 'CREDIT_NOT_ALLOWED' || error.message === 'CREDIT_LIMIT_EXCEEDED')
  )
}

export function respondCreditError(res: import('express').Response, error: CreditError) {
  return res.status(400).json({
    success: false,
    code: error.code,
    error: error.userMessage,
  })
}
