#!/bin/bash
# 会话 Key 优化功能自动化测试脚本
#
# 使用方法:
#   chmod +x scripts/test-session-key.sh
#   ./scripts/test-session-key.sh
#
# 前提条件:
#   1. 后端服务已启动 (npm start)
#   2. 已安装 jq 工具 (用于 JSON 解析)

set -e

# 配置
API_BASE="${API_BASE:-http://localhost:3210}"
AGENT_ID="${AGENT_ID:-counselor-bot}"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 测试计数器
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# 打印函数
print_header() {
  echo -e "\n${GREEN}=== $1 ===${NC}\n"
}

print_test() {
  echo -e "\n${YELLOW}[测试 $((TOTAL_TESTS + 1))]${NC} $1"
  TOTAL_TESTS=$((TOTAL_TESTS + 1))
}

print_success() {
  echo -e "${GREEN}✅ 通过${NC}: $1"
  PASSED_TESTS=$((PASSED_TESTS + 1))
}

print_failure() {
  echo -e "${RED}❌ 失败${NC}: $1"
  FAILED_TESTS=$((FAILED_TESTS + 1))
}

print_info() {
  echo -e "ℹ️  $1"
}

# 检查依赖
check_dependencies() {
  print_header "检查依赖"

  if ! command -v curl &> /dev/null; then
    echo "错误: 未找到 curl 命令"
    exit 1
  fi

  if ! command -v jq &> /dev/null; then
    echo "警告: 未找到 jq 命令，JSON 解析功能受限"
    echo "安装: apt-get install jq (Linux) 或 brew install jq (macOS)"
  fi

  print_success "依赖检查完成"
}

# 检查后端服务
check_backend() {
  print_header "检查后端服务"

  if curl -s -f "$API_BASE/api/health" > /dev/null 2>&1; then
    print_success "后端服务运行正常"
  else
    print_failure "后端服务未运行，请先启动: npm start"
    exit 1
  fi
}

# 测试 1: 创建同名会话
test_create_duplicate_sessions() {
  print_test "创建同名会话"

  print_info "创建第一个会话..."
  SESSION1_RESPONSE=$(curl -s -X POST "$API_BASE/api/sessions" \
    -H "Content-Type: application/json" \
    -d "{\"agentId\":\"$AGENT_ID\",\"name\":\"测试\"}")

  print_info "响应: $SESSION1_RESPONSE"

  if command -v jq &> /dev/null; then
    SESSION1_SUCCESS=$(echo "$SESSION1_RESPONSE" | jq -r '.success // false')
    SESSION1_KEY=$(echo "$SESSION1_RESPONSE" | jq -r '.data.gateway_session_id // empty')

    if [ "$SESSION1_SUCCESS" = "true" ] && [ -n "$SESSION1_KEY" ]; then
      print_success "第一个会话创建成功"
      print_info "会话 1 Key: $SESSION1_KEY"
    else
      print_failure "第一个会话创建失败"
      return 1
    fi
  else
    print_info "跳过 JSON 解析（需要 jq）"
    SESSION1_KEY="extracted_manually"
  fi

  # 等待 1 秒确保 UUID 不同
  sleep 1

  print_info "创建第二个同名会话..."
  SESSION2_RESPONSE=$(curl -s -X POST "$API_BASE/api/sessions" \
    -H "Content-Type: application/json" \
    -d "{\"agentId\":\"$AGENT_ID\",\"name\":\"测试\"}")

  print_info "响应: $SESSION2_RESPONSE"

  if command -v jq &> /dev/null; then
    SESSION2_SUCCESS=$(echo "$SESSION2_RESPONSE" | jq -r '.success // false')
    SESSION2_KEY=$(echo "$SESSION2_RESPONSE" | jq -r '.data.gateway_session_id // empty')

    if [ "$SESSION2_SUCCESS" = "true" ] && [ -n "$SESSION2_KEY" ]; then
      print_success "第二个会话创建成功"
      print_info "会话 2 Key: $SESSION2_KEY"
    else
      print_failure "第二个会话创建失败"
      return 1
    fi

    # 验证 Keys 不同
    if [ "$SESSION1_KEY" != "$SESSION2_KEY" ]; then
      print_success "两个会话有不同的 sessionKey"
    else
      print_failure "两个会话的 sessionKey 相同"
      return 1
    fi

    # 验证格式
    if [[ "$SESSION1_KEY" =~ ^agent:$AGENT_ID:[a-f0-9-]{36}$ ]]; then
      print_success "sessionKey 格式正确 (agent:agentId:uuid)"
    else
      print_failure "sessionKey 格式不正确: $SESSION1_KEY"
      return 1
    fi
  else
    print_info "跳过详细验证（需要 jq）"
  fi
}

# 测试 2: 获取会话列表
test_get_sessions() {
  print_test "获取会话列表"

  LIST_RESPONSE=$(curl -s -X GET "$API_BASE/api/sessions?agentId=$AGENT_ID")

  print_info "响应: $LIST_RESPONSE"

  if command -v jq &> /dev/null; then
    LIST_SUCCESS=$(echo "$LIST_RESPONSE" | jq -r '.success // false')
    SESSION_COUNT=$(echo "$LIST_RESPONSE" | jq -r '.data | length // 0')

    if [ "$LIST_SUCCESS" = "true" ]; then
      print_success "获取会话列表成功"
      print_info "会话数量: $SESSION_COUNT"
    else
      print_failure "获取会话列表失败"
      return 1
    fi
  fi
}

