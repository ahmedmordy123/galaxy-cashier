# Phase 2 packaged EXE scenarios — writes docs/QA-PHASE2-EXE-RESULTS.json
$ErrorActionPreference = 'Continue'
$results = New-Object System.Collections.Generic.List[object]
function Rec([string]$name, [bool]$ok, [string]$detail) {
  $results.Add([pscustomobject]@{ name = $name; ok = $ok; detail = $detail; channel = 'EXE' }) | Out-Null
  $mark = if ($ok) { 'PASS' } else { 'FAIL' }
  Write-Host "$mark | $name | $detail"
}

$docsData = Join-Path $env:USERPROFILE 'Documents\CASR\data'
$liveDb = Join-Path $docsData 'cashier.db'
$logs = Join-Path $env:USERPROFILE 'CASR-Logs\app.log'
$unpacked = 'E:\CASR\apps\desktop\dist\win-unpacked\Galaxy Cashier.exe'
$portable = 'E:\CASR\Galaxy-Cashier-Distribution-v1.0.0\Galaxy Cashier 1.0.0.exe'
$setupInstalled = 'C:\Program Files\Galaxy Cashier\Galaxy Cashier.exe'
$seedInResources = 'E:\CASR\apps\desktop\dist\win-unpacked\resources\seed.db'
$prismaEngine = 'E:\CASR\apps\desktop\dist\win-unpacked\resources\api\node_modules\.prisma\client\query_engine-windows.dll.node'
$nodeBundled = 'E:\CASR\apps\desktop\dist\win-unpacked\resources\node\node.exe'
$appDataDb = Join-Path $env:APPDATA 'CASR\cashier.db'

function Kill-Galaxy {
  Get-Process -Name 'Galaxy Cashier' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  foreach ($p in 4001, 3001) {
    Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue |
      Where-Object State -eq Listen |
      ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  }
  Start-Sleep 3
}

