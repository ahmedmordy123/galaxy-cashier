import { PrismaClient } from '@prisma/client'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { logger } from '../utils/logger'
import { repairStockBalanceMismatches } from '../services/stock-ops.service'

function databaseUrl(): string | null {
  const raw = process.env.DATABASE_URL?.replace(/^["']|["']$/g, '')
  if (!raw?.startsWith('file:')) return null
  return raw
}

async function hasTable(prisma: PrismaClient, table: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    table,
  )
  return rows.length > 0
}

async function hasColumn(prisma: PrismaClient, table: string, column: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `PRAGMA table_info("${table}")`,
  )
  return rows.some((r) => r.name === column)
}

/** SQLite DDL for features added after older seed.db installs (no Prisma CLI in Electron). */
async function applySqlitePatches(prisma: PrismaClient): Promise<void> {
  if (!(await hasTable(prisma, 'CashierShift'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "CashierShift" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "closedAt" DATETIME,
        "openingCash" DECIMAL NOT NULL DEFAULT 0,
        "closingCash" DECIMAL,
        "expectedCash" DECIMAL,
        "notes" TEXT,
        "status" TEXT NOT NULL DEFAULT 'OPEN',
        CONSTRAINT "CashierShift_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
      );
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX "CashierShift_userId_idx" ON "CashierShift"("userId");`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "CashierShift_status_idx" ON "CashierShift"("status");`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "CashierShift_openedAt_idx" ON "CashierShift"("openedAt");`)
    logger.info('[db] Created table CashierShift')
  }

  if (await hasTable(prisma, 'SalesInvoice') && !(await hasColumn(prisma, 'SalesInvoice', 'shiftId'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "SalesInvoice" ADD COLUMN "shiftId" TEXT;`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "SalesInvoice_shiftId_idx" ON "SalesInvoice"("shiftId");`)
    logger.info('[db] Added SalesInvoice.shiftId')
  }

  if (await hasTable(prisma, 'SalesInvoice') && !(await hasColumn(prisma, 'SalesInvoice', 'discountType'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "SalesInvoice" ADD COLUMN "discountType" TEXT NOT NULL DEFAULT 'PERCENT';`)
    logger.info('[db] Added SalesInvoice.discountType')
  }

  if (await hasTable(prisma, 'PurchaseInvoice') && !(await hasColumn(prisma, 'PurchaseInvoice', 'paymentType'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "PurchaseInvoice" ADD COLUMN "paymentType" TEXT NOT NULL DEFAULT 'CREDIT';`)
    logger.info('[db] Added PurchaseInvoice.paymentType')
  }

  if (await hasTable(prisma, 'User') && !(await hasColumn(prisma, 'User', 'failedLoginAttempts'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0;`)
    logger.info('[db] Added User.failedLoginAttempts')
  }
  if (await hasTable(prisma, 'User') && !(await hasColumn(prisma, 'User', 'lockedUntil'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN "lockedUntil" DATETIME;`)
    logger.info('[db] Added User.lockedUntil')
  }

  const shiftCols: Array<[string, string]> = [
    ['shiftCashIn', 'DECIMAL DEFAULT 0'],
    ['shiftCashRefunds', 'DECIMAL DEFAULT 0'],
    ['shiftReceipts', 'DECIMAL DEFAULT 0'],
    ['shiftDisbursements', 'DECIMAL DEFAULT 0'],
    ['shiftExpenses', 'DECIMAL DEFAULT 0'],
    ['shiftStaffAdvances', 'DECIMAL DEFAULT 0'],
  ]
  for (const [col, ddl] of shiftCols) {
    if ((await hasTable(prisma, 'CashierShift')) && !(await hasColumn(prisma, 'CashierShift', col))) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "CashierShift" ADD COLUMN "${col}" ${ddl};`)
      logger.info(`[db] Added CashierShift.${col}`)
    }
  }

  if (!(await hasTable(prisma, 'StaffAdvance'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "StaffAdvance" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "employeeId" TEXT NOT NULL,
        "amount" DECIMAL NOT NULL,
        "currency" TEXT NOT NULL DEFAULT 'EGP',
        "exchangeRate" DECIMAL NOT NULL DEFAULT 1,
        "date" DATETIME NOT NULL,
        "notes" TEXT,
        "shiftId" TEXT NOT NULL,
        "createdById" TEXT NOT NULL,
        "isActive" BOOLEAN NOT NULL DEFAULT 1,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        CONSTRAINT "StaffAdvance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "StaffAdvance_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "StaffAdvance_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashierShift" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
      );
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX "StaffAdvance_employeeId_idx" ON "StaffAdvance"("employeeId");`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "StaffAdvance_date_idx" ON "StaffAdvance"("date");`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "StaffAdvance_shiftId_idx" ON "StaffAdvance"("shiftId");`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "StaffAdvance_isActive_idx" ON "StaffAdvance"("isActive");`)
    logger.info('[db] Created table StaffAdvance')
  }

  if (!(await hasTable(prisma, 'AuditLog'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "AuditLog" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "action" TEXT NOT NULL,
        "entityType" TEXT NOT NULL,
        "entityId" TEXT,
        "detailsJson" TEXT,
        "ip" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
      );
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");`)
    logger.info('[db] Created table AuditLog')
  }

  if (await hasTable(prisma, 'PurchaseInvoice') && !(await hasColumn(prisma, 'PurchaseInvoice', 'supplierRef'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "PurchaseInvoice" ADD COLUMN "supplierRef" TEXT;`)
    logger.info('[db] Added PurchaseInvoice.supplierRef')
  }

  // ── v1.1 price override + VAT snapshot columns ─────────────────────────────
  if (await hasTable(prisma, 'User') && !(await hasColumn(prisma, 'User', 'canEditPrice'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN "canEditPrice" BOOLEAN NOT NULL DEFAULT 0;`)
    // Admins/managers get the permission by default on existing DBs
    await prisma.$executeRawUnsafe(
      `UPDATE "User" SET "canEditPrice"=1 WHERE "role" IN ('ADMIN','MANAGER')`,
    )
    logger.info('[db] Added User.canEditPrice')
  }
  if (await hasTable(prisma, 'Item') && !(await hasColumn(prisma, 'Item', 'taxExempt'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Item" ADD COLUMN "taxExempt" BOOLEAN NOT NULL DEFAULT 0;`)
    logger.info('[db] Added Item.taxExempt')
  }
  const invSnap: Array<[string, string]> = [
    ['taxEnabled', 'BOOLEAN NOT NULL DEFAULT 1'],
    ['taxMode', "TEXT NOT NULL DEFAULT 'INCLUSIVE'"],
    ['taxRate', 'DECIMAL NOT NULL DEFAULT 0'],
    ['netOfTax', 'DECIMAL NOT NULL DEFAULT 0'],
    ['soldBelowCost', 'BOOLEAN NOT NULL DEFAULT 0'],
    ['hasPriceOverride', 'BOOLEAN NOT NULL DEFAULT 0'],
  ]
  if (await hasTable(prisma, 'SalesInvoice')) {
    for (const [col, ddl] of invSnap) {
      if (!(await hasColumn(prisma, 'SalesInvoice', col))) {
        await prisma.$executeRawUnsafe(`ALTER TABLE "SalesInvoice" ADD COLUMN "${col}" ${ddl};`)
        logger.info(`[db] Added SalesInvoice.${col}`)
      }
    }
  }
  const lineSnap: Array<[string, string]> = [
    ['originalUnitPrice', 'DECIMAL NOT NULL DEFAULT 0'],
    ['priceOverridden', 'BOOLEAN NOT NULL DEFAULT 0'],
    ['taxExempt', 'BOOLEAN NOT NULL DEFAULT 0'],
  ]
  if (await hasTable(prisma, 'SalesInvoiceItem')) {
    for (const [col, ddl] of lineSnap) {
      if (!(await hasColumn(prisma, 'SalesInvoiceItem', col))) {
        await prisma.$executeRawUnsafe(`ALTER TABLE "SalesInvoiceItem" ADD COLUMN "${col}" ${ddl};`)
        logger.info(`[db] Added SalesInvoiceItem.${col}`)
      }
    }
    // Backfill originalUnitPrice from unitPrice where still 0
    await prisma.$executeRawUnsafe(
      `UPDATE "SalesInvoiceItem" SET "originalUnitPrice"="unitPrice" WHERE "originalUnitPrice"=0 AND "unitPrice"<>0`,
    )
  }

  // Default settings keys (upsert-like via insert if missing)
  const defaultSettings: Array<[string, string]> = [
    ['vat_enabled', 'true'],
    ['tax_mode', 'INCLUSIVE'],
    ['below_cost_policy', 'WARN'],
  ]
  if (await hasTable(prisma, 'Settings')) {
    for (const [key, value] of defaultSettings) {
      const rows = await prisma.$queryRawUnsafe<Array<{ key: string }>>(
        `SELECT "key" FROM "Settings" WHERE "key"=?`,
        key,
      )
      if (rows.length === 0) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "Settings" ("id","key","value","updatedAt") VALUES (?,?,?,CURRENT_TIMESTAMP)`,
          `set-${key}`,
          key,
          value,
        )
        logger.info(`[db] Seeded setting ${key}=${value}`)
      }
    }
  }

  const etaCols: Array<[string, string]> = [
    ['documentType', 'TEXT DEFAULT \'RECEIPT\''],
    ['retryCount', 'INTEGER DEFAULT 0'],
    ['lastError', 'TEXT'],
  ]
  if (await hasTable(prisma, 'EtaDocument')) {
    for (const [col, ddl] of etaCols) {
      if (!(await hasColumn(prisma, 'EtaDocument', col))) {
        await prisma.$executeRawUnsafe(`ALTER TABLE "EtaDocument" ADD COLUMN "${col}" ${ddl};`)
        logger.info(`[db] Added EtaDocument.${col}`)
      }
    }
  }
}

function tryPrismaDbPush(dbUrl: string): boolean {
  const candidates = [
    path.resolve(__dirname, '../../../packages/db'),
    path.resolve(__dirname, '../../../../packages/db'),
    path.resolve(process.cwd(), 'packages/db'),
  ]
  const dbPackage = candidates.find((p) => fs.existsSync(path.join(p, 'prisma', 'schema.prisma')))
  if (!dbPackage) return false

  try {
    execSync('npx prisma db push --accept-data-loss --skip-generate', {
      cwd: dbPackage,
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: 'pipe',
      timeout: 120_000,
    })
    return true
  } catch (e) {
    logger.warn(`[db] prisma db push skipped: ${e instanceof Error ? e.message : e}`)
    return false
  }
}

/**
 * Keeps local SQLite DBs in sync when tables were added after an old seed (e.g. CashierShift).
 */
export async function ensureSqliteSchema(): Promise<void> {
  const dbUrl = databaseUrl()
  if (!dbUrl) return

  const prisma = new PrismaClient()
  try {
    const hasShift = await hasTable(prisma, 'CashierShift')
    if (!hasShift) {
      logger.warn('[db] SQLite schema missing CashierShift — upgrading…')
      if (!tryPrismaDbPush(dbUrl)) {
        await applySqlitePatches(prisma)
      }
    } else {
      await applySqlitePatches(prisma)
    }

    // Item form used to write stockQty without StockBalance; sales deduct balances.
    if (await hasTable(prisma, 'StockBalance')) {
      const fixed = await repairStockBalanceMismatches(prisma)
      if (fixed > 0) {
        logger.info(`[db] Repaired StockBalance for ${fixed} item(s)`)
      }
    }
  } finally {
    await prisma.$disconnect()
  }
}
