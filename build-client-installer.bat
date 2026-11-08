@echo off
cd /d "%~dp0"
echo.
echo  Galaxy Cashier - Client installer (empty database)
echo.

where node >nul 2>&1 || (
  echo Install Node.js 20+ from https://nodejs.org
  pause & exit /b 1
)

echo [1/3] Client seed.db ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\reset-clean-database.ps1"
if errorlevel 1 pause & exit /b 1

echo [2/3] npm install ...
call npm install
if errorlevel 1 pause & exit /b 1

echo [3/3] Build NSIS installer ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0apps\desktop\build.ps1" -InstallerOnly
if errorlevel 1 (
  echo Build failed. Install 7-Zip if needed, then retry.
  pause & exit /b 1
)

echo.
echo  Give customer this file:
echo  %~dp0apps\desktop\dist\Galaxy Cashier Setup 1.0.0.exe
echo.
echo  First login: admin / admin123  ^(change in Settings - Users^)
echo.
dir /b "%~dp0apps\desktop\dist\Galaxy Cashier Setup*.exe" 2>nul
echo.
pause
