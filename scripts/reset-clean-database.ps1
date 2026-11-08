#Requires -Version 5.1
# Fresh SQLite: schema + seed only (users, categories, settings — no sales/stock demo data)
$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$DataDir = Join-Path $Root 'data'
$DbFile = Join-Path $DataDir 'cashier.db'
$DbDir = Join-Path $Root 'packages\db'

Write-Host ''
Write-Host '  Galaxy Cashier — reset to empty database' -ForegroundColor Cyan
Write-Host ''

New-Item -ItemType Directory -Force $DataDir | Out-Null

if (Test-Path $DbFile) {
  $bak = Join-Path $DataDir ("cashier-backup-{0}.db" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
  Copy-Item -Force $DbFile $bak
  Remove-Item -Force $DbFile
  Write-Host "  Backed up old DB to: $bak" -ForegroundColor DarkGray
}

$wal = "$DbFile-wal"
$shm = "$DbFile-shm"
foreach ($f in @($wal, $shm)) {
  if (Test-Path $f) { Remove-Item -Force $f }
}

Push-Location $DbDir
try {
  $env:DATABASE_URL = 'file:' + ($DbFile -replace '\\', '/')
  $env:SEED_PROFILE = 'client'
  npx prisma db push --force-reset --accept-data-loss --schema prisma/schema.prisma
  if ($LASTEXITCODE -ne 0) { throw 'prisma db push failed' }
  npx prisma db seed --schema prisma/schema.prisma
  if ($LASTEXITCODE -ne 0) { throw 'db seed failed' }
} finally {
  Pop-Location
}

# Refresh desktop installer template (first-run copy for new installs)
$AssetsDir = Join-Path $Root 'apps\desktop\assets'
New-Item -ItemType Directory -Force $AssetsDir | Out-Null
$SeedDest = Join-Path $AssetsDir 'seed.db'
Copy-Item -Force $DbFile $SeedDest

Write-Host ''
Write-Host '  DONE — clean database' -ForegroundColor Green
Write-Host "  Dev DB  : $DbFile"
Write-Host "  seed.db : $SeedDest"
Write-Host '  Login   : admin / admin123'
Write-Host ''
Write-Host '  Desktop app already installed? Delete then restart once:' -ForegroundColor Yellow
Write-Host "  $env:APPDATA\CASR\cashier.db"
Write-Host ''
