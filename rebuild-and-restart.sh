#!/bin/bash
# OpenClaw Chat - 重新构建并后台启动服务

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "========================================"
echo "  OpenClaw Chat - 重新构建并后台启动"
echo "========================================"
echo

# 日志文件路径
LOG_DIR="$SCRIPT_DIR/logs"
LOG_FILE="$LOG_DIR/server-$(date +%Y%m%d-%H%M%S).log"
PID_FILE="$LOG_DIR/server.pid"

# 创建日志目录
mkdir -p "$LOG_DIR"

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "[错误] 未找到 Node.js，请先安装: https://nodejs.org"
    exit 1
fi

# 停止现有服务
echo "[1/4] 停止现有服务..."
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    kill $OLD_PID 2>/dev/null && echo "  ✓ 已停止旧服务 (PID: $OLD_PID)" || echo "  - 旧服务进程不存在"
    rm -f "$PID_FILE"
fi
lsof -ti:3210 | xargs -r kill -9 && echo "  ✓ 已清理3210端口" || echo "  - 3210端口未被占用"
lsof -ti:5173,5174 | xargs -r kill -9 && echo "  ✓ 已清理前端端口" || echo "  - 前端端口未被占用"

# 等待进程完全退出
sleep 1

# 构建前端
echo
echo "[2/4] 构建前端..."
cd h5
npm run build --silent
if [ $? -ne 0 ]; then
    echo "[错误] 前端构建失败"
    exit 1
fi
echo "  ✓ 前端构建完成"
cd ..

# 启动后端服务（后台运行）
echo
echo "[3/4] 启动后端服务..."
cd server
nohup node index.js > "$LOG_FILE" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" > "$PID_FILE"
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
    echo "✗ 后端服务启动失败，请查看日志: $LOG_FILE"
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
echo "  日志文件: $LOG_FILE"
echo "  PID 文件: $PID_FILE"
echo
echo "  查看实时日志: tail -f $LOG_FILE"
echo "  停止服务: kill $SERVER_PID"
echo "        或: cat $PID_FILE | xargs kill"
echo
echo "  【脚本执行完成，可以安全关闭控制台】"
echo "========================================"
