# Verifies --sales on second launch navigates only (no API respawn).
$ErrorActionPreference = 'Continue'
$exe = 'E:\CASR\apps\desktop\dist\win-unpacked\Galaxy Cashier.exe'
$logs = Join-Path $env:USERPROFILE 'CASR-Logs\app.log'

function Kill-Galaxy {
  Get-Process -Name 'Galaxy Cashier' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  foreach ($p in 4001, 3001) {
    Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue |
      Where-Object State -eq Listen |
      ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  }
  Start-Sleep 2
}

function Wait-Api([int]$sec = 60) {
  for ($i = 0; $i -lt $sec; $i++) {
    Start-Sleep 1
    try {
      if ((Invoke-WebRequest 'http://127.0.0.1:4001/health' -UseBasicParsing -TimeoutSec 1).StatusCode -eq 200) {
        return $true
      }
    } catch {}
  }
  return $false
}

Kill-Galaxy
$logLen = if (Test-Path $logs) { (Get-Item $logs).Length } else { 0 }

Start-Process $exe | Out-Null
if (-not (Wait-Api 70)) {
  Write-Host 'FAIL | primary launch not healthy'
  exit 1
}
Write-Host 'PASS | primary launch healthy'

# Mark log position
$mark = "[qa-si] before-second $(Get-Date -Format o)"
Add-Content -Path $logs -Value $mark

Start-Process $exe -ArgumentList '--sales' | Out-Null
Start-Sleep 8

$tail = Get-Content $logs | Select-Object -SkipLast 0
# Get lines after mark
$idx = 0
$all = Get-Content $logs
for ($i = 0; $i -lt $all.Count; $i++) { if ($all[$i] -eq $mark) { $idx = $i } }
$after = $all[($idx + 1)..($all.Count - 1)]

$nav = ($after | Where-Object { $_ -match 'second-instance' -and $_ -match '/sales/new|navigate' }).Count -gt 0
$spawn = ($after | Where-Object { $_ -match 'Spawning API' }).Count -gt 0
$fullStart = ($after | Where-Object { $_ -match 'CASR starting' }).Count -gt 0
$listeners = @(Get-NetTCPConnection -LocalPort 4001 -ErrorAction SilentlyContinue | Where-Object State -eq Listen).Count

$ok = $nav -and (-not $spawn) -and (-not $fullStart) -and ($listeners -eq 1)
Write-Host "$(if($ok){'PASS'}else{'FAIL'}) | second-instance navigate-only nav=$nav spawn=$spawn fullStart=$fullStart listeners=$listeners"
$after | Select-Object -Last 20 | ForEach-Object { Write-Host "  LOG $_" }

Kill-Galaxy
if ($ok) { exit 0 } else { exit 1 }
