#Requires -Version 5.1

param(
  [switch]$InstallerOnly
)

<#
.SYNOPSIS
    Galaxy Cashier — Windows installer build pipeline.
    Run from any directory; script locates the monorepo root automatically.

.DESCRIPTION
    Step 1 - Bundle Express API with esbuild  (single server.js, no node_modules)
    Step 2 - Copy Prisma native binary        (query_engine-windows.dll.node)
    Step 3 - Copy node.exe into staging       (so clients need no Node.js install)
    Step 4 - Build Next.js standalone output  (NEXT_PUBLIC_API_URL baked in)
    Step 5 - Assemble web staging folder      (standalone + static + public)
    Step 6 - Copy pre-seeded SQLite template  (seed.db -> assets/)
    Step 7 - Run electron-builder             (NSIS Setup wizard for clients)

.OUTPUT
    apps/desktop/dist/
      Galaxy Cashier Setup <version>.exe    <- give this file to clients
#>

$ErrorActionPreference = 'Stop'
$Root    = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$Desktop = $PSScriptRoot

function Write-Step($n, $msg) { Write-Host "`n[$n/7] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)        { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Fail($msg)      { Write-Host "  [FAIL] $msg" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "  +----------------------------------------------+" -ForegroundColor Blue
Write-Host "  |  Galaxy Cashier - Windows Build              |" -ForegroundColor Blue
Write-Host "  +----------------------------------------------+" -ForegroundColor Blue
Write-Host "  Root : $Root"
Write-Host "  Date : $(Get-Date -Format 'yyyy-MM-dd HH:mm')"

# --- Clean staging ---
$StagingApi  = Join-Path $Desktop 'staging\api'
$StagingWeb  = Join-Path $Desktop 'staging\web'
$StagingNode = Join-Path $Desktop 'staging\node'
$AssetsDir   = Join-Path $Desktop 'assets'

if (-not $InstallerOnly) {
  foreach ($d in @($StagingApi, $StagingWeb, $StagingNode, $AssetsDir)) {
    if (Test-Path $d) { Remove-Item $d -Recurse -Force }
    New-Item -ItemType Directory -Force $d | Out-Null
  }
} else {
  foreach ($d in @($StagingApi, $StagingWeb, $StagingNode, $AssetsDir)) {
    New-Item -ItemType Directory -Force $d | Out-Null
  }
  $stagingReady = (Test-Path (Join-Path $StagingApi 'server.js')) -and
    (Test-Path (Join-Path $StagingNode 'node.exe')) -and
    (Test-Path (Join-Path $StagingWeb 'apps\web\server.js')) -and
    (Test-Path (Join-Path $AssetsDir 'seed.db'))
  if ($stagingReady) {
    Write-Host '  Staging already built — skipping steps 1–6' -ForegroundColor DarkGray
    Write-Step 7 'Running electron-builder (NSIS installer only)...'
    $ensure7 = Join-Path $Root 'scripts\ensure-7zip.ps1'
    if (Test-Path $ensure7) {
      & powershell -NoProfile -ExecutionPolicy Bypass -File $ensure7 -Root $Root
      if ($LASTEXITCODE -ne 0) { Write-Fail '7-Zip / 7za required for packaging. Install 7-Zip from https://www.7-zip.org/' }
    }
    Push-Location $Desktop
    try {
      $desktopNm = Join-Path $Desktop 'node_modules'
      $src7 = Join-Path $Root 'node_modules\7zip-bin'
      if (-not (Test-Path $src7)) { Write-Fail '7zip-bin missing at repo root' }
      New-Item -ItemType Directory -Force $desktopNm | Out-Null
      $dest7 = Join-Path $desktopNm '7zip-bin'
      if (Test-Path $dest7) { Remove-Item $dest7 -Recurse -Force }
      Copy-Item -Recurse -Force $src7 $dest7

      $env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'

      $ebCmd = Join-Path $Root 'node_modules\.bin\electron-builder.cmd'
      if (-not (Test-Path $ebCmd)) {
        $ebCmd = Join-Path $Root 'node_modules\electron-builder\cli.js'
      }
      if (Test-Path $ebCmd -PathType Leaf) {
        if ($ebCmd -like '*.cmd') {
          cmd /c "`"$ebCmd`" --win nsis --x64"
        } else {
          node $ebCmd --win nsis --x64
        }
      } else {
        Push-Location $Root
        cmd /c 'npx --yes electron-builder --win nsis --x64'
        Pop-Location
      }
      if ($LASTEXITCODE -ne 0) {
        Write-Host '  NSIS failed — trying portable .exe ...' -ForegroundColor Yellow
        if (Test-Path (Join-Path $Root 'node_modules\.bin\electron-builder.cmd')) {
          cmd /c "`"$(Join-Path $Root 'node_modules\.bin\electron-builder.cmd')`" --win portable --x64"
        } else {
          cmd /c 'npx --yes electron-builder --win portable --x64'
        }
      }
      if ($LASTEXITCODE -ne 0) { Write-Fail "electron-builder exited with code $LASTEXITCODE" }
      $installerDir = Join-Path $Desktop 'dist'
      $exes = Get-ChildItem $installerDir -Filter '*.exe' -ErrorAction SilentlyContinue
      if ($exes) {
        foreach ($exe in $exes) {
          Write-Ok "$($exe.Name)  ($([math]::Round($exe.Length/1MB, 1)) MB)"
        }
      } else {
        Write-Fail 'No .exe files found in dist/'
      }
    } catch { Write-Fail "electron-builder failed: $_" }
    finally { Pop-Location }
    Write-Host ''
    Write-Host '  +----------------------------------------------+' -ForegroundColor Green
    Write-Host '  |  BUILD COMPLETE                              |' -ForegroundColor Green
    Write-Host '  |  Give client: Galaxy Cashier Setup *.exe       |' -ForegroundColor Green
    Write-Host '  +----------------------------------------------+' -ForegroundColor Green
    exit 0
  }
  Write-Host '  Staging incomplete — running full build (steps 1–6)...' -ForegroundColor Yellow
  foreach ($d in @($StagingApi, $StagingWeb, $StagingNode, $AssetsDir)) {
    if (Test-Path $d) { Remove-Item $d -Recurse -Force }
    New-Item -ItemType Directory -Force $d | Out-Null
  }
}

# ============================================================
# STEP 1 - Bundle Express API with esbuild
# ============================================================
Write-Step 1 "Bundling Express API (esbuild)..."

Push-Location (Join-Path $Root 'apps\api')
try {
  node build-electron.mjs
  if (-not (Test-Path "$StagingApi\server.js")) { Write-Fail "esbuild output not found" }
  Write-Ok "API bundled: $([math]::Round((Get-Item "$StagingApi\server.js").Length/1KB)) KB"
} catch { Write-Fail "esbuild failed: $_" }
finally { Pop-Location }

# ============================================================
# STEP 2 - Copy Prisma native binary + client JS
# ============================================================
Write-Step 2 "Copying Prisma client + native binary..."

$NmRoot         = Join-Path $Root 'node_modules'
$PrismaClient   = Join-Path $NmRoot '@prisma\client'
$PrismaEngine   = Join-Path $NmRoot '.prisma\client'

if (-not (Test-Path $PrismaClient)) { Write-Fail "@prisma/client not found at $PrismaClient" }
if (-not (Test-Path $PrismaEngine)) { Write-Fail ".prisma/client not found at $PrismaEngine" }

$DestClient = Join-Path $StagingApi 'node_modules\@prisma\client'
$DestEngine = Join-Path $StagingApi 'node_modules\.prisma\client'
New-Item -ItemType Directory -Force (Split-Path $DestClient) | Out-Null
New-Item -ItemType Directory -Force (Split-Path $DestEngine) | Out-Null

Copy-Item -Recurse -Force $PrismaClient $DestClient
Copy-Item -Recurse -Force $PrismaEngine $DestEngine

$binary = Get-ChildItem $DestEngine -Filter '*.node' | Select-Object -First 1
if (-not $binary) { Write-Fail "Prisma native binary (.node) not found in $DestEngine" }
Write-Ok "Prisma client copied ($([math]::Round((Get-Item $binary.FullName).Length/1MB, 1)) MB binary)"

# ============================================================
# STEP 3 - Copy bundled node.exe (zero client dependencies)
# ============================================================
Write-Step 3 "Copying node.exe into staging (bundles Node.js runtime)..."

$NodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $NodeCmd) { $NodeCmd = Get-Command node -ErrorAction Stop }
$NodeExe = $NodeCmd.Source
if (-not (Test-Path $NodeExe)) { Write-Fail "node.exe not found at: $NodeExe" }

