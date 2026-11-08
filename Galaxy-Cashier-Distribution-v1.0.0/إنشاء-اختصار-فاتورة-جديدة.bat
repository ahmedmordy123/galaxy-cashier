@echo off
chcp 65001 >nul
setlocal
REM Creates a Desktop shortcut that opens Galaxy Cashier on New Sale (/sales/new)

set "EXE="
if exist "%ProgramFiles%\Galaxy Cashier\Galaxy Cashier.exe" set "EXE=%ProgramFiles%\Galaxy Cashier\Galaxy Cashier.exe"
if exist "%LocalAppData%\Programs\Galaxy Cashier\Galaxy Cashier.exe" set "EXE=%LocalAppData%\Programs\Galaxy Cashier\Galaxy Cashier.exe"
if exist "%~dp0Galaxy Cashier 1.0.0.exe" set "EXE=%~dp0Galaxy Cashier 1.0.0.exe"

if "%EXE%"=="" (
  echo لم يُعثر على Galaxy Cashier.exe
  echo ثبّت Setup أولاً أو ضع الملف المحمول بجانب هذا الـ bat.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\فاتورة مبيعات جديدة.lnk'); $s.TargetPath = '%EXE%'; $s.Arguments = '--sales'; $s.WorkingDirectory = [IO.Path]::GetDirectoryName('%EXE%'); $s.Description = 'جالاكسي كاشير — فاتورة جديدة'; $s.Save(); Write-Host 'تم إنشاء الاختصار على سطح المكتب'"

echo.
echo الاختصار: سطح المكتب \ فاتورة مبيعات جديدة
echo يفتح شاشة فاتورة مبيعات جديدة مباشرة بعد الدخول.
pause
