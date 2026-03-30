#!/bin/bash
# OpenClaw Chat - 停止后台服务

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PID_FILE="$SCRIPT_DIR/logs/server.pid"

echo "========================================"
echo "  OpenClaw Chat - 停止服务"
echo "========================================"
echo

# 从 PID 文件读取并停止服务
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if kill $PID 2>/dev/null; then
        echo "✓ 已停止服务 (PID: $PID)"
        rm -f "$PID_FILE"
    else
        echo "✗ 进程 $PID 不存在或已停止"
        rm -f "$PID_FILE"
    fi
else
    echo "未找到 PID 文件"
fi

# 强制清理可能残留的进程
lsof -ti:3210 | xargs -r kill -9 && echo "✓ 已清理3210端口" || echo "  - 3210端口未被占用"

echo
echo "========================================"
echo "  服务已停止"
echo "========================================"
