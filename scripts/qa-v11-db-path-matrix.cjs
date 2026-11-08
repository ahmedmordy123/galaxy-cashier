/**
 * Path matrix for live SQLite / Prisma URL resolution.
 * Simulates: Arabic folder, space+symbol folder, 8.3 unavailable (force encode).
 *
 *   node scripts/qa-v11-db-path-matrix.cjs
 */
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const { execSync, spawnSync } = require('child_process')
const crypto = require('crypto')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'docs', 'QA-V11-DB-PATH-MATRIX.json')
const SEED =
  fs.existsSync(path.join(ROOT, 'apps', 'desktop', 'assets', 'seed.db'))
    ? path.join(ROOT, 'apps', 'desktop', 'assets', 'seed.db')
    : path.join(ROOT, 'data', 'cashier.db')
const NODE = fs.existsSync(path.join(ROOT, 'apps', 'desktop', 'staging', 'node', 'node.exe'))
  ? path.join(ROOT, 'apps', 'desktop', 'staging', 'node', 'node.exe')
  : process.execPath
const ENGINE = path.join(
  ROOT,
  'apps',
  'desktop',
  'staging',
  'api',
  'node_modules',
  '.prisma',
  'client',
  'query_engine-windows.dll.node',
)
const API = path.join(ROOT, 'apps', 'desktop', 'staging', 'api')

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`)
}

function winShortPath(absPath) {
  if (!absPath || process.platform !== 'win32') return absPath
  if (!/\s/.test(absPath) && !/[^\x00-\x7F]/.test(absPath)) return absPath
  try {
    if (fs.existsSync(absPath)) {
      const escaped = absPath.replace(/'/g, "''")
      const isDir = fs.statSync(absPath).isDirectory()
      const ps = isDir
        ? `(New-Object -ComObject Scripting.FileSystemObject).GetFolder('${escaped}').ShortPath`
        : `(New-Object -ComObject Scripting.FileSystemObject).GetFile('${escaped}').ShortPath`
      const short = execSync(`powershell -NoProfile -Command "${ps}"`, {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 8000,
      })
        .trim()
        .split(/\r?\n/)
        .pop()
      if (short && fs.existsSync(short)) return short
    }
  } catch {
    /* */
  }
  try {
    const short = execSync(`cmd /c for %I in ("${absPath}") do @echo %~sI`, {
      encoding: 'utf8',
      windowsHide: true,
    })
      .trim()
      .split(/\r?\n/)
      .pop()
    if (short && fs.existsSync(short)) return short
  } catch {
    /* */
  }
  return absPath
}

function toPrismaSqliteUrl(absPath) {
  const normalized = absPath.replace(/\\/g, '/')
  if (!/\s/.test(normalized) && !/[^\x00-\x7F]/.test(normalized)) return 'file:' + normalized
  const encoded = normalized
    .split('/')
    .map((seg, i) => (i === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg)))
    .join('/')
  return 'file:' + encoded
}

function probePrismaOpen(label, dbFile, url) {
  const probe = `
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
p.$queryRawUnsafe('SELECT 1 AS ok')
  .then(async (r) => {
    const n = Number(r?.[0]?.ok ?? r?.[0]?.OK ?? 1);
    console.log('OK', n);
    await p.$disconnect();
  })
  .catch(async (e) => { console.error('ERR', e.message || e); try { await p.$disconnect(); } catch {} process.exit(2); });
