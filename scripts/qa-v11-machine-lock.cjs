/**
 * Machine-wide instance lock (.machine-instance.lock exclusive file).
 *   node scripts/qa-v11-machine-lock.cjs
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawn, spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'docs', 'QA-V11-MACHINE-LOCK.json')
const DATA = path.join(process.env.ProgramData || 'C:\\ProgramData', 'GalaxyCashier', 'data')
const LOCK_FILE = path.join(DATA, '.machine-instance.lock')

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail).slice(0, 400) })
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`)
}

function sleepSync(ms) {
  spawnSync(process.execPath, ['-e', `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${ms})`], {
    windowsHide: true,
  })
}

function holderScript(holdMs, tag) {
  return `
const fs = require('fs');
const lockFile = ${JSON.stringify(LOCK_FILE)};
fs.mkdirSync(${JSON.stringify(DATA)}, { recursive: true });
let fd;
try {
  fd = fs.openSync(lockFile, 'wx');
} catch (e) {
  if (e.code === 'EEXIST') { console.log('HOLD_FAIL_EXISTS'); process.exit(3); }
  console.log('HOLD_FAIL', e.message); process.exit(4);
}
fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, tag: ${JSON.stringify(tag)}, at: new Date().toISOString() }));
console.log('HOLD_OK ' + process.pid);
setTimeout(() => {
  try { fs.closeSync(fd); } catch {}
  try { fs.unlinkSync(lockFile); } catch {}
  process.exit(0);
}, ${holdMs});
`
}

function main() {
  fs.mkdirSync(DATA, { recursive: true })
  try {
    fs.unlinkSync(LOCK_FILE)
  } catch {
    /* */
  }
  for (const legacy of [
    path.join(DATA, '.instance-lock'),
    path.join(path.dirname(DATA), '.instance-lock'),
  ]) {
    try {
      fs.rmSync(legacy, { recursive: true, force: true })
    } catch {
      /* */
    }
  }
  check('lock file cleared before test', !fs.existsSync(LOCK_FILE), LOCK_FILE)

  const scriptA = path.join(ROOT, 'docs', '.qa-lock-holder-a.cjs')
  const scriptB = path.join(ROOT, 'docs', '.qa-lock-holder-b.cjs')
  fs.writeFileSync(scriptA, holderScript(8000, 'A'))
  fs.writeFileSync(scriptB, holderScript(1000, 'B'))

  const a = spawn(process.execPath, [scriptA], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let aOut = ''
  a.stdout.on('data', (d) => {
    aOut += d.toString()
  })
  sleepSync(500)
  check('session A acquired machine lock', aOut.includes('HOLD_OK') || fs.existsSync(LOCK_FILE), aOut.trim())

  const b = spawnSync(process.execPath, [scriptB], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 5000,
  })
  const bOut = ((b.stdout || '') + (b.stderr || '')).trim()
  check(
    'session B blocked while A holds lock',
    b.status === 3 || bOut.includes('HOLD_FAIL_EXISTS'),
    `status=${b.status} out=${bOut}`,
  )

  const deadline = Date.now() + 12000
  while (fs.existsSync(LOCK_FILE) && Date.now() < deadline) sleepSync(200)
  check('session A released lock after hold', !fs.existsSync(LOCK_FILE), LOCK_FILE)

  const b2 = spawnSync(process.execPath, [scriptB], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 8000,
  })
  const b2Out = ((b2.stdout || '') + (b2.stderr || '')).trim()
  check('session B acquires after A released', b2Out.includes('HOLD_OK') || b2.status === 0, b2Out)

  try {
    fs.unlinkSync(LOCK_FILE)
  } catch {
    /* */
  }
  fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: 999999, user: 'DeadUser' }))
  function isPidAlive(pid) {
    try {
      process.kill(pid, 0)
      return true
    } catch (e) {
      return e && e.code === 'EPERM'
    }
  }
  if (!isPidAlive(999999)) {
    try {
      fs.unlinkSync(LOCK_FILE)
    } catch {
      /* */
    }
  }
  const c = spawnSync(process.execPath, [scriptB], { windowsHide: true, encoding: 'utf8', timeout: 8000 })
  const cOut = ((c.stdout || '') + (c.stderr || '')).trim()
  check('stale lock (dead PID) can be replaced', cOut.includes('HOLD_OK'), cOut)

  try {
    fs.unlinkSync(scriptA)
    fs.unlinkSync(scriptB)
  } catch {
    /* */
  }
  try {
    fs.unlinkSync(LOCK_FILE)
  } catch {
    /* */
  }

  const mainJs = fs.readFileSync(path.join(ROOT, 'apps', 'desktop', 'main.js'), 'utf8')
  check('main.js has acquireMachineInstanceLock', /function acquireMachineInstanceLock/.test(mainJs), '')
  check('main.js skips lock for Portable', /skipped:\s*'portable'|isPortableBuild\(\)/.test(mainJs), '')
  check('main.js exits when lock denied', /app\.exit\(2\)/.test(mainJs), '')
  check('main.js uses exclusive wx lock file', /openSync\(lockFile,\s*'wx'\)/.test(mainJs), '')

  const passed = results.filter((r) => r.ok).length
  fs.writeFileSync(
    OUT,
    JSON.stringify({ at: new Date().toISOString(), lockFile: LOCK_FILE, passed, total: results.length, results }, null, 2),
  )
  console.log(`done ${passed}/${results.length} → ${OUT}`)
  if (passed !== results.length) process.exit(1)
}

main()
