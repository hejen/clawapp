#!/bin/bash
# OpenClaw Chat - 重新构建并重启服务

echo "========================================"
echo "  OpenClaw Chat - 重新构建并重启"
echo "========================================"
echo

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "[错误] 未找到 Node.js，请先安装: https://nodejs.org"
    exit 1
fi

# 停止现有服务
echo "[1/4] 停止现有服务..."
lsof -ti:3210 | xargs -r kill -9 && echo "  ✓ 已停止后端服务(3210)" || echo "  - 后端服务未运行"
lsof -ti:5173,5174 | xargs -r kill -9 && echo "  ✓ 已停止前端开发服务器(5173/5174)" || echo "  - 前端开发服务器未运行"

# 等待进程完全退出
sleep 1

# 构建前端
echo
echo "[2/4] 构建前端..."
cd h5
npm run build
if [ $? -ne 0 ]; then
    echo "[错误] 前端构建失败"
    exit 1
fi
cd ..

# 启动后端服务
echo
echo "[3/4] 启动后端服务..."
cd server
node index.js &
SERVER_PID=$!
cd ..

# 等待服务启动
echo
echo "[4/4] 等待服务启动..."
sleep 2

# 检查服务状态
echo
echo "========================================"
echo "  服务状态检查"
echo "========================================"

if lsof -i:3210 > /dev/null 2>&1; then
    echo "✓ 后端服务运行中: http://localhost:3210"
else
    echo "✗ 后端服务启动失败"
    exit 1
fi

if [ -f "h5/dist/index.html" ]; then
    echo "✓ 前端构建完成: /h5/dist/"
else
    echo "✗ 前端构建文件缺失"
    exit 1
fi

echo
echo "========================================"
echo "  服务已就绪！"
echo "========================================"
echo "  访问地址: http://localhost:3210"
echo "  后端 PID: $SERVER_PID"
echo
echo "  停止服务: kill $SERVER_PID"
echo "  查看日志: kill -USR1 $SERVER_PID"
echo "========================================"