Copy-Item -Force $NodeExe (Join-Path $StagingNode 'node.exe')
Write-Ok "node.exe copied ($([math]::Round((Get-Item $NodeExe).Length/1MB, 1)) MB) from $NodeExe"

# ============================================================
# STEP 4 - Build Next.js (standalone output)
# ============================================================
Write-Step 4 "Building Next.js (standalone mode)..."

Push-Location (Join-Path $Root 'apps\web')
try {
  $env:NEXT_PUBLIC_API_URL    = 'http://localhost:4001'
  $env:NODE_ENV               = 'production'
  $env:NEXT_OUTPUT_STANDALONE = '1'   # tells next.config.mjs to use standalone output
  npm run build
  if ($LASTEXITCODE -ne 0) { Write-Fail "Next.js build exited with code $LASTEXITCODE" }
  $standaloneDir = Join-Path $Root 'apps\web\.next\standalone'
  if (-not (Test-Path $standaloneDir)) { Write-Fail "Next.js standalone output not found" }
  Write-Ok "Next.js build complete"
} catch { Write-Fail "Next.js build failed: $_" }
finally { Pop-Location }

# ============================================================
# STEP 5 - Assemble web staging (standalone + static + public)
# ============================================================
Write-Step 5 "Assembling web staging folder..."

