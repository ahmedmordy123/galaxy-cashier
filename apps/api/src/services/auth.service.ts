import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

import { AuthUser } from '@ims-pro/types'
import { prisma } from '../db/prisma'

const MAX_FAILED_ATTEMPTS = 5
const LOCK_DURATION_MS = 20 * 60 * 1000

export async function getLoginLockStatus(username: string): Promise<{ locked: boolean; lockedUntil?: Date }> {
  const user = await prisma.user.findUnique({ where: { username } })
  if (!user?.lockedUntil) return { locked: false }
  if (user.lockedUntil <= new Date()) {
    await prisma.user.update({
      where: { id: user.id },
      data: { lockedUntil: null, failedLoginAttempts: 0 },
    })
    return { locked: false }
  }
  return { locked: true, lockedUntil: user.lockedUntil }
}

async function recordFailedLogin(username: string) {
  const user = await prisma.user.findUnique({ where: { username } })
  if (!user) return
  const next = (user.failedLoginAttempts ?? 0) + 1
  if (next >= MAX_FAILED_ATTEMPTS) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: new Date(Date.now() + LOCK_DURATION_MS),
      },
    })
    return
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: next },
  })
}

async function clearLoginFailures(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  })
}

export async function validateCredentials(username: string, password: string): Promise<AuthUser | null> {
  const lock = await getLoginLockStatus(username)
  if (lock.locked) {
    const err = new Error('ACCOUNT_LOCKED') as Error & { statusCode: number }
    err.statusCode = 423
    throw err
  }

  const user = await prisma.user.findFirst({
    where: { username, isActive: true },
  })
  if (!user) {
    return null
  }
  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) {
    await recordFailedLogin(username)
    return null
  }
  await clearLoginFailures(user.id)
  const canEditPrice =
    Boolean((user as { canEditPrice?: boolean }).canEditPrice) ||
    user.role === 'ADMIN' ||
    user.role === 'MANAGER'
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role as AuthUser['role'],
    language: user.language as AuthUser['language'],
    canEditPrice,
  }
}

export function generateAccessToken(user: AuthUser): string {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      username: user.username,
      name: user.name,
      language: user.language,
      canEditPrice: Boolean(user.canEditPrice),
    },
    process.env.JWT_SECRET!,
    { expiresIn: '15m' },
  )
}

export function generateRefreshToken(userId: string): string {
  return jwt.sign({ sub: userId }, process.env.JWT_REFRESH_SECRET!, { expiresIn: '7d' })
}

export function verifyRefreshToken(token: string): { sub: string } | null {
  try {
    return jwt.verify(token, process.env.JWT_REFRESH_SECRET!) as { sub: string }
  } catch {
    return null
  }
}

export async function getUserById(id: string): Promise<AuthUser | null> {
  const user = await prisma.user.findFirst({ where: { id, isActive: true } })
  if (!user) return null
  const canEditPrice =
    Boolean((user as { canEditPrice?: boolean }).canEditPrice) ||
    user.role === 'ADMIN' ||
    user.role === 'MANAGER'
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role as AuthUser['role'],
    language: user.language as AuthUser['language'],
    canEditPrice,
  }
}
