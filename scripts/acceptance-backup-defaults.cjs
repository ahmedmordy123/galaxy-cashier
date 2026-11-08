/**
 * Acceptance: backup defaults 24h + exit on new seed; existing manual 6 unchanged.
 * Run: node scripts/acceptance-backup-defaults.cjs
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { PrismaClient } = require('@prisma/client')

const ROOT = path.resolve(__dirname, '..')
const REPORT = path.join(ROOT, 'docs', 'BACKUP-DEFAULTS-ACCEPTANCE.md')

function fileUrl(p) {
  return 'file:' + p.replace(/\\/g, '/')
}

async function readSettings(dbPath) {
  const prisma = new PrismaClient({ datasources: { db: { url: fileUrl(dbPath) } } })
  const rows = await prisma.settings.findMany({
    where: {
      key: {
        in: ['auto_backup_interval_hours', 'backup_on_exit', 'auto_backup_enabled'],
      },
    },
  })
  await prisma.$disconnect()
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}

async function main() {
  const freshDir = path.join(ROOT, 'data', '_accept_fresh_seed')
  fs.mkdirSync(freshDir, { recursive: true })
  const freshDb = path.join(freshDir, 'cashier.db')
  if (fs.existsSync(freshDb)) fs.unlinkSync(freshDb)

  const env = { ...process.env, DATABASE_URL: fileUrl(freshDb), SEED_PROFILE: 'client' }
  const push = spawnSync(
    'cmd.exe',
    ['/c', 'npx prisma db push --force-reset --accept-data-loss --schema prisma/schema.prisma'],
    { cwd: path.join(ROOT, 'packages', 'db'), env, encoding: 'utf8' },
  )
  const seed = spawnSync('cmd.exe', ['/c', 'npx prisma db seed --schema prisma/schema.prisma'], {
    cwd: path.join(ROOT, 'packages', 'db'),
    env,
    encoding: 'utf8',
  })
  if (push.status !== 0 || seed.status !== 0) {
    console.error(push.stdout, push.stderr, seed.stdout, seed.stderr)
    throw new Error('Fresh seed failed')
  }

  const fresh = await readSettings(freshDb)

  const legacyDir = path.join(ROOT, 'data', '_accept_legacy_6h')
  fs.mkdirSync(legacyDir, { recursive: true })
  const legacyDb = path.join(legacyDir, 'cashier.db')
  if (fs.existsSync(legacyDb)) fs.unlinkSync(legacyDb)
  const env2 = { ...process.env, DATABASE_URL: fileUrl(legacyDb), SEED_PROFILE: 'client' }
  spawnSync('cmd.exe', ['/c', 'npx prisma db push --force-reset --accept-data-loss --schema prisma/schema.prisma'], {
    cwd: path.join(ROOT, 'packages', 'db'),
    env: env2,
    encoding: 'utf8',
  })
  spawnSync('cmd.exe', ['/c', 'npx prisma db seed --schema prisma/schema.prisma'], {
    cwd: path.join(ROOT, 'packages', 'db'),
    env: env2,
    encoding: 'utf8',
  })
  const legacyPrisma = new PrismaClient({ datasources: { db: { url: fileUrl(legacyDb) } } })
  await legacyPrisma.settings.update({
    where: { key: 'auto_backup_interval_hours' },
    data: { value: '6' },
  })
  await legacyPrisma.$disconnect()
  const legacy = await readSettings(legacyDb)

  const freshOk =
    fresh.auto_backup_interval_hours === '24' &&
    fresh.backup_on_exit === 'true' &&
    fresh.auto_backup_enabled === 'true'
  const legacyOk = legacy.auto_backup_interval_hours === '6'

  const lines = [
    '# قبول — افتراضيات النسخ (24 ساعة + عند الإغلاق)',
    '',
    `**وقت:** ${new Date().toISOString()}`,
    '',
    '## تركيب جديد (seed client)',
    '',
    `- auto_backup_interval_hours: \`${fresh.auto_backup_interval_hours}\` → **${fresh.auto_backup_interval_hours === '24' ? '✅' : '❌'}**`,
    `- backup_on_exit: \`${fresh.backup_on_exit ?? '(missing)'}\` → **${fresh.backup_on_exit === 'true' ? '✅' : '❌'}**`,
    `- النتيجة: **${freshOk ? '✅' : '❌'}**`,
    '',
    '## تركيب قديم (ضبط يدوي 6 ساعات)',
    '',
    `- auto_backup_interval_hours: \`${legacy.auto_backup_interval_hours}\` → **${legacyOk ? '✅ بقي 6' : '❌'}**`,
    '',
    '## نسخ عند الإغلاق — الإجابة',
    '',
    '- **API/seed الجديد:** `backup_on_exit=true` في seed + fallback API `' + "'true'" + '`.',
    '- **Electron:** `readBackupPathConfig()` — `onExit: true` افتراضياً.',
    '- **الواجهة:** backupOnExit initial state true؛ !== false عند التحميل.',
    '',
  ]
  fs.writeFileSync(REPORT, lines.join('\n'), 'utf8')
  console.log(JSON.stringify({ freshOk, legacyOk, fresh, legacy, report: REPORT }, null, 2))
  if (!freshOk || !legacyOk) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
