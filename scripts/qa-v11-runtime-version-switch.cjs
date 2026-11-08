/**
 * Launch Portable A, capture /health runtimeId; then expect caller to launch
 * Portable B (different version/hash) and verify new runtime slot + health.
 *
 * Usage:
 *   node scripts/qa-v11-runtime-version-switch.cjs phase1 <portableExe>
 *   node scripts/qa-v11-runtime-version-switch.cjs phase2 <portableExe> <expectedVersion>
 *
 * Writes docs/QA-V11-RUNTIME-SWITCH.json
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawn, execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'docs', 'QA-V11-RUNTIME-SWITCH.json')
const STATE = path.join(ROOT, 'docs', '.qa-runtime-switch-state.json')
const API = 'http://127.0.0.1:4001'

function runtimeBase() {
  return path.join(process.env.LOCALAPPDATA || '', 'GalaxyCashier', 'runtime')
}

function killGalaxy() {
  for (const im of ['Galaxy Cashier.exe', 'Galaxy Cashier 1.1.0.exe', 'Galaxy Cashier 1.1.1.exe']) {
    try {
      execSync(`taskkill /IM "${im}" /F`, { stdio: 'ignore' })
    } catch {
      /* */
    }
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
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitHealth(sec = 120) {
  const t0 = Date.now()
  for (let i = 0; i < sec; i++) {
    try {
      const r = await fetch(`${API}/health`)
      if (r.ok) {
        const body = await r.json().catch(() => ({}))
        return { ok: true, ms: Date.now() - t0, body }
      }
    } catch {
      /* */
    }
    await sleep(1000)
  }
  return { ok: false, ms: Date.now() - t0, body: {} }
}

function listRuntimeSlots() {
  const base = runtimeBase()
  if (!fs.existsSync(base)) return []
  return fs.readdirSync(base).filter((n) => {
    try {
      return fs.statSync(path.join(base, n)).isDirectory()
    } catch {
      return false
    }
  })
}

function readCurrent() {
  const p = path.join(runtimeBase(), 'current.json')
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

async function phase1(exe) {
  killGalaxy()
  await sleep(1500)
  if (!fs.existsSync(exe)) throw new Error(`missing exe: ${exe}`)
  spawn(exe, [], { detached: true, stdio: 'ignore' }).unref()
  const h = await waitHealth(150)
  const slots = listRuntimeSlots()
  const current = readCurrent()
  const state = {
    at: new Date().toISOString(),
    phase: 1,
    exe,
    healthOk: h.ok,
    health: h.body,
    slots,
    current,
  }
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2))
  console.log(JSON.stringify(state, null, 2))
  killGalaxy()
  await sleep(1500)
  if (!h.ok) process.exit(1)
  if (!h.body?.runtimeId && !h.body?.build) {
    console.error('health missing runtimeId/build — rebuild API+desktop first')
    process.exit(1)
  }
}

async function phase2(exe, expectedVersion) {
  if (!fs.existsSync(STATE)) throw new Error('run phase1 first')
  const prev = JSON.parse(fs.readFileSync(STATE, 'utf8'))
  killGalaxy()
  await sleep(1500)
  spawn(exe, [], { detached: true, stdio: 'ignore' }).unref()
  const h = await waitHealth(150)
  const slots = listRuntimeSlots()
  const current = readCurrent()
  const checks = []
  const push = (name, ok, detail = '') => {
    checks.push({ name, ok: !!ok, detail })
    console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`)
  }
  push('phase2 health', h.ok, `${h.ms}ms`)
  push(
    'version changed or build hash changed',
    h.body?.version !== prev.health?.version || h.body?.build !== prev.health?.build,
    `prev=${prev.health?.version}/${prev.health?.build} → now=${h.body?.version}/${h.body?.build}`,
  )
  if (expectedVersion) {
    push('expected version', h.body?.version === expectedVersion, String(h.body?.version))
  }
  push(
    'runtimeId changed',
    h.body?.runtimeId && h.body.runtimeId !== prev.health?.runtimeId,
    `prev=${prev.health?.runtimeId} → now=${h.body?.runtimeId}`,
  )
  push(
    'new runtime slot folder exists',
    h.body?.runtimeId ? slots.includes(h.body.runtimeId) : false,
    slots.join(', '),
  )
  push(
    'current.json matches new id',
    current?.id === h.body?.runtimeId,
    JSON.stringify(current),
  )

  const out = {
    at: new Date().toISOString(),
    phase1: prev,
    phase2: { exe, health: h.body, slots, current },
    checks,
    passed: checks.filter((c) => c.ok).length,
    total: checks.length,
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2))
  console.log(`done ${out.passed}/${out.total} → ${OUT}`)
  killGalaxy()
  await sleep(1000)
  if (out.passed !== out.total) process.exit(1)
}

async function main() {
  const [, , phase, exe, expectedVersion] = process.argv
  if (phase === 'phase1') return phase1(exe)
  if (phase === 'phase2') return phase2(exe, expectedVersion)
  console.error('Usage: phase1 <exe> | phase2 <exe> [expectedVersion]')
  process.exit(2)
}

main().catch((e) => {
  console.error(e)
  killGalaxy()
  process.exit(1)
})
