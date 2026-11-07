@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Node.js，请安装 Node.js 20 或更高版本。
  exit /b 1
)

set "GO_EXE=go"
if exist "%~dp0.tools\go\bin\go.exe" set "GO_EXE=%~dp0.tools\go\bin\go.exe"
if /I "%GO_EXE%"=="go" (
  where go >nul 2>nul
  if errorlevel 1 (
    echo [错误] 未找到 Go，请安装 Go 1.24+，或将便携版放到 .tools\go。
    exit /b 1
  )
)

if not exist "frontend\node_modules" (
  echo [1/3] 安装前端依赖...
  pushd frontend
  call npm install
  if errorlevel 1 (
    popd
    exit /b 1
  )
  popd
) else (
  echo [1/3] 前端依赖已存在，跳过安装。
)

echo [2/3] 构建前端...
pushd frontend
call npm run build
if errorlevel 1 (
  popd
  exit /b 1
)
popd

echo [3/3] 构建后端可执行文件...
pushd backend
"%GO_EXE%" build -trimpath -ldflags "-s -w" -o "..\navideck.exe" .
if errorlevel 1 (
  popd
  exit /b 1
)
popd

echo.
echo 构建完成: %~dp0navideck.exe
echo 双击 start.bat 启动，或运行 dev.bat 进入开发模式。
endlocal