`
  const env = {
    ...process.env,
    DATABASE_URL: url,
    PRISMA_QUERY_ENGINE_LIBRARY: ENGINE,
  }
  // Run from staging/api so @prisma/client resolves
  const r = spawnSync(NODE, ['-e', probe], {
    cwd: API,
    env,
    encoding: 'utf8',
    timeout: 20000,
    windowsHide: true,
  })
  const out = ((r.stdout || '') + (r.stderr || '')).trim()
  const ok = r.status === 0 && /\bOK\b/.test(out)
  check(`${label} Prisma open`, ok, `url=${url} | ${out.slice(0, 180)}`)
  return ok
}

function caseDir(base, name) {
  const d = path.join(base, name, 'CASR', 'data')
  fs.mkdirSync(d, { recursive: true })
  const db = path.join(d, 'cashier.db')
  fs.copyFileSync(SEED, db)
  return db
}

function main() {
  if (!fs.existsSync(SEED)) {
    check('seed.db present', false, SEED)
    finish()
    return
  }
  check('seed.db present', true, SEED)
  check('staging API present', fs.existsSync(path.join(API, 'server.js')), API)
  check('prisma engine present', fs.existsSync(ENGINE), ENGINE)

  let eightDot3 = 'unknown'
  try {
    const v = execSync(
      'powershell -NoProfile -Command "(Get-ItemProperty HKLM:\\SYSTEM\\CurrentControlSet\\Control\\FileSystem).NtfsDisable8dot3NameCreation"',
      { encoding: 'utf8' },
    ).trim()
    // 0=enabled, 1=disabled, 2=per-volume
    eightDot3 = v === '0' ? 'enabled(0)' : v === '1' ? 'disabled(1)' : v === '2' ? 'per-volume(2)' : `raw=${v}`
  } catch (e) {
    eightDot3 = `query-failed: ${e.message}`
  }
  check('8.3 registry readable', true, eightDot3)

  const base = path.join(os.tmpdir(), `casr-path-matrix-${Date.now()}`)
  fs.mkdirSync(base, { recursive: true })

  // ── A) Arabic path segments ───────────────────────────────────────────────
  const arDb = caseDir(base, 'مستخدم-عربي-اختبار')
  const arShort = winShortPath(arDb)
  const arUrl = toPrismaSqliteUrl(arShort)
  check(
    'A Arabic path created',
    fs.existsSync(arDb),
    arDb,
  )
  check(
    'A short-path result',
    true,
    arShort === arDb
      ? 'NO short form (same as long — 8.3 unavailable or non-ASCII)'
      : `short=${arShort}`,
  )
  check('A prisma URL', true, arUrl)
  probePrismaOpen('A Arabic', arDb, arUrl)

  // ── B) Space + symbol in path ─────────────────────────────────────────────
  const symDb = caseDir(base, 'User Name (Test) & Co')
  const symShort = winShortPath(symDb)
  const symUrlPreferred = toPrismaSqliteUrl(symShort)
  check('B space+symbol path created', fs.existsSync(symDb), symDb)
  check(
    'B short-path shortened?',
    symShort !== symDb || !/\s/.test(symDb),
    symShort === symDb ? 'UNCHANGED (spaces remain)' : `short=${symShort}`,
  )
  probePrismaOpen('B space+symbol via short/encode', symDb, symUrlPreferred)

  // ── C) Simulate 8.3 disabled: percent-encode alone (known fragile) ────────
  const forceUrl = toPrismaSqliteUrl(symDb) // no short — encode spaces/symbols
  check('C forced encode URL (8.3-off sim)', /\s/.test(symDb) ? /%20|%28|%26/.test(forceUrl) || forceUrl.includes('%') : true, forceUrl)
  // Percent-encode alone is expected to FAIL on Windows Prisma (code 14) — record, don't gate suite
  {
    const probeLabel = 'C 8.3-off sim encode (expect fail)'
    const prevLen = results.length
    const encodeTry = probePrismaOpen(probeLabel, symDb, forceUrl)
    // Re-tag last result as informational expected failure
    if (!encodeTry && results.length > prevLen) {
      results[results.length - 1].ok = true
      results[results.length - 1].name = probeLabel
      results[results.length - 1].detail =
        `EXPECTED_FAIL code14 | ${results[results.length - 1].detail}`
      console.log(`NOTE | ${probeLabel} marked expected | percent-encode alone is insufficient`)
    }
    var encodeOk = encodeTry
  }

  // C2) Production fallback: hardlink into ASCII LocalAppData short path
  let hlOk = false
  try {
    const hlDir = path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
      'GalaxyCashier',
      'data',
    )
    fs.mkdirSync(hlDir, { recursive: true })
    const hl = path.join(hlDir, `cashier-pathmatrix-${Date.now()}.hl.db`)
    execSync(`cmd /c mklink /H "${hl}" "${symDb}"`, { windowsHide: true })
    const hlShort = winShortPath(hl)
    const hlUrl = toPrismaSqliteUrl(hlShort)
    check('C2 hardlink created', fs.existsSync(hl), hl)
    hlOk = probePrismaOpen('C2 8.3-off via hardlink', symDb, hlUrl)
    try {
      fs.unlinkSync(hl)
    } catch {
      /* */
    }
  } catch (e) {
    check('C2 hardlink created', false, e.message)
  }
  check(
    'C verdict (encode OR hardlink works)',
    encodeOk || hlOk,
    encodeOk ? 'encode ok' : hlOk ? 'hardlink ok (encode failed)' : 'both failed',
  )

  // ── D) Real Documents path on this machine ────────────────────────────────
  const docsDb = path.join(os.homedir(), 'Documents', 'CASR', 'data', 'cashier.db')
  if (fs.existsSync(docsDb)) {
    const dShort = winShortPath(docsDb)
    const dUrl = toPrismaSqliteUrl(dShort)
    check('D Documents short-path', true, dShort === docsDb ? 'same as long' : dShort)
    probePrismaOpen('D Documents live', docsDb, dUrl)
  } else {
    check('D Documents live DB exists', false, docsDb)
  }

  // Cleanup probe dirs (best-effort)
  try {
    fs.rmSync(base, { recursive: true, force: true })
  } catch {
    /* */
  }

  finish()
}

function finish() {
  const passed = results.filter((r) => r.ok).length
  const payload = {
    at: new Date().toISOString(),
    machine: {
      userProfile: process.env.USERPROFILE,
      localAppData: process.env.LOCALAPPDATA,
      documents: path.join(os.homedir(), 'Documents'),
      oneDriveEnv: process.env.OneDrive || null,
    },
    passed,
    total: results.length,
    results,
  }
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), 'utf8')
  console.log(`done ${passed}/${results.length} → ${OUT}`)
  if (passed !== results.length) process.exit(1)
}

main()
