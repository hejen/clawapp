#!/bin/bash
# OpenClaw Chat - Linux/Mac 开发模式

echo "========================================"
echo "  OpenClaw Chat 开发模式"
echo "  后端 + 前端热更新同时启动"
echo "========================================"
echo

if ! command -v node &> /dev/null; then
    echo "[错误] 未找到 Node.js"
    exit 1
fi

# 安装依赖
[ -d "server/node_modules" ] || (echo "安装 server 依赖..." && cd server && npm install && cd ..)
[ -d "h5/node_modules" ] || (echo "安装 h5 依赖..." && cd h5 && npm install && cd ..)

echo
echo "  后端:   http://localhost:3210"
echo "  前端:   http://localhost:5173"
echo "  按 Ctrl+C 停止所有服务"
echo

# 后台启动后端，前台启动前端
cd server && node index.js &
SERVER_PID=$!
cd ../h5 && npx vite --host

# 前端退出时关闭后端
kill $SERVER_PID 2>/dev/null
