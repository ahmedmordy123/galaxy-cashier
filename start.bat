@echo off
chcp 65001 >nul
:: CASR - Cashier system (dev mode)
title CASR POS
cd /d "%~dp0"

echo.
echo  ========================================
echo   CASR - Cashier System
echo  ========================================
echo.

where node >nul 2>&1 || (
  echo [ERROR] Node.js is not installed. Download from https://nodejs.org
  pause
  exit /b 1
)

if not exist "data\cashier.db" (
  echo ^> Setting up database for the first time...
  cd packages\db
  set DATABASE_URL=file:../../../data/cashier.db
  call npx prisma db push --schema prisma/schema.prisma
  call npx prisma db seed
  cd ..\..
)

echo ^> Starting servers...
echo.
echo   Web UI:  http://localhost:3001
echo   API:     http://localhost:4001
echo.
echo   Login:   admin / admin123
echo.
echo   Press Ctrl+C to stop
echo.

start "" "http://localhost:3001"
npx turbo run dev --filter=@ims-pro/api --filter=@ims-pro/web
