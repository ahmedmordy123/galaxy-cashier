/**
 * One-shot AppData → Documents migration.
 *   node scripts/qa-fix-appdata-migrate.cjs
 */
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'casr-migrate-'))
const docs = path.join(tmp, 'Documents')
const appData = path.join(tmp, 'AppData')
fs.mkdirSync(path.join(docs, 'CASR', 'data'), { recursive: true })
fs.mkdirSync(path.join(appData, 'CASR'), { recursive: true })

const runner = path.join(tmp, 'run-migrate.mjs')
fs.writeFileSync(
  runner,
  `
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { register } from 'tsx/esm/api'

process.env.CASR_DOCUMENTS_DIR = ${JSON.stringify(docs)}
process.env.APPDATA = ${JSON.stringify(appData)}

await register()
const mod = await import(${JSON.stringify(
    path.join(ROOT, 'apps/api/src/utils/dataPaths.ts').replace(/\\/g, '/'),
  )})

const {
  migrateLiveDbFromAppDataDetailed,
  liveDbPath,
  appDataMigrationMarkerPath,
} = mod

const appDb = path.join(process.env.APPDATA, 'CASR', 'cashier.db')
fs.writeFileSync(appDb, Buffer.from('SQLite format 3\\0v1'))

const r1 = migrateLiveDbFromAppDataDetailed()
const marker = appDataMigrationMarkerPath()
if (!r1.migrated) {
  console.error('first migrate failed', r1)
  process.exit(1)
}
fs.unlinkSync(r1.dest)
fs.writeFileSync(appDb, Buffer.from('SQLite format 3\\0STALE-SHOULD-NOT-COPY'))
const r2 = migrateLiveDbFromAppDataDetailed()
const recreated = fs.existsSync(liveDbPath())
const ok =
  r1.migrated === true &&
  r2.migrated === false &&
  r2.skippedReason === 'already-migrated-once' &&
  recreated === false &&
  fs.existsSync(marker)

console.log(JSON.stringify({ r1, r2, recreated, markerExists: fs.existsSync(marker), ok }, null, 2))
process.exit(ok ? 0 : 1)
`,
)

// Prefer compiling via tsx CLI with a .ts file (more reliable on Windows)
const tsFile = path.join(tmp, 'run-migrate.ts')
fs.writeFileSync(
  tsFile,
  `
import fs from 'fs'
import path from 'path'

process.env.CASR_DOCUMENTS_DIR = ${JSON.stringify(docs)}
process.env.APPDATA = ${JSON.stringify(appData)}

import {
  migrateLiveDbFromAppDataDetailed,
  liveDbPath,
  appDataMigrationMarkerPath,
} from ${JSON.stringify(path.join(ROOT, 'apps/api/src/utils/dataPaths').replace(/\\/g, '/'))}

const appDb = path.join(process.env.APPDATA!, 'CASR', 'cashier.db')
fs.writeFileSync(appDb, Buffer.from('SQLite format 3\\0v1'))

const r1 = migrateLiveDbFromAppDataDetailed()
const marker = appDataMigrationMarkerPath()
fs.unlinkSync(r1.dest)
fs.writeFileSync(appDb, Buffer.from('SQLite format 3\\0STALE'))
const r2 = migrateLiveDbFromAppDataDetailed()
const recreated = fs.existsSync(liveDbPath())
const ok =
  r1.migrated === true &&
  r2.migrated === false &&
  r2.skippedReason === 'already-migrated-once' &&
  recreated === false &&
  fs.existsSync(marker)

console.log(JSON.stringify({ first: r1, second: r2, recreated, markerExists: fs.existsSync(marker), ok }, null, 2))
if (!ok) process.exit(1)
console.log('PASS: AppData migration is one-shot')
`,
)

const r = spawnSync('npx', ['tsx', tsFile], { cwd: ROOT, encoding: 'utf8', shell: true })
process.stdout.write(r.stdout || '')
process.stderr.write(r.stderr || '')
process.exit(r.status === 0 ? 0 : 1)
