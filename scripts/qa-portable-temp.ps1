# Launch Portable EXE from a temp folder; confirm shared Documents DB path (same as Setup).
$ErrorActionPreference = 'Continue'
$portableSrc = 'E:\CASR\Galaxy-Cashier-Distribution-v1.0.0\Galaxy Cashier 1.0.0.exe'
if (-not (Test-Path $portableSrc)) {
  Write-Host "FAIL | portable exe missing: $portableSrc"
  exit 1
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

$tmp = Join-Path $env:TEMP ("casr-portable-" + (Get-Date -Format 'yyyyMMddHHmmss'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$portableDst = Join-Path $tmp 'Galaxy Cashier 1.0.0.exe'
Copy-Item -Force $portableSrc $portableDst
Write-Host "Copied portable to $portableDst"

$docsDb = Join-Path $env:USERPROFILE 'Documents\CASR\data\cashier.db'
$beforeExists = Test-Path $docsDb
$beforeSize = if ($beforeExists) { (Get-Item $docsDb).Length } else { 0 }
$logs = Join-Path $env:USERPROFILE 'CASR-Logs\app.log'
$mark = "[qa-portable] start $(Get-Date -Format o)"
if (Test-Path $logs) { Add-Content $logs $mark }

Kill-Galaxy
$proc = Start-Process -FilePath $portableDst -WorkingDirectory $tmp -PassThru
Write-Host "Started portable pid=$($proc.Id)"

$ok = $false
for ($i = 0; $i -lt 120; $i++) {
  Start-Sleep 2
  try {
    if ((Invoke-WebRequest 'http://127.0.0.1:4001/health' -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) {
      $ok = $true
      break
    }
  } catch {}
  if ($proc.HasExited -and $i -gt 15) { break }
}
Write-Host "$(if($ok){'PASS'}else{'FAIL'}) | portable healthy sec=$($i*2) exited=$($proc.HasExited)"

$dbPathOk = $false
$noLocalDb = $true
$resourcesPathPortable = $false
if (Test-Path $logs) {
  $all = Get-Content $logs
  $idx = ($all | Select-String -SimpleMatch $mark | Select-Object -Last 1).LineNumber
  if (-not $idx) { $idx = [Math]::Max(1, $all.Count - 80) }
  $after = $all[([Math]::Max(0, $idx - 1))..($all.Count - 1)]
  $dbPathOk = ($after | Where-Object { $_ -match 'Documents\\CASR\\data\\cashier\.db' }).Count -gt 0
  $resourcesPathPortable = ($after | Where-Object { $_ -match 'app.isPackaged\s+:\s+true' }).Count -gt 0
}
# No cashier.db beside the temp portable extract / exe folder
$localDbs = Get-ChildItem $tmp -Recurse -Filter 'cashier.db' -ErrorAction SilentlyContinue
$noLocalDb = -not $localDbs
$docsStill = Test-Path $docsDb

Write-Host "$(if($dbPathOk){'PASS'}else{'FAIL'}) | log shows Documents\\CASR\\data DB"
Write-Host "$(if($noLocalDb){'PASS'}else{'FAIL'}) | no cashier.db under temp portable folder count=$(@($localDbs).Count)"
Write-Host "$(if($docsStill){'PASS'}else{'FAIL'}) | Documents DB still present size=$((Get-Item $docsDb -EA SilentlyContinue).Length) before=$beforeSize"
Write-Host "$(if($resourcesPathPortable){'PASS'}else{'FAIL'}) | packaged=true in log"

Kill-Galaxy
# Keep temp for inspection? remove
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue

$allOk = $ok -and $dbPathOk -and $noLocalDb -and $docsStill
if ($allOk) {
  Write-Host 'PASS | Portable uses same Documents DB as Setup (no duplicate)'
  exit 0
}
Write-Host 'FAIL | Portable path check'
exit 1
