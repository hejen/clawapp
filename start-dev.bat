@echo off
chcp 65001 >nul
title OpenClaw Chat - 开发模式

echo ========================================
echo   OpenClaw Chat 开发模式
echo   后端 + 前端热更新同时启动
echo ========================================
echo.

:: 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Node.js，请先安装: https://nodejs.org
    pause
    exit /b 1
)

:: 检查依赖
if not exist "server\node_modules" (
    echo [1/2] 安装 server 依赖...
    cd server && npm install && cd ..
)
if not exist "h5\node_modules" (
    echo [1/2] 安装 h5 依赖...
    cd h5 && npm install && cd ..
)

echo [2/2] 启动服务...
echo.
echo   后端:   http://localhost:3210
echo   前端:   http://localhost:5173
echo   按 Ctrl+C 停止所有服务
echo.

:: 同时启动后端和前端
start "OpenClaw Server" cmd /k "cd server && node index.js"
timeout /t 2 /nobreak >nul
start "OpenClaw H5 Dev" cmd /k "cd h5 && npx vite --host"

echo 服务已启动，关闭此窗口不会停止服务。
pause
