
import bcrypt from 'bcryptjs'
import { prisma } from '../db/prisma'

// ─── Settings functions ───────────────────────────────────────────────────────

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await prisma.settings.findMany()
  return rows.reduce<Record<string, string>>((acc, row) => {
    acc[row.key] = row.value
    return acc
  }, {})
}

export async function updateSettings(data: Record<string, string>): Promise<Record<string, string>> {
  if (data.backup_directory !== undefined && data.backup_directory.trim()) {
    const { sanitizeBackupDirectory } = await import('../utils/dataPaths')
    const { assertBackupPathWritable, isPathUnderGoogleDrive, detectGoogleDrive } = await import(
      '../utils/googleDrive'
    )
    const sanitized = sanitizeBackupDirectory(data.backup_directory)
    if (!sanitized) {
      throw new Error('مسار النسخ الاحتياطي غير صالح — استخدم مساراً مطلقاً مثل D:\\Backups\\CASR')
    }
    const writable = assertBackupPathWritable(sanitized)
    if (!writable.ok) {
      throw new Error(writable.error)
    }
    data.backup_directory = sanitized
    const gd = detectGoogleDrive()
    if (!isPathUnderGoogleDrive(sanitized, gd.roots)) {
      // Soft: still allow, but callers can read hint from status. Store flag in description via separate key optional.
      data.backup_path_drive_warning = 'true'
    } else {
      data.backup_path_drive_warning = 'false'
    }
  }

  // Secondary path (USB): sanitize only — may be absent at save time; mirror is best-effort.
  if (data.backup_directory_secondary !== undefined) {
    const { sanitizeBackupDirectory } = await import('../utils/dataPaths')
    const trimmed = data.backup_directory_secondary.trim()
    if (!trimmed) {
      data.backup_directory_secondary = ''
    } else {
      const sanitized = sanitizeBackupDirectory(trimmed)
      if (!sanitized) {
        throw new Error('مسار النسخة الثانية غير صالح — استخدم مساراً مطلقاً مثل E:\\CASR-Backups')
      }
      data.backup_directory_secondary = sanitized
    }
  }

  await Promise.all(
    Object.entries(data).map(([key, value]) =>
      prisma.settings.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      })
    )
  )
  if (
    'backup_directory' in data ||
    'backup_directory_secondary' in data ||
    'backup_on_exit' in data ||
    'auto_backup_enabled' in data
  ) {
    try {
      const { syncBackupPathConfigFromSettings } = await import('./backup.service')
      await syncBackupPathConfigFromSettings()
    } catch {
      /* non-fatal */
    }
  }
  return getAllSettings()
}

export async function updateExchangeRate(rate: number, userId: string) {
  return prisma.$transaction([
    prisma.settings.update({
      where: { key: 'exchange_rate' },
      data: { value: String(rate) },
    }),
    prisma.exchangeRateHistory.create({
      data: {
        rateEGP: rate,
        changedById: userId,
      },
    }),
  ])
}

export async function getExchangeRateHistory() {
  return prisma.exchangeRateHistory.findMany({
    include: {
      changedBy: {
        select: { id: true, name: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
}

// ─── User management functions ────────────────────────────────────────────────

export async function getUsers() {
  return prisma.user.findMany({
    select: {
      id: true,
      name: true,
      username: true,
      role: true,
      language: true,
      isActive: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  })
}

export async function createUser(data: {
  name: string
  username: string
  password: string
  role: 'ADMIN' | 'MANAGER' | 'CASHIER' | 'VIEWER' | 'ACCOUNTANT' | 'STAFF'
  language: 'ar' | 'en'
}) {
  const existing = await prisma.user.findFirst({ where: { username: data.username } })
  if (existing) {
    throw new Error('USERNAME_TAKEN')
  }

  const passwordHash = await bcrypt.hash(data.password, 12)

  const user = await prisma.user.create({
    data: {
      name: data.name,
      username: data.username,
      passwordHash,
      role: data.role,
      language: data.language,
    },
    select: {
      id: true,
      name: true,
      username: true,
      role: true,
      language: true,
      isActive: true,
      createdAt: true,
    },
  })

  return user
}

export async function updateUser(
  id: string,
  data: {
    name?: string
    role?: 'ADMIN' | 'MANAGER' | 'CASHIER' | 'VIEWER' | 'ACCOUNTANT' | 'STAFF'
    language?: 'ar' | 'en'
    isActive?: boolean
  }
) {
  return prisma.user.update({
    where: { id },
    data,
    select: {
      id: true,
      name: true,
      username: true,
      role: true,
      language: true,
      isActive: true,
    },
  })
}

export async function resetPassword(id: string, newPassword: string) {
  const hash = await bcrypt.hash(newPassword, 12)
  return prisma.user.update({
    where: { id },
    data: { passwordHash: hash },
    select: { id: true },
  })
}
