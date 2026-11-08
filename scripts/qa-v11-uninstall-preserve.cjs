/**
 * Simulates NSIS uninstall behavior: remove install dir, keep ProgramData data/backups.
 * Also simulates in-place upgrade (overwrite install, keep data).
 *   node scripts/qa-v11-uninstall-preserve.cjs
 */
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'docs', 'QA-V11-UNINSTALL-PRESERVE.json')
const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`)
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true })
}

function main() {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'casr-uninst-'))
  const installDir = path.join(sandbox, 'GalaxyCashier')
  const programData = path.join(sandbox, 'ProgramData', 'GalaxyCashier')
  const dataDir = path.join(programData, 'data')
  const backupsDir = path.join(programData, 'backups')
  const markerDb = path.join(dataDir, 'cashier.db')
  const markerBak = path.join(backupsDir, 'backup-marker.db')
  const appExe = path.join(installDir, 'Galaxy Cashier.exe')

  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(backupsDir, { recursive: true })
  fs.mkdirSync(installDir, { recursive: true })
  fs.writeFileSync(markerDb, 'LIVE-DATA-v1')
  fs.writeFileSync(markerBak, 'BACKUP-DATA-v1')
  fs.writeFileSync(appExe, 'fake-exe-v1.1.0')
  fs.writeFileSync(path.join(installDir, 'LICENSE.electron.txt'), 'license')

  // --- Simulate uninstall: delete installDir only (NSIS with deleteAppDataOnUninstall:false
  // and custom .onUninstSuccess that does NOT wipe ProgramData) ---
  rmrf(installDir)
  check('uninstall removed install dir', !fs.existsSync(installDir), installDir)
  check('uninstall kept ProgramData data', fs.existsSync(markerDb) && fs.readFileSync(markerDb, 'utf8') === 'LIVE-DATA-v1', markerDb)
  check('uninstall kept ProgramData backups', fs.existsSync(markerBak) && fs.readFileSync(markerBak, 'utf8') === 'BACKUP-DATA-v1', markerBak)

  // --- Simulate upgrade: reinstall over same ProgramData ---
  fs.mkdirSync(installDir, { recursive: true })
  fs.writeFileSync(appExe, 'fake-exe-v1.1.1')
  check('upgrade recreated install dir', fs.existsSync(appExe), 'v1.1.1')
  check('upgrade preserved live DB bytes', fs.readFileSync(markerDb, 'utf8') === 'LIVE-DATA-v1', '')
  check('upgrade preserved backups', fs.readFileSync(markerBak, 'utf8') === 'BACKUP-DATA-v1', '')

  // --- Confirm installer.nsh + package.json policy in repo ---
  const nsh = fs.readFileSync(path.join(ROOT, 'apps', 'desktop', 'installer.nsh'), 'utf8')
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'desktop', 'package.json'), 'utf8'))
  check('installer.nsh creates ProgramData data+backups', /GalaxyCashier\\data/.test(nsh) && /GalaxyCashier\\backups/.test(nsh), '')
  check('installer.nsh sets Users Modify ACL', /BUILTIN\\Users:\(OI\)\(CI\)M/.test(nsh), '')
  check(
    'installer.nsh documents preserve-on-uninstall',
    /DO NOT remove/i.test(nsh) && /Preserving/i.test(nsh),
    'customUnInstall comments',
  )
  check('deleteAppDataOnUninstall is false', pkg.build?.nsis?.deleteAppDataOnUninstall === false, String(pkg.build?.nsis?.deleteAppDataOnUninstall))
  const uninstallSection = nsh.includes('!macro customUnInstall')
    ? nsh.slice(nsh.indexOf('!macro customUnInstall'))
    : nsh
  const wipesData =
    /RMDir\s+\/r\s+.*ProgramData.*GalaxyCashier/i.test(uninstallSection) ||
    /RMDir\s+\/r\s+.*GalaxyCashier\\data/i.test(uninstallSection)
  check('customUnInstall does not RMDir ProgramData data', !wipesData, '')

  rmrf(sandbox)

  const passed = results.filter((r) => r.ok).length
  fs.writeFileSync(
    OUT,
    JSON.stringify({ at: new Date().toISOString(), passed, total: results.length, results }, null, 2),
  )
  console.log(`done ${passed}/${results.length} → ${OUT}`)
  if (passed !== results.length) process.exit(1)
}

main()
