/**
 * One-time data migration after schema push:
 * - Ensure default warehouse
 * - Copy Item.stockQty → StockBalance
 * - Backfill SalesInvoiceItem.unitCost from Item.costPrice where 0
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })
const { PrismaClient } = require('@prisma/client')

async function main() {
  const prisma = new PrismaClient()
  let wh = await prisma.warehouse.findFirst({ where: { isDefault: true } })
  if (!wh) {
    wh = await prisma.warehouse.create({
      data: { name: 'المخزن الرئيسي', code: 'MAIN', isDefault: true },
    })
    console.log('Created default warehouse', wh.id)
  }

  const items = await prisma.item.findMany()
  let migrated = 0
  for (const item of items) {
    const qty = Number(item.stockQty)
    const existing = await prisma.stockBalance.findUnique({
      where: { itemId_warehouseId: { itemId: item.id, warehouseId: wh.id } },
    })
    if (!existing) {
      await prisma.stockBalance.create({
        data: { itemId: item.id, warehouseId: wh.id, qty },
      })
      migrated++
    }
  }
  console.log(`Migrated balances: ${migrated}`)

  // Backfill unitCost on confirmed sales lines where missing
  const lines = await prisma.salesInvoiceItem.findMany({
    where: { unitCost: 0 },
    include: { item: true },
  })
  let filled = 0
  for (const line of lines) {
    const cost = Number(line.item.costPrice)
    if (cost > 0) {
      await prisma.salesInvoiceItem.update({
        where: { id: line.id },
        data: { unitCost: cost },
      })
      filled++
    }
  }
  console.log(`Backfilled unitCost lines: ${filled}`)

  await prisma.settings.upsert({
    where: { key: 'eta_enabled' },
    create: { key: 'eta_enabled', value: 'false', description: 'Egyptian Tax Authority e-invoice (future)' },
    update: {},
  })

  await prisma.$disconnect()
  console.log('Done')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
