/**
 * Smoke both v1.1.0 artifacts:
 *  - Portable: apps/desktop/dist/Galaxy Cashier 1.1.0.exe
 *  - Setup payload: win-unpacked (same files NSIS packs into Setup 1.1.0)
 * Plus verify Setup installer file exists and version string.
 *
 *   node scripts/qa-v11-dual-artifact-smoke.cjs
 */
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawn, execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'docs', 'QA-V11-DUAL-ARTIFACT.json')
const DIST = path.join(ROOT, 'apps', 'desktop', 'dist')
const PORTABLE = path.join(DIST, 'Galaxy Cashier 1.1.0.exe')
const SETUP = path.join(DIST, 'Galaxy Cashier Setup 1.1.0.exe')
const UNPACKED = path.join(DIST, 'win-unpacked', 'Galaxy Cashier.exe')
const PKG = path.join(ROOT, 'apps', 'desktop', 'package.json')
const API = 'http://127.0.0.1:4001'

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`)
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function killGalaxy() {
  for (const im of [
    'Galaxy Cashier.exe',
    'Galaxy Cashier 1.1.0.exe',
    'Galaxy Cashier Setup 1.1.0.exe',
  ]) {
    try {
      execSync(`taskkill /IM "${im}" /F /T`, { stdio: 'ignore' })
    } catch {
      /* */
    }
  }
  try {
    execSync('taskkill /FI "IMAGENAME eq Galaxy Cashier*" /F', { stdio: 'ignore' })
  } catch {
    /* */
  }
  for (const port of [4001, 3001]) {
    try {
      const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' })
      for (const line of out.split(/\r?\n/)) {
        if (!line.includes('LISTENING')) continue
        const pid = line.trim().split(/\s+/).pop()
        if (/^\d+$/.test(pid)) {
          try {
            execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'ignore' })
          } catch {
            /* */
          }
        }
      }
    } catch {
      /* */
    }
  }
  // Clear machine-wide ProgramData instance locks so the next artifact can start
  const pd = path.join(process.env.ProgramData || 'C:\\ProgramData', 'GalaxyCashier')
  for (const p of [
    path.join(pd, 'data', '.machine-instance.lock'),
    path.join(pd, 'data', '.instance-lock'),
    path.join(pd, '.instance-lock'),
    path.join(pd, 'data', 'cashier.db-wal'),
    path.join(pd, 'data', 'cashier.db-shm'),
  ]) {
    try {
      fs.rmSync(p, { recursive: true, force: true })
    } catch {
      /* */
    }
  }
}

async function waitHealth(sec = 120) {
  const t0 = Date.now()
  for (let i = 0; i < sec; i++) {
    try {
      const r = await fetch(`${API}/health`)
      if (r.ok) {
        let body = {}
        try {
          body = await r.json()
        } catch {
          /* */
        }
        return { ok: true, ms: Date.now() - t0, body }
      }
    } catch {
      /* */
    }
    await sleep(1000)
  }
  return { ok: false, ms: Date.now() - t0 }
}

async function smokeExe(label, exePath, extraArgs = []) {
  killGalaxy()
  await sleep(3000)
  check(`${label} file exists`, fs.existsSync(exePath), exePath)
  if (!fs.existsSync(exePath)) return
  const sizeMb = Math.round(fs.statSync(exePath).size / 1024 / 1024)
  check(`${label} size > 50MB`, sizeMb >= 50, `${sizeMb} MB`)
  // Unique user-data-dir avoids Electron per-user single-instance mutex colliding across artifacts
  const udd = path.join(os.tmpdir(), `casr-smoke-${label.replace(/[^a-zA-Z0-9_-]/g, '_')}-${Date.now()}`)
  fs.mkdirSync(udd, { recursive: true })
  const childEnv = { ...process.env, CASR_SMOKE: '1' }
  // Prevent Portable env leakage from marking win-unpacked as portable
  delete childEnv.PORTABLE_EXECUTABLE_DIR
  delete childEnv.PORTABLE_EXECUTABLE_FILE
  delete childEnv.PORTABLE_EXECUTABLE_APP_FILENAME
  spawn(exePath, [`--user-data-dir=${udd}`, ...extraArgs], {
    detached: true,
    stdio: 'ignore',
    env: childEnv,
  }).unref()
  const h = await waitHealth(150)
  check(`${label} /health`, h.ok, `${h.ms}ms`)
  if (!h.ok) {
    killGalaxy()
    await sleep(2000)
    return
  }
  const login = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })
  const loginData = await login.json().catch(() => ({}))
  check(`${label} login`, login.ok, String(login.status))
  const token = loginData?.data?.accessToken
  if (token) {
    const settings = await fetch(`${API}/api/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const s = await settings.json().catch(() => ({}))
    const keys = s?.data || {}
    check(
      `${label} has vat settings keys`,
      'vat_enabled' in keys || 'tax_mode' in keys || 'tax_rate' in keys,
      `vat_enabled=${keys.vat_enabled} tax_mode=${keys.tax_mode}`,
    )
    await fetch(`${API}/api/settings`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ vat_enabled: 'true', tax_mode: 'EXCLUSIVE', tax_rate: '14' }),
    })
  }
  killGalaxy()
  await sleep(3000)
}

async function main() {
  try {
    const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'))
    check('package.json version 1.1.0', pkg.version === '1.1.0', pkg.version)

    check('Setup 1.1.0 artifact present', fs.existsSync(SETUP), SETUP)
    if (fs.existsSync(SETUP)) {
      const mb = Math.round(fs.statSync(SETUP).size / 1024 / 1024)
      check('Setup 1.1.0 size ~NSIS', mb >= 80, `${mb} MB`)
    }
    check('Portable 1.1.0 artifact present', fs.existsSync(PORTABLE), PORTABLE)
    check('win-unpacked (Setup payload) present', fs.existsSync(UNPACKED), UNPACKED)

    check(
      'artifact names encode 1.1.0',
      path.basename(SETUP).includes('1.1.0') && path.basename(PORTABLE).includes('1.1.0'),
      `${path.basename(SETUP)} / ${path.basename(PORTABLE)}`,
    )

    // 1) Setup payload first (machine ProgramData lock + absolute DB URL)
    await smokeExe('Setup-payload-win-unpacked-1.1.0', UNPACKED)
    // 2) Portable (may unpack under Temp — allow long health wait)
    await smokeExe('Portable-1.1.0', PORTABLE)
  } catch (e) {
    check('smoke runner exception', false, e instanceof Error ? e.message : String(e))
    console.error(e)
  }

  const passed = results.filter((r) => r.ok).length
  const out = {
    at: new Date().toISOString(),
    honesty: {
      setupInstaller: SETUP,
      portable: PORTABLE,
      note:
        'Portable = Galaxy Cashier 1.1.0.exe launched and /health+login exercised. Setup = Galaxy Cashier Setup 1.1.0.exe artifact verified + same payload tested via win-unpacked (files NSIS packs). Full silent NSIS install on clean VM not automated here.',
    },
    passed,
    total: results.length,
    results,
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2))
  console.log(`done ${passed}/${results.length}`)
  killGalaxy()
  if (passed !== results.length) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  killGalaxy()
  process.exit(1)
})