# 测试 3: 修改会话名称
test_update_session_name() {
  print_test "修改会话名称"

  # 先创建一个会话
  CREATE_RESPONSE=$(curl -s -X POST "$API_BASE/api/sessions" \
    -H "Content-Type: application/json" \
    -d "{\"agentId\":\"$AGENT_ID\",\"name\":\"原始名称\"}")

  if command -v jq &> /dev/null; then
    SESSION_ID=$(echo "$CREATE_RESPONSE" | jq -r '.data.id // empty')
    ORIGINAL_KEY=$(echo "$CREATE_RESPONSE" | jq -r '.data.gateway_session_id // empty')

    if [ -z "$SESSION_ID" ]; then
      print_failure "创建测试会话失败"
      return 1
    fi

    print_info "会话 ID: $SESSION_ID"
    print_info "原始 Key: $ORIGINAL_KEY"

    # 更新名称
    print_info "更新会话名称..."
    UPDATE_RESPONSE=$(curl -s -X PUT "$API_BASE/api/sessions/$SESSION_ID" \
      -H "Content-Type: application/json" \
      -d "{\"name\":\"新名称\"}")

    print_info "响应: $UPDATE_RESPONSE"

    UPDATE_SUCCESS=$(echo "$UPDATE_RESPONSE" | jq -r '.success // false')
    UPDATED_KEY=$(echo "$UPDATE_RESPONSE" | jq -r '.data.gateway_session_id // empty')
    UPDATED_NAME=$(echo "$UPDATE_RESPONSE" | jq -r '.data.name // empty')

    if [ "$UPDATE_SUCCESS" = "true" ]; then
      print_success "更新会话名称成功"
      print_info "新名称: $UPDATED_NAME"
    else
      print_failure "更新会话名称失败"
      return 1
    fi

    # 验证 Key 未变
    if [ "$UPDATED_KEY" = "$ORIGINAL_KEY" ]; then
      print_success "修改名称后 sessionKey 保持不变"
    else
      print_failure "修改名称后 sessionKey 发生了变化"
      print_info "原始 Key: $ORIGINAL_KEY"
      print_info "新 Key: $UPDATED_KEY"
      return 1
    fi
  else
    print_info "跳过详细验证（需要 jq）"
  fi
}

# 测试 4: 边界情况
test_edge_cases() {
  print_test "边界情况 - 空名称"

  EMPTY_RESPONSE=$(curl -s -X POST "$API_BASE/api/sessions" \
    -H "Content-Type: application/json" \
    -d "{\"agentId\":\"$AGENT_ID\",\"name\":\"\"}")

  print_info "响应: $EMPTY_RESPONSE"

  if command -v jq &> /dev/null; then
    EMPTY_SUCCESS=$(echo "$EMPTY_RESPONSE" | jq -r '.success // false')
    EMPTY_NAME=$(echo "$EMPTY_RESPONSE" | jq -r '.data.name // empty')

    if [ "$EMPTY_SUCCESS" = "true" ]; then
      print_success "空名称会话创建成功"
      print_info "实际名称: '$EMPTY_NAME'"
    else
      print_info "空名称会话创建失败（可能是后端验证）"
    fi
  fi

  print_test "边界情况 - 特殊字符"

  SPECIAL_RESPONSE=$(curl -s -X POST "$API_BASE/api/sessions" \
    -H "Content-Type: application/json" \
    -d "{\"agentId\":\"$AGENT_ID\",\"name\":\"测试😀🎉\"}")

  print_info "响应: $SPECIAL_RESPONSE"

  if command -v jq &> /dev/null; then
    SPECIAL_SUCCESS=$(echo "$SPECIAL_RESPONSE" | jq -r '.success // false')
    SPECIAL_NAME=$(echo "$SPECIAL_RESPONSE" | jq -r '.data.name // empty')

    if [ "$SPECIAL_SUCCESS" = "true" ]; then
      print_success "特殊字符会话创建成功"
      print_info "实际名称: $SPECIAL_NAME"
    else
      print_failure "特殊字符会话创建失败"
      return 1
    fi
  fi
}

# 清理测试数据
cleanup() {
  print_header "清理测试数据"

  if [ "$SKIP_CLEANUP" = "true" ]; then
    print_info "跳过清理（SKIP_CLEANUP=true）"
    return
  fi

  print_info "提示: 手动清理测试会话"
  print_info "可以通过前端界面或 API 删除测试会话"
}

# 打印测试结果摘要
print_summary() {
  print_header "测试结果摘要"

  echo "总测试数: $TOTAL_TESTS"
  echo -e "${GREEN}通过: $PASSED_TESTS${NC}"
  echo -e "${RED}失败: $FAILED_TESTS${NC}"

  if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "\n${GREEN}🎉 所有测试通过！${NC}"
    return 0
  else
    echo -e "\n${RED}❌ 有测试失败${NC}"
    return 1
  fi
}

# 主函数
main() {
  print_header "会话 Key 优化功能测试"
  echo "后端地址: $API_BASE"
  echo "Agent ID: $AGENT_ID"
  echo "测试时间: $(date '+%Y-%m-%d %H:%M:%S')"

  check_dependencies
  check_backend

  test_create_duplicate_sessions
  test_get_sessions
  test_update_session_name
  test_edge_cases

  cleanup
  print_summary
}

# 运行测试
main
