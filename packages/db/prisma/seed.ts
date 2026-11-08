import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

/** Production installer: admin + minimal lookup data only (no items, sales, demo users). */
const isClientSeed =
  process.env.SEED_PROFILE === 'client' || process.argv.includes('--client')

async function main() {
  for (const table of [
    'Supplier',
    'Customer',
    'SalesInvoice',
    'SalesInvoiceItem',
    'PurchaseInvoice',
    'PurchaseInvoiceItem',
    'Expense',
    'PaymentVoucher',
  ] as const) {
    await prisma.$executeRawUnsafe(
      `UPDATE "${table}" SET currency = 'EGP' WHERE currency IN ('IQD', 'USD')`,
    )
  }

  const passwordHash = await bcrypt.hash('admin123', 12)
  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: isClientSeed
      ? { name: 'مدير النظام', role: 'ADMIN', isActive: true }
      : {},
    create: {
      username: 'admin',
      name: isClientSeed ? 'مدير النظام' : 'System Administrator',
      passwordHash,
      role: 'ADMIN',
      language: 'ar',
    },
  })

  if (!isClientSeed) {
    await prisma.user.upsert({
      where: { username: 'manager1' },
      update: {},
      create: {
        username: 'manager1',
        name: 'مدير تجريبي',
        passwordHash: await bcrypt.hash('manager123', 12),
        role: 'MANAGER',
        language: 'ar',
      },
    })
    await prisma.user.upsert({
      where: { username: 'cashier1' },
      update: {},
      create: {
        username: 'cashier1',
        name: 'كاشير تجريبي',
        passwordHash: await bcrypt.hash('cashier123', 12),
        role: 'CASHIER',
        language: 'ar',
      },
    })
  } else {
    await prisma.user.deleteMany({ where: { username: { in: ['manager1', 'cashier1'] } } })
  }

  const itemCategories = isClientSeed
    ? [{ name_ar: 'عام', name_en: 'General' }]
    : [
        { name_ar: 'تلفزيونات وشاشات', name_en: 'TVs & Displays' },
        { name_ar: 'ثلاجات وديب فريزر', name_en: 'Refrigerators & Freezers' },
        { name_ar: 'غسالات', name_en: 'Washing Machines' },
        { name_ar: 'مكيفات', name_en: 'Air Conditioners' },
        { name_ar: 'أجهزة مطبخ', name_en: 'Kitchen Appliances' },
        { name_ar: 'أجهزة صغيرة', name_en: 'Small Appliances' },
        { name_ar: 'فساتين', name_en: 'Dresses' },
        { name_ar: 'بلوزات وتوبات', name_en: 'Blouses & Tops' },
        { name_ar: 'بناطيل وتنانير', name_en: 'Pants & Skirts' },
        { name_ar: 'إكسسوارات', name_en: 'Accessories' },
        { name_ar: 'أخرى', name_en: 'Other' },
      ]

  if (isClientSeed) {
    await prisma.category.deleteMany({
      where: { id: { not: 'cat-general' } },
    })
  }

  for (const cat of itemCategories) {
    const id = isClientSeed
      ? 'cat-general'
      : `cat-${cat.name_en.toLowerCase().replace(/\s+/g, '-')}`
    await prisma.category.upsert({
      where: { id },
      update: { name_ar: cat.name_ar, name_en: cat.name_en },
      create: { id, ...cat },
    })
  }

  const expenseCategories = [
    { name_ar: 'إيجار', name_en: 'Rent' },
    { name_ar: 'خدمات', name_en: 'Utilities' },
    { name_ar: 'رواتب', name_en: 'Salaries' },
    { name_ar: 'نقل', name_en: 'Transport' },
    { name_ar: 'أخرى', name_en: 'Other' },
  ]

  for (const cat of expenseCategories) {
    await prisma.expenseCategory.upsert({
      where: { id: `expcat-${cat.name_en.toLowerCase()}` },
      update: {},
      create: {
        id: `expcat-${cat.name_en.toLowerCase()}`,
        ...cat,
      },
    })
  }

  const settings = [
    { key: 'exchange_rate', value: '1', description: 'Not used (single currency EGP)' },
    {
      key: 'business_name_ar',
      value: isClientSeed ? '' : 'معرضي',
      description: 'Business name in Arabic',
    },
    {
      key: 'business_name_en',
      value: isClientSeed ? '' : 'My Store',
      description: 'Business name in English',
    },
    { key: 'business_address', value: '', description: 'Business address' },
    { key: 'business_phone', value: '', description: 'Business phone number' },
    { key: 'default_currency', value: 'EGP', description: 'Default currency (Egyptian Pound)' },
    { key: 'default_price_type', value: 'RETAIL', description: 'Default price type for sales' },
    { key: 'default_language', value: 'ar', description: 'Default UI language' },
    { key: 'tax_rate', value: '14', description: 'VAT rate percentage (Egypt)' },
    {
      key: 'invoice_footer_ar',
      value: 'شكراً لتعاملكم معنا',
      description: 'Invoice footer text in Arabic',
    },
    {
      key: 'invoice_footer_en',
      value: 'Thank you for your business',
      description: 'Invoice footer text in English',
    },
    {
      key: 'invoice_marketing_enabled',
      value: 'true',
      description: 'Show Galaxy Digital marketing line on printed invoices',
    },
    {
      key: 'invoice_marketing_brand',
      value: 'Galaxy Digital',
      description: 'Marketing brand name on invoice footer',
    },
    {
      key: 'invoice_facebook_handle',
      value: 'GalaxyDigitalEG',
      description: 'Facebook page handle (no URL)',
    },
    { key: 'minimum_stock_alert', value: 'true', description: 'Enable minimum stock alerts' },
    { key: 'paper_width', value: 'A4', description: 'Receipt printer paper width (mm): 58, 80, or A4' },
    { key: 'auto_backup_enabled', value: 'true', description: 'Automatic database backup' },
    { key: 'auto_backup_interval_hours', value: '24', description: 'Hours between automatic backups (default 24 for new installs)' },
    { key: 'auto_backup_keep_count', value: '30', description: 'Max backup files to keep' },
    { key: 'backup_on_exit', value: 'true', description: 'Backup database when desktop app closes' },
  ]

  for (const s of settings) {
    await prisma.settings.upsert({
      where: { key: s.key },
      update: isClientSeed ? { value: s.value } : {},
      create: s,
    })
  }

  const rateCount = await prisma.exchangeRateHistory.count()
  if (rateCount === 0) {
    await prisma.exchangeRateHistory.create({
      data: { rateEGP: 1, changedById: admin.id },
    })
  }

  if (isClientSeed) {
    console.log('✅ Client seed complete (empty store — no items/sales/customers)')
    console.log('   admin / admin123 — change password after first login')
  } else {
    console.log('✅ Dev seed complete')
    console.log('   admin / admin123   manager1 / manager123   cashier1 / cashier123')
  }
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
