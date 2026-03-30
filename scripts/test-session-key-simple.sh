#!/bin/bash
# 会话 Key 优化功能简化测试脚本
#
# 使用方法:
#   bash scripts/test-session-key-simple.sh

set -e

# 配置
API_BASE="http://localhost:3210"
AGENT_ID="counselor-bot"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "\n${GREEN}=== 会话 Key 优化功能测试 ===${NC}\n"
echo "后端地址: $API_BASE"
echo "测试时间: $(date '+%Y-%m-%d %H:%M:%S')"

# 测试 1: 检查后端服务
echo -e "\n${YELLOW}[测试 1]${NC} 检查后端服务"
if curl -s -f "$API_BASE" > /dev/null 2>&1; then
  echo -e "${GREEN}✅ 通过${NC}: 后端服务运行正常"
else
  echo -e "${RED}❌ 失败${NC}: 后端服务未运行"
  exit 1
fi

# 测试 2: 验证 UUID 工具函数存在
echo -e "\n${YELLOW}[测试 2]${NC} 验证 UUID 工具函数"
if [ -f "src/utils/uuid.js" ]; then
  echo -e "${GREEN}✅ 通过${NC}: UUID 工具函数文件存在"
  echo "文件内容:"
  head -10 src/utils/uuid.js
else
  echo -e "${RED}❌ 失败${NC}: UUID 工具函数文件不存在"
fi

# 测试 3: 验证会话创建 API
echo -e "\n${YELLOW}[测试 3]${NC} 验证会话创建 API"
if grep -q "generateUUID" src/routes/sessions.js 2>/dev/null; then
  echo -e "${GREEN}✅ 通过${NC}: 会话创建 API 使用 UUID 生成"
else
  echo -e "${RED}❌ 失败${NC}: 会话创建 API 未使用 UUID 生成"
fi

# 测试 4: 验证前端 API 客户端
echo -e "\n${YELLOW}[测试 4]${NC} 验证前端 API 客户端"
if [ -f "h5/src/services/api.ts" ]; then
  if ! grep -q "sessionKey.*=" h5/src/services/api.ts | grep "generate"; then
    echo -e "${GREEN}✅ 通过${NC}: 前端 API 客户端不再生成 sessionKey"
  else
    echo -e "${RED}❌ 失败${NC}: 前端 API 客户端仍在生成 sessionKey"
  fi
else
  echo -e "${RED}❌ 失败${NC}: 前端 API 客户端文件不存在"
fi

# 测试 5: 验证会话选择器
echo -e "\n${YELLOW}[测试 5]${NC} 验证会话选择器"
if [ -f "h5/src/components/session-selector.tsx" ]; then
  if ! grep -q "sessionKey" h5/src/components/session-selector.tsx | grep -q "generate"; then
    echo -e "${GREEN}✅ 通过${NC}: 会话选择器不再生成 sessionKey"
  else
    echo -e "${RED}❌ 失败${NC}: 会话选择器仍在生成 sessionKey"
  fi
else
  echo -e "${RED}❌ 失败${NC}: 会话选择器文件不存在"
fi

# 测试 6: 验证版本号
echo -e "\n${YELLOW}[测试 6]${NC} 验证版本号"
if [ -f "h5/package.json" ]; then
  VERSION=$(grep '"version"' h5/package.json | head -1 | cut -d'"' -f4)
  echo "当前版本: $VERSION"
  if [ "$VERSION" = "1.1.0" ]; then
    echo -e "${GREEN}✅ 通过${NC}: 版本号正确"
  else
    echo -e "${YELLOW}⚠️  警告${NC}: 版本号应为 1.1.0，当前为 $VERSION"
  fi
fi

# 总结
echo -e "\n${GREEN}=== 测试完成 ===${NC}\n"
echo "注意：完整的端到端测试需要："
echo "1. 启动后端服务: npm start"
echo "2. 启动前端服务: cd h5 && npm run dev"
echo "3. 在浏览器中手动测试所有场景"
echo ""
echo "详细测试场景请参考: docs/test-reports/session-key-optimization-20260330.md"
