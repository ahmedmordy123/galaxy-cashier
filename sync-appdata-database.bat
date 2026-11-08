@echo off
set DB=%APPDATA%\CASR\cashier.db
if not exist "%DB%" (
  echo No database at: %DB%
  echo Install the app once or use dev DB at E:\CASR\data\cashier.db
  pause
  exit /b 1
)
echo Syncing schema: %DB%
cd /d "%~dp0packages\db"
set DATABASE_URL=file:%DB%
call npx prisma db push --accept-data-loss --skip-generate --schema prisma/schema.prisma
if errorlevel 1 pause
exit /b %errorlevel%
