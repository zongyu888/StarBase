@echo off
setlocal
cd /d "%~dp0.."
where go >nul 2>nul
if errorlevel 1 (
  echo [ERROR] go not found.
  exit /b 1
)

if not exist dist mkdir dist

echo Building StarBase Agent...
go build -trimpath -ldflags "-s -w" -o dist\starbase-agent.exe .\cmd\starbase-agent
if errorlevel 1 (
  echo Build failed.
  exit /b 1
)
echo.
echo Done: dist\starbase-agent.exe