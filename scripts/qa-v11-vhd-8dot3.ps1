#Requires -RunAsAdministrator
$ErrorActionPreference = 'Continue'
$Root = 'E:\CASR'
$OutJson = Join-Path $Root 'docs\QA-V11-VHD-8DOT3.json'
$Log = Join-Path $Root 'docs\QA-V11-VHD-8DOT3.log'
$Seed = Join-Path $Root 'apps\desktop\assets\seed.db'
$Node = Join-Path $Root 'apps\desktop\staging\node\node.exe'
$Api = Join-Path $Root 'apps\desktop\staging\api'
$Engine = Join-Path $Api 'node_modules\.prisma\client\query_engine-windows.dll.node'
$Vhd = Join-Path $env:TEMP 'casr-83test.vhdx'
$Letter = 'R'
$results = New-Object System.Collections.Generic.List[object]

function Log($m) {
  $line = "[{0}] {1}" -f (Get-Date -Format o), $m
  Add-Content -Path $Log -Value $line -Encoding UTF8
  Write-Host $m
}
function Add-Result($name, $ok, $detail = '') {
  $results.Add([pscustomobject]@{ name = $name; ok = [bool]$ok; detail = "$detail" })
  Log(("{0} | {1} | {2}" -f ($(if ($ok) { 'PASS' } else { 'FAIL' }), $name, $detail)))
}

function Probe-Prisma($label, $cwd, $url) {
  $scriptPath = Join-Path $env:TEMP ("casr-vhd-probe-{0}.cjs" -f ([guid]::NewGuid().ToString('N')))
  @(
    "const { PrismaClient } = require('@prisma/client');",
    "const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });",
    "p.`$queryRawUnsafe('SELECT 1 AS ok')",
    "  .then(async (r) => { console.log('OK', Number(r[0].ok)); await p.`$disconnect(); })",
    "  .catch(async (e) => { console.error('ERR', e.message || e); try { await p.`$disconnect(); } catch {} process.exit(2); });"
  ) -join "`n" | Set-Content -Path $scriptPath -Encoding UTF8

  $env:DATABASE_URL = $url
  $env:PRISMA_QUERY_ENGINE_LIBRARY = $Engine
  $env:NODE_PATH = (Join-Path $Api 'node_modules')
  $outFile = Join-Path $env:TEMP 'casr-vhd-out.txt'
  $errFile = Join-Path $env:TEMP 'casr-vhd-err.txt'
  Remove-Item $outFile, $errFile -Force -ErrorAction SilentlyContinue
  $p = Start-Process -FilePath $Node -ArgumentList $scriptPath -WorkingDirectory $cwd -Wait -PassThru -NoNewWindow `
    -RedirectStandardOutput $outFile -RedirectStandardError $errFile
  $out = (@(Get-Content $outFile, $errFile -ErrorAction SilentlyContinue) -join ' ').Trim()
  Remove-Item $scriptPath -Force -ErrorAction SilentlyContinue
  $ok = ($p.ExitCode -eq 0) -and ($out -match '\bOK\b')
  Add-Result $label $ok ("url=$url | $out")
  return $ok
}

'' | Set-Content $Log -Encoding UTF8
Log 'start VHD 8.3 test'

try {
  if (Test-Path "${Letter}:\") {
    $detach = @"
select vdisk file="$Vhd"
detach vdisk
"@
    $detach | Set-Content (Join-Path $env:TEMP 'casr-dp-detach.txt') -Encoding ASCII
    diskpart /s (Join-Path $env:TEMP 'casr-dp-detach.txt') | Out-Null
  }
  if (Test-Path $Vhd) { Remove-Item $Vhd -Force }

  $create = @"
create vdisk file="$Vhd" maximum=128 type=expandable
select vdisk file="$Vhd"
attach vdisk
create partition primary
format fs=ntfs quick label=CASR83
assign letter=$Letter
"@
  $create | Set-Content (Join-Path $env:TEMP 'casr-dp-create.txt') -Encoding ASCII
  $dpOut = (diskpart /s (Join-Path $env:TEMP 'casr-dp-create.txt') | Out-String)
  Log $dpOut
  Add-Result 'VHD created and mounted' (Test-Path "${Letter}:\") ('letter=' + $Letter)

  if (-not (Test-Path "${Letter}:\")) { throw 'VHD mount failed' }

  $fsutilOut = (fsutil 8dot3name set ${Letter}: 1 2>&1 | Out-String)
  Add-Result 'fsutil 8dot3name set = 1' ($LASTEXITCODE -eq 0 -or $fsutilOut -match 'successfully|Success') $fsutilOut.Trim()
  $query = (fsutil 8dot3name query ${Letter}: 2>&1 | Out-String)
  Add-Result '8.3 query on VHD' ($true) $query.Trim()

  $dataDir = Join-Path "${Letter}:\" 'User Name (Test)\بيانات-عربية\CASR\data'
  New-Item -ItemType Directory -Force $dataDir | Out-Null
  Copy-Item $Seed (Join-Path $dataDir 'cashier.db')
  Add-Result 'fixture Arabic+space on VHD' (Test-Path (Join-Path $dataDir 'cashier.db')) $dataDir

  $shortProbe = cmd /c "for %I in (`"$(Join-Path $dataDir 'cashier.db')`") do @echo %~sI"
  Add-Result 'short-name probe' ($true) ("shortProbe=$shortProbe")

  $okCwd = Probe-Prisma 'cwd-relative on VHD 8.3-off' $dataDir 'file:./cashier.db'

  $juncParent = 'C:\ProgramData\GalaxyCashier'
  $junc = Join-Path $juncParent 'vhd-junc-qa'
  New-Item -ItemType Directory -Force $juncParent | Out-Null
  if (Test-Path $junc) { cmd /c "rmdir `"$junc`"" | Out-Null }
  cmd /c "mklink /J `"$junc`" `"$dataDir`"" | Out-Null
  $okJ = Probe-Prisma 'junction→VHD path' $Api 'file:C:/ProgramData/GalaxyCashier/vhd-junc-qa/cashier.db'

  $chosen = if ($okCwd) { 'cwd-relative' } elseif ($okJ) { 'junction' } else { 'NONE' }
  Add-Result 'chosen on real 8.3-off VHD' ($chosen -ne 'NONE') $chosen

  if (Test-Path $junc) { cmd /c "rmdir `"$junc`"" | Out-Null }
  $detach2 = @"
select vdisk file="$Vhd"
detach vdisk
"@
  $detach2 | Set-Content (Join-Path $env:TEMP 'casr-dp-detach2.txt') -Encoding ASCII
  diskpart /s (Join-Path $env:TEMP 'casr-dp-detach2.txt') | Out-Null
  Remove-Item $Vhd -Force -ErrorAction SilentlyContinue

  $passed = @($results | Where-Object { $_.ok }).Count
  $payload = [ordered]@{
    at      = (Get-Date).ToString('o')
    chosen  = $chosen
    passed  = $passed
    total   = $results.Count
    results = $results
  }
  ($payload | ConvertTo-Json -Depth 6) | Set-Content $OutJson -Encoding UTF8
  Log ("done {0}/{1} chosen={2}" -f $passed, $results.Count, $chosen)
  if ($chosen -eq 'NONE') { exit 1 }
  exit 0
}
catch {
  Log ("FATAL: " + $_.Exception.Message)
  $payload = [ordered]@{
    at      = (Get-Date).ToString('o')
    error   = $_.Exception.Message
    results = $results
  }
  ($payload | ConvertTo-Json -Depth 6) | Set-Content $OutJson -Encoding UTF8
  exit 1
}
