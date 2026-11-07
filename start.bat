@echo off
setlocal
cd /d "%~dp0"

if not exist "navideck.exe" (
  echo 未找到 navideck.exe，正在执行首次构建...
  call build.bat
  if errorlevel 1 exit /b 1
)

if "%NAVIDECK_PORT%"=="" set "NAVIDECK_PORT=8620"
echo.
echo Navideck 正在启动...
echo 访问地址: http://127.0.0.1:%NAVIDECK_PORT%
echo 数据目录: %~dp0data
echo 按 Ctrl+C 停止服务。
echo.

navideck.exe
endlocal
