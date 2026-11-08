# Phase 4 final EXE suite against Galaxy-Cashier-Distribution artifacts.
$ErrorActionPreference = 'Continue'
$dist = 'E:\CASR\Galaxy-Cashier-Distribution-v1.0.0'
$setupSrc = 'E:\CASR\apps\desktop\dist\Galaxy Cashier Setup 1.0.0.exe'
$portableSrc = 'E:\CASR\apps\desktop\dist\Galaxy Cashier 1.0.0.exe'
$unpacked = 'E:\CASR\apps\desktop\dist\win-unpacked\Galaxy Cashier.exe'
$logs = Join-Path $env:USERPROFILE 'CASR-Logs\app.log'
$results = New-Object System.Collections.Generic.List[object]

function Rec([string]$name, [bool]$ok, [string]$detail) {
  $results.Add([pscustomobject]@{ name = $name; ok = $ok; detail = $detail }) | Out-Null
  $mark = if ($ok) { 'PASS' } else { 'FAIL' }
  Write-Host "$mark | $name | $detail"
}

function Kill-Galaxy {
  Get-Process -Name 'Galaxy Cashier' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  foreach ($p in 4001, 3001) {
    Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue |
      Where-Object State -eq Listen |
      ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  }
  Start-Sleep 2
}

function Wait-Api([int]$sec = 90) {
  for ($i = 0; $i -lt $sec; $i++) {
    Start-Sleep 1
    try {
      if ((Invoke-WebRequest 'http://127.0.0.1:4001/health' -UseBasicParsing -TimeoutSec 1).StatusCode -eq 200) { return $true }
    } catch {}
  }
  return $false
}

New-Item -ItemType Directory -Force -Path $dist | Out-Null
Copy-Item -Force $setupSrc $dist
Copy-Item -Force $portableSrc $dist
$blockmap = 'E:\CASR\apps\desktop\dist\Galaxy Cashier Setup 1.0.0.exe.blockmap'
if (Test-Path $blockmap) { Copy-Item -Force $blockmap $dist }
Rec 'dist has Setup' (Test-Path (Join-Path $dist 'Galaxy Cashier Setup 1.0.0.exe')) 'Setup copied'
Rec 'dist has Portable' (Test-Path (Join-Path $dist 'Galaxy Cashier 1.0.0.exe')) 'Portable copied'

Kill-Galaxy

# A) win-unpacked (= Setup payload): restore + single-instance
Start-Process $unpacked | Out-Null
$healthy = Wait-Api 90
Rec 'unpacked/Setup-bits healthy' $healthy 'win-unpacked'

$token = $null
if ($healthy) {
  try {
    $login = Invoke-RestMethod 'http://127.0.0.1:4001/api/auth/login' -Method POST -ContentType 'application/json' -Body '{"username":"admin","password":"admin123"}'
    $token = $login.data.accessToken
  } catch {}
}
Rec 'login on packaged API' ([bool]$token) ("token=" + [bool]$token)

if ($token) {
  $h = @{ Authorization = "Bearer $token" }
  try {
    $null = Invoke-RestMethod 'http://127.0.0.1:4001/api/backup' -Method POST -Headers $h
    $list = Invoke-RestMethod 'http://127.0.0.1:4001/api/backup' -Method GET -Headers $h
    $fname = $list.data[0].name
    $marker = "P4-MARKER-$(Get-Random)"
    $created = Invoke-RestMethod 'http://127.0.0.1:4001/api/items' -Method POST -Headers $h -ContentType 'application/json' -Body (@{
      name_ar = $marker; name_en = $marker; retailPrice = 1; costPrice = 1; unit = 'piece'
    } | ConvertTo-Json)
    $mid = $created.data.id
    $null = Invoke-RestMethod 'http://127.0.0.1:4001/api/backup/restore' -Method POST -Headers $h -ContentType 'application/json' -Body (@{ fileName = $fname } | ConvertTo-Json)
    Start-Sleep 1
    $gone = $false
    try {
      Invoke-WebRequest "http://127.0.0.1:4001/api/items/$mid" -Headers $h -UseBasicParsing | Out-Null
    } catch {
      $gone = ($_.Exception.Response.StatusCode.value__ -eq 404)
    }
    Rec 'Restore immediate (packaged)' $gone ("markerGone=$gone file=$fname")
  } catch {
    Rec 'Restore immediate (packaged)' $false $_.Exception.Message
  }

  try {
    $st = Invoke-RestMethod 'http://127.0.0.1:4001/api/backup/auto-status' -Headers $h
    $cfg = $st.data
    Rec 'auto-backup config present' ($null -ne $cfg) (($cfg | ConvertTo-Json -Compress))
  } catch {
    Rec 'auto-backup config present' $false $_.Exception.Message
  }
}