$WebSrc      = Join-Path $Root 'apps\web'
$Standalone  = Join-Path $WebSrc '.next\standalone'
$NextStatic  = Join-Path $WebSrc '.next\static'
$PublicDir   = Join-Path $WebSrc 'public'

Copy-Item -Recurse -Force "$Standalone\*" "$StagingWeb\"

# In a monorepo, Next.js standalone places server.js at apps/web/server.js.
# Static assets and public must live alongside server.js so the server can find them.
$WebAppDir  = Join-Path $StagingWeb 'apps\web'
New-Item -ItemType Directory -Force $WebAppDir | Out-Null

$DestStatic = Join-Path $WebAppDir '.next\static'
$DestPublic = Join-Path $WebAppDir 'public'

if (Test-Path $DestStatic) { Remove-Item $DestStatic -Recurse -Force }
Copy-Item -Recurse -Force $NextStatic $DestStatic

if (Test-Path $DestPublic) { Remove-Item $DestPublic -Recurse -Force }
if (Test-Path $PublicDir)  { Copy-Item -Recurse -Force $PublicDir $DestPublic }

Write-Ok "Web staging assembled"

# ============================================================
# STEP 6 - Copy pre-seeded SQLite template
# ============================================================
Write-Step 6 "Preparing seed database template (client - users and settings only)..."

$DbDest = Join-Path $AssetsDir 'seed.db'
$SeedBuildDir = Join-Path $AssetsDir '_seed_build'
if (Test-Path $SeedBuildDir) { Remove-Item $SeedBuildDir -Recurse -Force }
New-Item -ItemType Directory -Force $SeedBuildDir | Out-Null
$TempDb = Join-Path $SeedBuildDir 'cashier.db'

Push-Location (Join-Path $Root 'packages\db')
try {
  $env:DATABASE_URL = 'file:' + ($TempDb -replace '\\', '/')
  $env:SEED_PROFILE = 'client'
  # Prisma writes progress to stderr — do not let ErrorActionPreference=Stop treat that as failure
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & npx prisma db push --force-reset --accept-data-loss --schema prisma/schema.prisma 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Fail 'prisma db push failed for seed.db' }
    & npx prisma db seed --schema prisma/schema.prisma 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Fail 'prisma db seed failed for seed.db' }
  } finally {
    $ErrorActionPreference = $prevEap
  }
} finally {
  Pop-Location
}

