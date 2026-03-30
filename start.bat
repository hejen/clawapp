@echo off
chcp 65001 >nul
title OpenClaw Chat - 启动服务

echo ========================================
echo   OpenClaw Chat 启动脚本
echo ========================================
echo.

:: 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Node.js，请先安装: https://nodejs.org
    pause
    exit /b 1
)

:: 检查是否首次运行（需要安装依赖）
if not exist "server\node_modules" (
    echo [1/4] 安装 server 依赖...
    cd server && npm install && cd ..
) else (
    echo [1/4] server 依赖已安装
)

if not exist "h5\node_modules" (
    echo [2/4] 安装 h5 依赖...
    cd h5 && npm install && cd ..
) else (
    echo [2/4] h5 依赖已安装
)

:: 构建前端（生产模式需要）
if not exist "h5\dist\index.html" (
    echo [3/4] 构建前端...
    cd h5 && npm run build && cd ..
) else (
    echo [3/4] 前端已构建
)

echo [4/4] 启动后端服务...
echo.
echo ========================================
echo   服务地址: http://localhost:3210
echo   按 Ctrl+C 停止服务
echo ========================================
echo.

cd server && node index.js
pause
