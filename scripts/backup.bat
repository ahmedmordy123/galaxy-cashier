@echo off
:: CASR — SQLite backup (Windows)
setlocal
set "SRC=%~dp0..\data\cashier.db"
set "DEST_DIR=%USERPROFILE%\Documents\CASR\backups"

if not exist "%SRC%" (
  echo [ERR] Database not found: %SRC%
  exit /b 1
)

if not exist "%DEST_DIR%" mkdir "%DEST_DIR%"

for /f "tokens=1-3 delims=/. " %%a in ("%date%") do set "D=%%c%%b%%a"
for /f "tokens=1-2 delims=:." %%a in ("%time%") do set "T=%%a%%b"
set "T=%T: =0%"
set "FILENAME=cashier-backup-%D%_%T%.db"

copy /Y "%SRC%" "%DEST_DIR%\%FILENAME%" >nul
if %errorlevel% equ 0 (
  echo [%date% %time%] Backup saved: %DEST_DIR%\%FILENAME%
) else (
  echo [%date% %time%] [ERR] Backup failed
  exit /b 1
)

:: Keep last 30 days
powershell -NoProfile -Command "Get-ChildItem '%DEST_DIR%' -Filter 'cashier-backup-*.db' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force"
echo [%date% %time%] Backup complete.
endlocal
