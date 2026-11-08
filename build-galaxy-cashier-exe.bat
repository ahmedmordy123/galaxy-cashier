@echo off
cd /d "%~dp0"

echo.
echo  Galaxy Cashier - Build Installer
echo.

where node >nul 2>&1 || (
  echo ERROR: Install Node.js 20+ from nodejs.org
  pause
  exit /b 1
)

echo [1/2] npm install ...
call npm install
if errorlevel 1 (
  echo ERROR: npm install failed
  pause
  exit /b 1
)

echo [2/2] build-installer.ps1 ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0apps\desktop\build-installer.ps1"
if errorlevel 1 (
  echo ERROR: Build failed. Install 7-Zip from https://www.7-zip.org/ then run this bat again.
  pause
  exit /b 1
)

echo.
echo  DONE - see: %~dp0apps\desktop\dist\
dir /b "%~dp0apps\desktop\dist\*.exe" 2>nul
echo.
pause
