/**
 * Silent NSIS Setup (/S) → verify ProgramData ACL from installer → standard-user write
 * → uninstall /S → confirm data + backups preserved.
 *
 * Requires Admin. Uses dist Setup unless GALAXY_SETUP_EXE is set.
 *
 *   node scripts/qa-v11-silent-setup-lifecycle.cjs
 */
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawnSync, execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'docs', 'QA-V11-SILENT-SETUP-LIFECYCLE.json')
const SETUP =
  process.env.GALAXY_SETUP_EXE ||
  path.join(ROOT, 'apps', 'desktop', 'dist', 'Galaxy Cashier Setup 1.1.0.exe')
const PD = path.join(process.env.ProgramData || 'C:\\ProgramData', 'GalaxyCashier')
const DATA = path.join(PD, 'data')
const BACKUPS = path.join(PD, 'backups')
const MARKER_DATA = path.join(DATA, 'qa-lifecycle-marker.txt')
const MARKER_BAK = path.join(BACKUPS, 'qa-lifecycle-marker.db')
const SETUP_MARKER = path.join(PD, '.setup-prepared')

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail).slice(0, 500) })
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`)
}

function isElevated() {
  try {
    execSync('net session', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function sleepSync(ms) {
  spawnSync(process.execPath, ['-e', `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${ms})`], {
    windowsHide: true,
  })
}

function killGalaxy() {
  for (const im of ['Galaxy Cashier.exe', 'Galaxy Cashier 1.1.0.exe']) {
    try {
      execSync(`taskkill /IM "${im}" /F /T`, { stdio: 'ignore' })
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
  // Release machine lock left by runAfterFinish
  try {
    fs.rmSync(path.join(PD, '.instance-lock'), { recursive: true, force: true })
  } catch {
    /* */
  }
}

function findInstallDir() {
  const candidates = [
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Galaxy Cashier'),
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'galaxy-cashier'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Galaxy Cashier'),
  ]
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'Galaxy Cashier.exe'))) return c
  }
  // Registry uninstall
  try {
    const out = execSync(
      'reg query HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall /s /f "Galaxy Cashier" 2>nul',
      { encoding: 'utf8', windowsHide: true },
    )
    const m = out.match(/InstallLocation\s+REG_SZ\s+(.+)/i)
    if (m && fs.existsSync(m[1].trim())) return m[1].trim()
  } catch {
    /* */
  }
  return null
}

function findUninstaller(installDir) {
  if (!installDir) return null
  const names = fs.readdirSync(installDir)
  const u = names.find((n) => /^uninstall/i.test(n) && /\.exe$/i.test(n))
  return u ? path.join(installDir, u) : null
}

function main() {
  const elevated = isElevated()
  check('running elevated', elevated, '')
  if (!elevated) {
    finish({ skipped: true, reason: 'need Admin for silent per-machine Setup' })
    process.exit(1)
  }

  check('Setup exe exists', fs.existsSync(SETUP), SETUP)
  if (!fs.existsSync(SETUP)) {
    finish({ skipped: true })
    process.exit(1)
  }

  // Confirm installer.nsh embeds ACL
  const nsh = fs.readFileSync(path.join(ROOT, 'apps', 'desktop', 'installer.nsh'), 'utf8')
  check('installer.nsh runs icacls in customInstall', /!macro customInstall[\s\S]*icacls[\s\S]*!macroend/.test(nsh), '')
  check('installer.nsh grants Users:(OI)(CI)M', /BUILTIN\\Users:\(OI\)\(CI\)M/.test(nsh), '')
  check('installer.nsh uses /T propagate', /icacls[\s\S]*\/T/.test(nsh), '')

  // Silent install first (ACL created by installer itself)
  console.log('Silent install /S …')
  const inst = spawnSync(SETUP, ['/S'], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 600000,
  })
  check('silent Setup /S exit 0', inst.status === 0, `status=${inst.status} ${inst.stderr || ''}`)
  sleepSync(5000)
  // runAfterFinish may have launched the app — stop it so DB/ACL checks are not locked
  killGalaxy()
  sleepSync(1500)

  check('installer created .setup-prepared', fs.existsSync(SETUP_MARKER), SETUP_MARKER)

  let icaclsOut = ''
  try {
    icaclsOut = execSync(`icacls "${PD}"`, { encoding: 'utf8' })
  } catch (e) {
    icaclsOut = e.message
  }
  check(
    'ACL after install: Users Modify (from installer)',
    /BUILTIN\\Users:.*\(M\)/i.test(icaclsOut) || /Users:.*\(M\)/i.test(icaclsOut),
    icaclsOut.split(/\r?\n/).slice(0, 6).join(' | '),
  )
  check(
    'ACL after install: SYSTEM Full (from installer)',
    /NT AUTHORITY\\SYSTEM:.*\(F\)/i.test(icaclsOut) || /SYSTEM:.*\(F\)/i.test(icaclsOut),
    '',
  )

  const installDir = findInstallDir()
  check('install dir present', !!installDir, installDir || '')
  check(
    'Galaxy Cashier.exe installed',
    !!(installDir && fs.existsSync(path.join(installDir, 'Galaxy Cashier.exe'))),
    installDir || '',
  )

  // Standard user writes markers (proves installer Users Modify ACL) — must survive uninstall
  const testUser = process.env.GALAXY_TEST_USER || 'GalaxyCashierTest'
  const testPass = process.env.GALAXY_TEST_PASS || 'TestPass123!'
  try {
    execSync(`net user ${testUser} ${testPass} /add`, { stdio: 'ignore' })
  } catch {
    try {
      execSync(`net user ${testUser} ${testPass}`, { stdio: 'ignore' })
    } catch {
      /* */
    }
  }
  const stamp = Date.now()
  const liveToken = `LIVE-${stamp}`
  const bakToken = `BAK-${stamp}`
  const probeData = path.join(DATA, `qa-preserve-data-${stamp}.txt`)
  const probeBak = path.join(BACKUPS, `qa-preserve-bak-${stamp}.txt`)
  // Write helper .ps1 under TEMP (not ProgramData) to avoid empty-DACL traps
  const ps1 = path.join(os.tmpdir(), `casr-std-user-probe-${stamp}.ps1`)
  fs.writeFileSync(
    ps1,
    [
      `$sec = ConvertTo-SecureString '${testPass.replace(/'/g, "''")}' -AsPlainText -Force`,
      `$cred = New-Object System.Management.Automation.PSCredential('${testUser}', $sec)`,
      `$p1 = Start-Process cmd.exe -ArgumentList @('/c','echo ${liveToken}> "${probeData.replace(/'/g, "''")}"') -Credential $cred -Wait -PassThru -WindowStyle Hidden`,
      `$p2 = Start-Process cmd.exe -ArgumentList @('/c','echo ${bakToken}> "${probeBak.replace(/'/g, "''")}"') -Credential $cred -Wait -PassThru -WindowStyle Hidden`,
      `exit ([int]($p1.ExitCode -ne 0) + [int]($p2.ExitCode -ne 0))`,
    ].join('\r\n'),
    'utf8',
  )
  spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1], {
    windowsHide: true,
    timeout: 90000,
  })
  try {
    fs.unlinkSync(ps1)
  } catch {
    /* */
  }
  check(
    'standard Windows user can write ProgramData\\data after Setup',
    fs.existsSync(probeData),
    probeData,
  )
  check(
    'standard Windows user can write ProgramData\\backups after Setup',
    fs.existsSync(probeBak),
    probeBak,
  )

  // Uninstall silent
  const uninstaller = findUninstaller(installDir)
  check('uninstaller found', !!uninstaller, uninstaller || '')
  if (uninstaller) {
    killGalaxy()
    sleepSync(1000)
    console.log('Silent uninstall /S …')
    const un = spawnSync(uninstaller, ['/S'], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 600000,
    })
    check('silent uninstall /S exit 0', un.status === 0, `status=${un.status}`)
    sleepSync(3000)
    killGalaxy()
    check(
      'install dir removed (or exe gone)',
      !installDir ||
        !fs.existsSync(path.join(installDir, 'Galaxy Cashier.exe')) ||
        !fs.existsSync(installDir),
      installDir || '',
    )
  }

  function readOk(p, expect) {
    try {
      if (!fs.existsSync(p)) return { ok: false, detail: 'missing' }
      const v = fs.readFileSync(p, 'utf8').trim()
      return { ok: v.includes(expect) || v === expect, detail: v.slice(0, 80) }
    } catch (e) {
      return { ok: fs.existsSync(p), detail: `exists but read ${e.code || e.message}` }
    }
  }
  const afterData = readOk(probeData, liveToken)
  const afterBak = readOk(probeBak, bakToken)
  check('after uninstall: live data preserved', afterData.ok, `${probeData} ${afterData.detail}`)
  check('after uninstall: backups preserved', afterBak.ok, `${probeBak} ${afterBak.detail}`)
  check('after uninstall: ProgramData root still present', fs.existsSync(PD), PD)
  check('after uninstall: .setup-prepared still present', fs.existsSync(SETUP_MARKER), SETUP_MARKER)

  finish({
    elevated: true,
    setup: SETUP,
    installDir,
    uninstaller,
    liveToken,
    bakToken,
  })
}

function finish(extra = {}) {
  const passed = results.filter((r) => r.ok).length
  fs.writeFileSync(
    OUT,
    JSON.stringify({ at: new Date().toISOString(), ...extra, passed, total: results.length, results }, null, 2),
  )
  console.log(`done ${passed}/${results.length} → ${OUT}`)
  if (extra.skipped) return
  if (passed !== results.length) process.exit(1)
}

main()
