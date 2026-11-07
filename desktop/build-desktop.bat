@echo off
setlocal
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm not found. Please install Node.js.
  exit /b 1
)
where go >nul 2>nul
if errorlevel 1 (
  echo [ERROR] go not found. Please install Go.
  exit /b 1
)
if not exist "..\frontend\node_modules" (
  echo [ERROR] frontend dependencies are missing.
  echo         Run: cd frontend
  echo              npm install
  exit /b 1
)

echo [1/3] Building frontend...
pushd ..\frontend
call npm run build
if errorlevel 1 goto :fail
popd

echo [2/3] Copying frontend assets...
if not exist web mkdir web
if exist web\dist rmdir /s /q web\dist
xcopy /E /I /Y ..\backend\web\dist web\dist >nul
if errorlevel 1 goto :fail

echo [3/3] Building desktop executable...
if "%GOPROXY%"=="" set GOPROXY=https://goproxy.cn,direct
go build -tags production -trimpath -ldflags "-H windowsgui -s -w" -o StarBaseDesktop.exe .
if errorlevel 1 goto :fail

echo.
echo Done.
exit /b 0

:fail
echo.
echo Build failed.
exit /b 1
