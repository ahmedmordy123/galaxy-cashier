import { Response } from 'express'

const PRISMA_NOT_FOUND = 'P2025'

export function isPlausibleId(id: string): boolean {
  if (!id || typeof id !== 'string') return false
  const t = id.trim()
  return t.length >= 20 && t.length <= 36 && /^[a-z0-9]+$/i.test(t)
}

export function notFoundError(message = 'غير موجود'): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number }
  err.statusCode = 404
  return err
}

export function mapError(error: unknown, fallbackMessage: string): { status: number; message: string } {
  if (error && typeof error === 'object' && 'statusCode' in error) {
    const sc = Number((error as { statusCode: number }).statusCode)
    if (sc >= 400 && sc < 600) {
      const msg =
        error instanceof Error && error.message === 'ACCOUNT_LOCKED'
          ? 'تم قفل الحساب مؤقتاً بعد محاولات فاشلة. حاول لاحقاً.'
          : error instanceof Error && error.message === 'DISK_FULL'
            ? 'مساحة القرص غير كافية لإنشاء نسخة احتياطية'
            : error instanceof Error && error.message === 'NO_OPEN_SHIFT'
            ? 'افتح وردية أولاً قبل تسجيل سلفة'
            : error instanceof Error && error.message === 'EMPLOYEE_NOT_FOUND'
              ? 'الموظف غير موجود'
              : error instanceof Error && error.message === 'EMPLOYEE_INACTIVE'
                ? 'حساب الموظف غير نشط'
            : error instanceof Error && sc === 404
              ? 'غير موجود'
              : fallbackMessage
      return { status: sc, message: msg }
    }
  }
  if (error instanceof Error) {
    if (error.message === 'NOT_FOUND') return { status: 404, message: 'غير موجود' }
    if (error.message === 'ACCOUNT_LOCKED') {
      return { status: 423, message: 'تم قفل الحساب مؤقتاً بعد محاولات فاشلة. حاول لاحقاً.' }
    }
    if (error.message === 'DISK_FULL') {
      return { status: 507, message: 'مساحة القرص غير كافية لإنشاء نسخة احتياطية' }
    }
    if (error.message === 'NO_OPEN_SHIFT') {
      return { status: 400, message: 'افتح وردية أولاً قبل تسجيل سلفة' }
    }
    if (error.message === 'EMPLOYEE_NOT_FOUND') {
      return { status: 404, message: 'الموظف غير موجود' }
    }
    if (error.message === 'EMPLOYEE_INACTIVE') {
      return { status: 400, message: 'حساب الموظف غير نشط' }
    }
  }
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: string }).code) : ''
  if (code === PRISMA_NOT_FOUND) return { status: 404, message: 'غير موجود' }
  if (code === 'P2023' || code === 'P2000') return { status: 400, message: 'معرّف غير صالح' }
  return { status: 500, message: fallbackMessage }
}

export function sendRouteError(res: Response, error: unknown, fallbackMessage: string) {
  const { status, message } = mapError(error, fallbackMessage)
  return res.status(status).json({ success: false, error: message })
}