if (-not (Test-Path $TempDb)) {
  if (Test-Path $SeedBuildDir) { Remove-Item $SeedBuildDir -Recurse -Force -ErrorAction SilentlyContinue }
  Write-Fail "seed build did not produce cashier.db at $TempDb"
}

Copy-Item -Force $TempDb $DbDest
Remove-Item $SeedBuildDir -Recurse -Force -ErrorAction SilentlyContinue
Write-Ok "seed.db: $([math]::Round((Get-Item $DbDest).Length/1KB)) KB (client empty store, admin/admin123)"

# ============================================================
# STEP 7 - Electron-builder
# ============================================================
Write-Step 7 $(if ($InstallerOnly) { 'Running electron-builder (NSIS installer only)...' } else { 'Running electron-builder (NSIS)...' })

$ensure7 = Join-Path $Root 'scripts\ensure-7zip.ps1'
if (Test-Path $ensure7) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File $ensure7 -Root $Root
  if ($LASTEXITCODE -ne 0) { Write-Fail '7-Zip / 7za required for packaging. Install 7-Zip from https://www.7-zip.org/' }
}

Push-Location $Desktop
try {
  $desktopNm = Join-Path $Desktop 'node_modules'
  $src7 = Join-Path $Root 'node_modules\7zip-bin'
  if (-not (Test-Path $src7)) {
    Write-Fail '7zip-bin missing at repo root — run npm install at repo root'
  }
  New-Item -ItemType Directory -Force $desktopNm | Out-Null
  $dest7 = Join-Path $desktopNm '7zip-bin'
  if (Test-Path $dest7) { Remove-Item $dest7 -Recurse -Force }
  Copy-Item -Recurse -Force $src7 $dest7
  Write-Host '  [OK] Local node_modules stub (skips npm --production prune of 7zip-bin)' -ForegroundColor DarkGray

  $env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'

  $ebCmd = Join-Path $Root 'node_modules\.bin\electron-builder.cmd'
  if (-not (Test-Path $ebCmd)) {
    $ebCmd = Join-Path $Root 'node_modules\electron-builder\cli.js'
  }

  if (Test-Path $ebCmd -PathType Leaf) {
    if ($ebCmd -like '*.cmd') {
      cmd /c "`"$ebCmd`" --win nsis --x64"
    } else {
      node $ebCmd --win nsis --x64
    }
  } else {
    Push-Location $Root
    cmd /c 'npx --yes electron-builder --win nsis --x64'
    Pop-Location
  }
  if ($LASTEXITCODE -ne 0) {
    Write-Host '  NSIS failed — trying portable .exe ...' -ForegroundColor Yellow
    if (Test-Path (Join-Path $Root 'node_modules\.bin\electron-builder.cmd')) {
      cmd /c "`"$(Join-Path $Root 'node_modules\.bin\electron-builder.cmd')`" --win portable --x64"
    } else {
      cmd /c 'npx --yes electron-builder --win portable --x64'
    }
  }
  if ($LASTEXITCODE -ne 0) { Write-Fail "electron-builder exited with code $LASTEXITCODE" }
  $installerDir = Join-Path $Desktop 'dist'
  $exes = Get-ChildItem $installerDir -Filter '*.exe' -ErrorAction SilentlyContinue
  if ($exes) {
    foreach ($exe in $exes) {
      Write-Ok "$($exe.Name)  ($([math]::Round($exe.Length/1MB, 1)) MB)"
    }
  } else {
    Write-Fail "No .exe files found in dist/"
  }
} catch { Write-Fail "electron-builder failed: $_" }
finally { Pop-Location }

# --- Done ---
Write-Host ""
Write-Host "  +----------------------------------------------+" -ForegroundColor Green
Write-Host "  |  BUILD COMPLETE                              |" -ForegroundColor Green
Write-Host "  |                                              |" -ForegroundColor Green
Write-Host "  |  Give client: Galaxy Cashier Setup *.exe       |" -ForegroundColor Green
Write-Host "  |                                              |" -ForegroundColor Green
Write-Host "  |  First-run: copies seed.db to %APPDATA%     |" -ForegroundColor Green
Write-Host "  |  Login:     admin / admin123                 |" -ForegroundColor Green
Write-Host "  +----------------------------------------------+" -ForegroundColor Green
