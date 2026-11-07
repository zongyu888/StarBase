@echo off
cd /d "%~dp0..\backend"
set "NAVIDECK_DATA_DIR=%~dp0..\data"
set "NAVIDECK_AUTH_DEV_CODES=1"
set "GO_EXE=go"
if exist "%~dp0..\.tools\go\bin\go.exe" set "GO_EXE=%~dp0..\.tools\go\bin\go.exe"
echo Navideck 后端开发服务 (Ctrl+C 停止)
"%GO_EXE%" run .
