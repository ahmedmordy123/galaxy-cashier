import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { AuthUser } from '@ims-pro/types'

export function verifyToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'No token provided' })
  }
  const token = authHeader.slice(7)
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as {
      sub: string
      role: string
      username: string
      name: string
      language: string
      canEditPrice?: boolean
    }
    req.user = {
      id: payload.sub,
      role: payload.role as AuthUser['role'],
      username: payload.username,
      name: payload.name,
      language: payload.language as AuthUser['language'],
      canEditPrice:
        Boolean(payload.canEditPrice) ||
        payload.role === 'ADMIN' ||
        payload.role === 'MANAGER',
    }
    next()
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' })
  }
}
