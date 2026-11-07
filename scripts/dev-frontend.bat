@echo off
cd /d "%~dp0..\frontend"
if not exist node_modules call npm install
echo Navideck 前端开发服务 (Ctrl+C 停止)
npm run dev
