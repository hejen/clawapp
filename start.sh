#!/bin/bash
# OpenClaw Chat - Linux/Mac 启动脚本

echo "========================================"
echo "  OpenClaw Chat 启动脚本"
echo "========================================"
echo

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "[错误] 未找到 Node.js，请先安装: https://nodejs.org"
    exit 1
fi

# 安装依赖
[ -d "server/node_modules" ] && echo "[1/3] server 依赖已安装" || (echo "[1/3] 安装 server 依赖..." && cd server && npm install && cd ..)
[ -d "h5/node_modules" ] && echo "[2/3] h5 依赖已安装" || (echo "[2/3] 安装 h5 依赖..." && cd h5 && npm install && cd ..)

# 构建前端
[ -f "h5/dist/index.html" ] && echo "[3/3] 前端已构建" || (echo "[3/3] 构建前端..." && cd h5 && npm run build && cd ..)

echo
echo "启动后端服务..."
echo "========================================"
echo "  服务地址: http://localhost:3210"
echo "  按 Ctrl+C 停止服务"
echo "========================================"
echo

cd server && node index.js
