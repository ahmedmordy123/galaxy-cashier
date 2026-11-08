/**
 * Re-test Prisma path strategies with REAL verification (table list / same file).
 * cwd-relative is a FALSE positive if Prisma resolves ./ next to the engine.
 *
 *   node scripts/qa-v11-path-solutions.cjs
 */
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawnSync, execSync } = require('child_process')
const crypto = require('crypto')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'docs', 'QA-V11-PATH-SOLUTIONS.json')
const SEED = path.join(ROOT, 'apps', 'desktop', 'assets', 'seed.db')
const DOCS = path.join(os.homedir(), 'Documents', 'CASR', 'data', 'cashier.db')
const NODE = path.join(ROOT, 'apps', 'desktop', 'staging', 'node', 'node.exe')
const API = path.join(ROOT, 'apps', 'desktop', 'staging', 'api')
const ENGINE = path.join(API, 'node_modules', '.prisma', 'client', 'query_engine-windows.dll.node')
const ENGINE_DIR = path.dirname(ENGINE)

const results = []
function rec(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`)
}

function fileId(p) {
  const st = fs.statSync(p)
  return `${st.size}:${st.mtimeMs}`
}

function probe({ label, cwd, url, expectDbFile }) {
  const script = path.join(os.tmpdir(), `casr-probe-${Date.now()}-${Math.random().toString(16).slice(2)}.cjs`)
  fs.writeFileSync(
    script,
    `
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
(async () => {
  const tables = await p.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name LIMIT 20");
  const names = tables.map(t => t.name);
  console.log('TABLES', names.join(','));
  const engineDb = path.join(process.env.ENGINE_DIR, 'cashier.db');
  console.log('ENGINE_DB_EXISTS', fs.existsSync(engineDb), engineDb);
  await p.$disconnect();
  if (!names.length) process.exit(3);
})().catch(async (e) => { console.error('ERR', e.message || e); process.exit(2); });
`,
  )
  const beforeEngine = fs.existsSync(path.join(ENGINE_DIR, 'cashier.db'))
    ? fileId(path.join(ENGINE_DIR, 'cashier.db'))
    : null
  const beforeLive = fileId(expectDbFile)

  const r = spawnSync(NODE, [script], {
    cwd,
    env: {
      ...process.env,
      DATABASE_URL: url,
      PRISMA_QUERY_ENGINE_LIBRARY: ENGINE,
      NODE_PATH: path.join(API, 'node_modules'),
      ENGINE_DIR,
    },
    encoding: 'utf8',
    timeout: 20000,
    windowsHide: true,
  })
  try {
    fs.unlinkSync(script)
  } catch {
    /* */
  }
  const out = ((r.stdout || '') + (r.stderr || '')).trim()
  const tables = (out.match(/TABLES\s+(.+)/) || [])[1] || ''
  const hasUser = /User/i.test(tables) || /Settings/i.test(tables) || tables.split(',').filter(Boolean).length > 3
  const engineCreated = /ENGINE_DB_EXISTS true/i.test(out)
  const afterLive = fs.existsSync(expectDbFile) ? fileId(expectDbFile) : 'missing'
  // Fail if Prisma only hit an empty engine-sidecar DB
  const ok = r.status === 0 && hasUser && !engineCreated
  rec(
    label,
    ok,
    `url=${url} tables=${tables.slice(0, 80)} engineSidecar=${engineCreated} liveId ${beforeLive}→${afterLive} | ${out.slice(0, 120)}`,
  )
  // cleanup accidental engine sidecar
  try {
    const side = path.join(ENGINE_DIR, 'cashier.db')
    if (fs.existsSync(side) && fs.statSync(side).size < 1000) fs.unlinkSync(side)
  } catch {
    /* */
  }
  return ok
}

function main() {
  const src = fs.existsSync(DOCS) ? DOCS : SEED
  rec('source db', fs.existsSync(src), src)

  const base = path.join(os.tmpdir(), `casr-path-sol-${Date.now()}`)
  const dataDir = path.join(base, 'User Name (Test) & Co', 'بيانات-عربية')
  fs.mkdirSync(dataDir, { recursive: true })
  const dbFile = path.join(dataDir, 'cashier.db')
  fs.copyFileSync(src, dbFile)

  // A) cwd-relative — previously false-positive
  const okA = probe({
    label: 'A cwd-relative file:./cashier.db (strict)',
    cwd: dataDir,
    url: 'file:./cashier.db',
    expectDbFile: dbFile,
  })

  // B) junction from ProgramData (no spaces) → spaced dataDir
  const juncParent = path.join(process.env.ProgramData || 'C:\\ProgramData', 'GalaxyCashier')
  const junc = path.join(juncParent, 'live-junc-qa')
  fs.mkdirSync(juncParent, { recursive: true })
  try {
    if (fs.existsSync(junc)) execSync(`cmd /c rmdir "${junc}"`, { windowsHide: true })
  } catch {
    /* */
  }
  let okB = false
  try {
    execSync(`cmd /c mklink /J "${junc}" "${dataDir}"`, { windowsHide: true, encoding: 'utf8' })
    rec('B junction created', fs.existsSync(path.join(junc, 'cashier.db')), junc)
    okB = probe({
      label: 'B junction absolute URL',
      cwd: API,
      url: 'file:' + junc.replace(/\\/g, '/') + '/cashier.db',
      expectDbFile: dbFile,
    })
  } catch (e) {
    rec('B junction created', false, e.message)
  }

  // C) absolute long path with spaces
  const okC = probe({
    label: 'C absolute spaced path',
    cwd: API,
    url: 'file:' + dbFile.replace(/\\/g, '/'),
    expectDbFile: dbFile,
  })

  let chosen = 'NONE'
  if (okB) chosen = 'junction'
  else if (okA) chosen = 'cwd-relative'
  else if (okC) chosen = 'absolute-spaced'
  rec('chosen strategy', chosen !== 'NONE', chosen)

  try {
    if (fs.existsSync(junc)) execSync(`cmd /c rmdir "${junc}"`, { windowsHide: true })
  } catch {
    /* */
  }
  try {
    fs.rmSync(base, { recursive: true, force: true })
  } catch {
    /* */
  }

  const passed = results.filter((r) => r.ok).length
  fs.writeFileSync(
    OUT,
    JSON.stringify({ at: new Date().toISOString(), chosen, okA, okB, okC, passed, total: results.length, results }, null, 2),
  )
  console.log(`done ${passed}/${results.length} chosen=${chosen} → ${OUT}`)
  if (chosen === 'NONE') process.exit(1)
}

main()