$mark = "[p4-si] $(Get-Date -Format o)"
Add-Content $logs $mark
Start-Process $unpacked -ArgumentList '--sales' | Out-Null
Start-Sleep 8
$all = Get-Content $logs
$idx = 0
for ($i = 0; $i -lt $all.Count; $i++) { if ($all[$i] -eq $mark) { $idx = $i } }
$after = @()
if ($idx -lt $all.Count - 1) { $after = $all[($idx + 1)..($all.Count - 1)] }
$nav = ($after | Where-Object { $_ -match 'second-instance' -and $_ -match 'sales/new|navigate' }).Count -gt 0
$spawn = ($after | Where-Object { $_ -match 'Spawning API' }).Count -gt 0
$listeners = @(Get-NetTCPConnection -LocalPort 4001 -EA SilentlyContinue | Where-Object State -eq Listen).Count
Rec 'single-instance --sales' ($nav -and -not $spawn -and $listeners -eq 1) ("nav=$nav spawn=$spawn listeners=$listeners")

Kill-Galaxy

# B) Portable from TEMP (distribution copy)
$tmp = Join-Path $env:TEMP ("casr-p4-portable-" + (Get-Date -Format 'yyyyMMddHHmmss'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$pExe = Join-Path $tmp 'Galaxy Cashier 1.0.0.exe'
Copy-Item -Force (Join-Path $dist 'Galaxy Cashier 1.0.0.exe') $pExe
$mark2 = "[p4-portable] $(Get-Date -Format o)"
Add-Content $logs $mark2
Start-Process $pExe -WorkingDirectory $tmp | Out-Null
$ph = Wait-Api 120
$dbOk = $false
if (Test-Path $logs) {
  $all = Get-Content $logs
  $idx = 0
  for ($i = 0; $i -lt $all.Count; $i++) { if ($all[$i] -eq $mark2) { $idx = $i } }
  $after = @()
  if ($idx -lt $all.Count - 1) { $after = $all[($idx + 1)..($all.Count - 1)] }
  $dbOk = ($after | Where-Object { $_ -match 'Documents\\CASR\\data\\cashier\.db' }).Count -gt 0
}
$localDbs = @(Get-ChildItem $tmp -Recurse -Filter 'cashier.db' -EA SilentlyContinue)
$noLocal = ($localDbs.Count -eq 0)
Rec 'Portable TEMP healthy' $ph 'from dist copy'
Rec 'Portable uses Documents DB' $dbOk 'shared with Setup path'
Rec 'Portable no local DB duplicate' $noLocal ("count=" + $localDbs.Count)

Kill-Galaxy
Remove-Item -Recurse -Force $tmp -EA SilentlyContinue

# C) Setup silent install when elevation allows
$setupExe = Join-Path $dist 'Galaxy Cashier Setup 1.0.0.exe'
$installed = 'C:\Program Files\Galaxy Cashier\Galaxy Cashier.exe'
try {
  $p = Start-Process -FilePath $setupExe -ArgumentList '/S' -PassThru -Wait -ErrorAction Stop
  Rec 'Setup silent install exit' (($p.ExitCode -eq 0) -or (Test-Path $installed)) ("exit=" + $p.ExitCode + " installed=" + (Test-Path $installed))
} catch {
  Rec 'Setup silent install' $false ('skipped: ' + $_.Exception.Message + ' (win-unpacked covers Setup bits)')
}

if (Test-Path $installed) {
  Kill-Galaxy
  Start-Process $installed | Out-Null
  $ih = Wait-Api 90
  Rec 'Setup-installed app healthy' $ih $installed
  $docsHit = $false
  if (Test-Path $logs) {
    $docsHit = (Get-Content $logs -Tail 40 | Where-Object { $_ -match 'Documents\\CASR\\data\\cashier\.db' }).Count -gt 0
  }
  Rec 'Setup-installed uses Documents DB' $docsHit 'same canonical path'
  Kill-Galaxy
}

$out = 'E:\CASR\docs\QA-PHASE4-FINAL-EXE.json'
$passed = @($results | Where-Object { $_.ok }).Count
$payload = [pscustomobject]@{ at = (Get-Date).ToString('o'); passed = $passed; total = $results.Count; results = $results }
$payload | ConvertTo-Json -Depth 6 | Set-Content $out -Encoding UTF8
Write-Host ("Wrote {0} passed={1} total={2}" -f $out, $passed, $results.Count)
if ($passed -lt $results.Count) { exit 1 } else { exit 0 }