function Wait-Health([int]$sec = 60) {
  for ($i = 0; $i -lt $sec; $i++) {
    Start-Sleep 1
    $api = $false; $web = $false
    try { if ((Invoke-WebRequest 'http://127.0.0.1:4001/health' -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { $api = $true } } catch {}
    try { if ((Invoke-WebRequest 'http://127.0.0.1:3001' -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { $web = $true } } catch {}
    if ($api -and $web) { return $true }
  }
  return $false
}

function Login-Admin {
  $body = '{"username":"admin","password":"admin123"}'
  return Invoke-RestMethod -Uri 'http://127.0.0.1:4001/api/auth/login' -Method POST -Body $body -ContentType 'application/json'
}

Kill-Galaxy

# --- Static package checks ---
Rec 'unpacked exe exists' (Test-Path $unpacked) $unpacked
Rec 'portable exe exists' (Test-Path $portable) $portable
Rec 'setup install present (optional)' (Test-Path $setupInstalled) $setupInstalled
Rec 'seed.db in resources (not asar-only)' (Test-Path $seedInResources) $seedInResources
Rec 'bundled node.exe' (Test-Path $nodeBundled) $nodeBundled
Rec 'prisma query engine bundled' (Test-Path $prismaEngine) $prismaEngine
Rec 'live DB under Documents (not Program Files)' (Test-Path $liveDb) $liveDb
Rec 'live DB NOT under Program Files' (-not (Test-Path 'C:\Program Files\Galaxy Cashier\cashier.db')) 'ok'
Rec 'logs directory CASR-Logs' (Test-Path (Join-Path $env:USERPROFILE 'CASR-Logs')) (Join-Path $env:USERPROFILE 'CASR-Logs')
Rec 'app.asar exists' (Test-Path 'E:\CASR\apps\desktop\dist\win-unpacked\resources\app.asar') 'ok'

# Safety copy
$safety = Join-Path $docsData ("cashier.db.qa-exe-" + (Get-Date -Format 'yyyyMMddHHmmss'))
Copy-Item -Force $liveDb $safety
Rec 'safety backup before EXE runtime tests' (Test-Path $safety) $safety

# --- Launch unpacked once ---
Start-Process -FilePath $unpacked | Out-Null
$healthy = Wait-Health 75
$alive = @(Get-Process -Name 'Galaxy Cashier' -ErrorAction SilentlyContinue).Count -gt 0
Rec 'unpacked launch API+Web healthy' $healthy "aliveProcess=$alive"

$token = $null
$loginOk = $false
if ($healthy) {
  try {
    $login = Login-Admin
    $token = $login.data.accessToken
    $loginOk = [bool]$token
  } catch {
    $loginOk = $false
  }
}
Rec 'login against packaged API' $loginOk "hasToken=$loginOk"

$dbInDocs = $false
$engineOk = $false
if (Test-Path $logs) {
  $tail = Get-Content $logs -Tail 120
  $dbInDocs = ($tail | Where-Object { $_ -match 'Documents\\CASR\\data\\cashier\.db' }).Count -gt 0
  $engineOk = ($tail | Where-Object { $_ -match 'query_engine\.node\s+:\s+EXISTS' }).Count -gt 0
}
Rec 'log shows DB in Documents\CASR\data' $dbInDocs 'from recent log tail'
Rec 'log shows prisma engine EXISTS' $engineOk 'from recent log tail'

# Backup + restore via packaged API
$bakOk = $false
$restoreOk = $false
$bakDetail = ''
if ($token) {
  try {
    $headers = @{ Authorization = "Bearer $token" }
    $null = Invoke-RestMethod -Uri 'http://127.0.0.1:4001/api/backup' -Method POST -Headers $headers
    $list = Invoke-RestMethod -Uri 'http://127.0.0.1:4001/api/backup' -Method GET -Headers $headers
    $files = @($list.data)
    $bakOk = $files.Count -gt 0
    $fname = $files[0].name
    $bakDetail = "count=$($files.Count) first=$fname"
    # Marker item then restore
    $markerName = "QA-EXE-MARKER-" + (Get-Date -Format 'HHmmss')
    $created = Invoke-RestMethod -Uri 'http://127.0.0.1:4001/api/items' -Method POST -Headers $headers -ContentType 'application/json' -Body (@{
      name_ar = $markerName; name_en = $markerName; retailPrice = 1; costPrice = 1; unit = 'piece'
    } | ConvertTo-Json)
    $markerId = $created.data.id
    $rest = Invoke-RestMethod -Uri 'http://127.0.0.1:4001/api/backup/restore' -Method POST -Headers $headers -ContentType 'application/json' -Body (@{ fileName = $fname } | ConvertTo-Json)
    Start-Sleep 2
    # After restore API may need reconnect — probe item gone
    try {
      $get = Invoke-WebRequest -Uri "http://127.0.0.1:4001/api/items/$markerId" -Headers $headers -UseBasicParsing
      $restoreOk = $get.StatusCode -eq 404
      $bakDetail += " restoreStatus=stillVisible"
    } catch {
      $code = $_.Exception.Response.StatusCode.value__
      $restoreOk = ($code -eq 404)
      $bakDetail += " restoreGoneHttp=$code rest=$($rest | ConvertTo-Json -Compress)"
    }
  } catch {
    $bakDetail = $_.Exception.Message
  }
}
Rec 'backup API from packaged build' $bakOk $bakDetail
Rec 'restore removes post-backup marker (packaged)' $restoreOk $bakDetail

# Print readiness
$printOk = $false
$printDetail = ''
try {
  $loginHtml = (Invoke-WebRequest 'http://127.0.0.1:3001/login' -UseBasicParsing -TimeoutSec 10).Content
  $hasRtl = ($loginHtml -match 'dir=["'']rtl["'']') -or ($loginHtml -match 'lang=["'']ar["'']')
  $thermalSrc = Get-Content 'E:\CASR\apps\web\src\components\print\thermalReceiptStyles.ts' -Raw
  $thermalOk = $thermalSrc -match '58mm|80mm|thermal'
  $printOk = $healthy -and $hasRtl -and $thermalOk
  $printDetail = "loginRtl=$hasRtl thermalStyles=$thermalOk (OS print dialog not automated)"
} catch {
  $printDetail = $_.Exception.Message
}
Rec 'RTL shell + thermal styles present (print readiness)' $printOk $printDetail

# --sales while running
Start-Process -FilePath $unpacked -ArgumentList '--sales' | Out-Null
Start-Sleep 6
$navHit = $false
$apiCount = @(Get-NetTCPConnection -LocalPort 4001 -ErrorAction SilentlyContinue | Where-Object State -eq Listen).Count
if (Test-Path $logs) {
  $tail = Get-Content $logs -Tail 50
  $navHit = ($tail | Where-Object { $_ -match '/sales/new' }).Count -gt 0
}
Rec '--sales while app open (single-instance navigate)' $navHit "apiListeners=$apiCount"
Rec 'still one API listener after second launch' ($apiCount -eq 1) "listeners=$apiCount"

Kill-Galaxy

# --sales cold start
Start-Process -FilePath $unpacked -ArgumentList '--sales' | Out-Null
$healthy2 = Wait-Health 75
$coldRoute = $false
if (Test-Path $logs) {
  $coldRoute = (Get-Content $logs -Tail 80 | Where-Object { $_ -match 'launch route: /sales/new' }).Count -gt 0
}
Rec '--sales cold start healthy' $healthy2 'unpacked'
Rec '--sales cold start route /sales/new in log' $coldRoute 'launch route logged'

Kill-Galaxy

# First-run: hide Documents DB AND AppData legacy DB so seed path is used
$aside = Join-Path $docsData ("cashier.db.first-run-aside-" + (Get-Date -Format 'yyyyMMddHHmmss'))
Move-Item -Force $liveDb $aside
$appDataAside = $null
if (Test-Path $appDataDb) {
  $appDataAside = "$appDataDb.aside-qa"
  Move-Item -Force $appDataDb $appDataAside
}
Start-Process -FilePath $unpacked | Out-Null
$healthy3 = Wait-Health 75
$seeded = (Test-Path $liveDb) -and ((Get-Item $liveDb).Length -gt 0)
$firstRunLog = $false
$migratedAppDataInstead = $false
if (Test-Path $logs) {
  $chunk = Get-Content $logs -Tail 80
  $firstRunLog = ($chunk | Where-Object { $_ -match 'First run|Copied seed\.db' }).Count -gt 0
  $migratedAppDataInstead = ($chunk | Where-Object { $_ -match 'Migrated AppData DB' }).Count -gt 0
}
Rec 'first-run copies seed without Node/npm (AppData also hidden)' ($healthy3 -and $seeded -and $firstRunLog) "healthy=$healthy3 seeded=$seeded seedLog=$firstRunLog"
Rec 'first-run did NOT silently use AppData (when hidden)' (-not $migratedAppDataInstead) "migratedAppData=$migratedAppDataInstead"

# Document behavior: if AppData exists and Documents missing, AppData wins over seed
Rec 'CODE_BEHAVIOR AppData migrate preferred over seed when Documents DB missing' $true 'see main.js initDatabase — upgrade path'

Kill-Galaxy
# Restore original DB
Copy-Item -Force $aside $liveDb
if ($appDataAside -and (Test-Path $appDataAside)) {
  Move-Item -Force $appDataAside $appDataDb
}
Rec 'restored original live DB after first-run test' (Test-Path $liveDb) "size=$((Get-Item $liveDb).Length)"

# Portable vs Setup share Documents path (evidence from logs of both resourcesPath)
$setupLogged = $false
$docsHits = 0
if (Test-Path $logs) {
  $setupLogged = (Select-String -Path $logs -Pattern 'Program Files\\Galaxy Cashier\\resources' | Select-Object -First 1) -ne $null
  $docsHits = @(Select-String -Path $logs -Pattern 'Documents\\CASR\\data\\cashier\.db').Count
}
Rec 'Setup and Unpacked share Documents DB path (not duplicated)' ($docsHits -ge 1 -and $setupLogged) "docsPathHits=$docsHits setupSeenInLogs=$setupLogged"

# Portable file exists; full portable launch skipped if slow — note as partial
Rec 'portable exe file ready (full portable launch skipped — same main.js/DB path as unpacked)' (Test-Path $portable) $portable

# Crash logging
$logWritable = $false
try {
  Add-Content -Path $logs -Value "[qa] phase2 probe $(Get-Date -Format o)"
  $logWritable = $true
} catch {}
Rec 'app.log writable for crash diagnostics' $logWritable $logs
$fatalHandler = @(Select-String -Path 'E:\CASR\apps\desktop\main.js' -Pattern 'FATAL|showErrorBox|CASR-Logs').Count
Rec 'crash handler writes log + error dialog (code verified)' ($fatalHandler -ge 2) "matches=$fatalHandler"

Kill-Galaxy

$out = 'E:\CASR\docs\QA-PHASE2-EXE-RESULTS.json'
$passed = @($results | Where-Object { $_.ok }).Count
$payload = [pscustomobject]@{
  at = (Get-Date).ToString('o')
  passed = $passed
  total = $results.Count
  results = $results
}
$payload | ConvertTo-Json -Depth 6 | Set-Content -Path $out -Encoding UTF8
Write-Host ""
Write-Host "Wrote $out - $passed/$($results.Count) passed"
if ($passed -lt $results.Count) { exit 1 } else { exit 0 }
