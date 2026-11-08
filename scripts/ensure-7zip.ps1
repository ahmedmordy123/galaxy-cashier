# Ensures 7za.exe exists for electron-builder (NSIS / portable)
param([string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path)

$7za = Join-Path $Root 'node_modules\7zip-bin\win\x64\7za.exe'
if (Test-Path $7za) {
  Write-Host ('[ensure-7zip] OK: ' + $7za)
  exit 0
}

Write-Host '[ensure-7zip] 7za missing - npm install 7zip-bin...'
Push-Location $Root
cmd /c 'npm install 7zip-bin@5.2.0 --save-dev --force'
Pop-Location

if (Test-Path $7za) {
  Write-Host '[ensure-7zip] OK after npm install'
  exit 0
}

$sys7z = Join-Path ${env:ProgramFiles} '7-Zip\7z.exe'
if (Test-Path $sys7z) {
  Write-Host ('[ensure-7zip] Using system 7-Zip: ' + $sys7z)
  $env:USE_SYSTEM_7ZA = 'true'
  exit 0
}

Write-Host '[ensure-7zip] FAIL: Install 7-Zip from https://www.7-zip.org/ then rebuild.'
exit 1
