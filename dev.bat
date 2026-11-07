@echo off
setlocal
cd /d "%~dp0"

if not exist "frontend\node_modules" (
  echo 正在安装前端依赖...
  pushd frontend
  call npm install
  popd
)

if not exist "backend\web\dist\index.html" (
  echo 正在构建一次前端资源（后端 go:embed 需要）...
  pushd frontend
  call npm run build
  popd
)

start "Navideck Backend" "%~dp0scripts\dev-backend.bat"
timeout /t 2 /nobreak >nul
start "Navideck Frontend" "%~dp0scripts\dev-frontend.bat"
timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:5173"

echo.
echo 开发环境已启动：
echo   后端 API: http://127.0.0.1:8620
echo   前端页面: http://127.0.0.1:5173
echo 关闭两个命令行窗口即可停止服务。
endlocal
