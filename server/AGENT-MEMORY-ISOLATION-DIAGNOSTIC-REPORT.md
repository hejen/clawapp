# Agent Memory隔离问题 - 系统调试报告

生成时间: 2026-03-26

## 问题描述

**用户验证反馈：**
- 虽然conversation（会话）是隔离的
- 但agent的记忆（memory）是混乱的
- Alice打招呼时，Agent回复提到"上次咱们聊到晚上食欲失控的事"
- 这是其他用户的对话内容，不应该被Alice看到

**根本问题：**
> "Agent的记忆是按gateway-client记录的，所以会话是隔离的，但是agent的记忆却是混乱的"

## Phase 1: Root Cause Investigation

### 1.1 收集证据

**日志分析：**
```bash
Alice: Device ID = a6a53d0fcec4cf8f2505c437d4df12bfcbf8386f9d43ada1cd8eeefcb30c47d7
Bob:   Device ID = a6a53d0fcec4cf8f2505c437d4df12bfcbf8386f9d43ada1cd8eeefcb30c47d7
```

**关键发现：**
- Alice和Bob使用**完全相同的device ID**
- 这是全局device key的ID
- 因为新用户没有生成独立的device key

**数据库查询：**
```sql
SELECT id, username, device_id IS NOT NULL as has_device_key
FROM users WHERE username IN ('alice', 'bob');

结果：
22|alice|0|  ← 没有device key
23|bob|0|    ← 没有device key
```

### 1.2 理解OpenClaw架构

**Gateway协议的device-centric设计：**
- `client.id`: 客户端类型（gateway-client）
- `device.id`: 设备身份标识
- `sessionKey`: 会话标识符

**关键理解：**
```
┌─────────────────────────────────────┐
│  OpenClaw Agent (counselor-bot)      │
│  Memory Key: device.id               │  ← 关键！
├─────────────────────────────────────┤
│  Device ID: a6a53d0fcec4cf8f...      │
│  ├─ Alice (user:22)                 │
│  │   └─ sessionKey: agent:...:user:22│
│  └─ Bob (user:23)                   │
│      └─ sessionKey: agent:...:user:23 │
└─────────────────────────────────────┘
         ↓
  Alice和Bob共享同一份memory！
```

### 1.3 搜索OpenClaw文档和Issue

**关键发现 - GitHub Issue #29237：**
> "All DM senders share one session → one context window → one reply route."
> "DMs should support per-sender session isolation."

**这是OpenClaw的已知架构问题：**
- 默认情况下，所有DM senders共享`agent:<agentId>:main` session
- 这导致跨sender的context和memory共享
- 会造成信息泄露（用户A看到用户B的对话内容）

## Phase 2: Pattern Analysis

### 2.1 查找解决方案

**OpenClaw官方推荐的配置：**
```json
{
  "session": {
    "dmScope": "per-channel-peer"
  }
}
```

**dmScope选项说明：**
- `main` (default): 所有DMs共享main session
- `per-peer`: 按sender ID跨channel隔离
- `per-channel-peer`: 按channel和peer隔离（**推荐多用户安全使用**）

**参考来源：**
- [OpenClaw Configuration Reference](https://docs.openclaw.ai/gateway/configuration-reference)
- [GitHub Issue #29237](https://github.com/openclaw/openclaw/issues/29237)
- [GitHub Issue #15146](https://github.com/openclaw/openclaw/issues/15146)

### 2.2 已知限制

**dmScope配置的已知bug：**
1. **Issue #15146**: dmScope设置在gateway重启后丢失
   - Workaround: `chmod 444 ~/.openclaw/openclaw.json`

2. **Issue #10172**: Feishu DM忽略dmScope配置
   - 仍然路由到`agent:main:main`

3. **Issue #39557**: Web Control UI不支持per-channel-peer
   - 不会创建独立的session key

## Phase 3: Hypothesis and Testing

### 3.1 假设

**假设：配置dmScope="per-channel-peer"可以隔离agent memory**

**预测行为：**
- 每个sender应该获得独立的session
- 每个session应该有独立的memory
- Alice和Bob不应该共享记忆

### 3.2 测试方法

1. 修改`~/.openclaw/openclaw.json`配置文件
2. 设置文件为只读，防止配置被覆盖
3. 重启OpenClaw Gateway
4. 使用新的测试用户验证memory隔离

## Phase 4: Implementation

### 4.1 已完成的步骤

**步骤1：修改OpenClaw配置**

修改文件：`C:\Users\workspace\.openclaw\openclaw.json`

添加配置：
```json
{
  "session": {
    "dmScope": "per-channel-peer"
  }
}
```

**步骤2：设置配置文件为只读**
```bash
chmod 444 ~/.openclaw/openclaw.json
```

**步骤3：创建测试脚本**

创建了`test-memory-isolation-dmScope.js`用于验证memory隔离

### 4.2 验证步骤

**请按以下步骤验证：**

1. **重启OpenClaw Gateway**
   - 如果Gateway是以GUI应用运行，请完全重启GUI应用
   - 确认配置已加载

2. **运行测试脚本**
   ```bash
   cd server
   node test-memory-isolation-dmScope.js
   ```

3. **关键验证 - 测试memory隔离：**
   - Charlie发送："我的名字是Charlie，我是个程序员"
   - David发送："我的名字是David，我是个设计师"
   - Charlie再次打招呼："你好"
   - **检查**：Agent是否知道Charlie是程序员？（应该✓）
   - **检查**：Agent是否认为David是设计师？（应该✗）
   - David再次打招呼："你好"
   - **检查**：Agent是否知道David是设计师？（应该✓）
   - **检查**：Agent是否认为Charlie是程序员？（应该✗）

4. **如果memory仍然共享，尝试：**
   - 清除旧的memory文件：`rm -rf ~/.openclaw/agents/main/sessions/*`
   - 使用完全新的测试用户名
   - 检查OpenClaw日志以确认dmScope配置已加载

## 备选方案

如果dmScope配置不生效，有以下备选方案：

### 方案1：为每个用户生成独立的device key

**原理：**
- Agent memory使用device.id作为标识符
- 每个用户有独立的device.id → 独立的memory

**实现：**
- 修改代码，在用户注册时自动生成device key
- 确保每个JWT用户使用独立的device key连接

**优点：**
- 从根本上解决memory隔离问题
- 不依赖OpenClaw配置

**缺点：**
- 需要修改代码
- 需要为每个用户存储Ed25519 key pair

### 方案2：使用不同的agents

**原理：**
- OpenClaw的memory是per-agent的
- 不同agents有独立的memory

**实现：**
- 为每个用户或用户组创建独立的agent
- 路由不同用户到不同的agents

**优点：**
- 完全隔离memory
- 符合OpenClaw的架构设计

**缺点：**
- 需要配置多个agents
- 管理复杂度高
- 不适合大量用户

### 方案3：等待OpenClaw官方修复

**相关Issues：**
- [Issue #29237](https://github.com/openclaw/openclaw/issues/29237): Per-sender session isolation for DMs
- [Issue #43903](https://github.com/openclaw/openclaw/issues/43903): Multiple gateway tokens for multi-user session isolation

**状态：**
- 这些是OpenClaw本身的架构问题
- 官方可能会在未来版本中修复

## 技术总结

### 根本原因

**OpenClaw的架构设计：**
1. Agent memory使用`device.id`作为用户标识符
2. 默认情况下，所有DM senders共享同一个session（`agent:<agentId>:main`）
3. SessionKey隔离了conversation context，但不隔离long-term memory

### 当前架构的问题

```
┌──────────────────────────────────────────┐
│  OpenClaw Gateway + Agent                │
├──────────────────────────────────────────┤
│  Device ID: <global-device-key>          │  ← 多用户共享
│  └─ Agent Memory                         │  ← Memory跨用户共享
│      ├─ User A (user:22)                 │
│      │   └─ sessionKey: agent:...:user:22│  ← Session已隔离
│      └─ User B (user:23)                 │
│          └─ sessionKey: agent:...:user:23│  ← Session已隔离
└──────────────────────────────────────────┘
```

### 预期架构（如果dmScope生效）

```
┌──────────────────────────────────────────┐
│  OpenClaw Gateway + Agent                │
│  (dmScope: per-channel-peer)             │
├──────────────────────────────────────────┤
│  Session: agent:main:<device-id>:user:22  │  ← User A的session
│  └─ Agent Memory (isolated)              │  ← Memory已隔离
│                                            │
│  Session: agent:main:<device-id>:user:23  │  ← User B的session
│  └─ Agent Memory (isolated)              │  ← Memory已隔离
└──────────────────────────────────────────┘
```

## 相关资源

### 文档
- [OpenClaw Gateway Configuration Reference](https://docs.openclaw.ai/gateway/configuration-reference)
- [OpenClaw Gateway Protocol](https://docs.openclaw.ai/zh-CN/gateway/protocol)
- [OpenClaw Security Documentation](https://docs.openclaw.ai/cli/security)

### GitHub Issues
- [Issue #29237: Per-sender session isolation for DMs](https://github.com/openclaw/openclaw/issues/29237)
- [Issue #15146: dmScope setting removed on gateway restart](https://github.com/openclaw/openclaw/issues/15146)
- [Issue #10172: Feishu DM ignores dmScope configuration](https://github.com/openclaw/openclaw/issues/10172)
- [Issue #39557: Web Control UI doesn't support per-channel-peer](https://github.com/openclaw/openclaw/issues/39557)
- [Issue #15325: Add per-agent memory isolation](https://github.com/openclaw/openclaw/issues/15325)

### 测试脚本
- `test-multi-user-isolation.js` - 验证多用户sessionKey隔离
- `test-conversation-isolation.js` - 实际对话隔离验证
- `test-memory-isolation-dmScope.js` - dmScope配置验证（新增）

## 下一步

1. **重启OpenClaw Gateway**
2. **运行验证测试**
3. **检查结果**：
   - 如果memory已隔离 → 问题解决！
   - 如果memory仍然共享 → 实施备选方案（方案1或2）

## Sources

- [GitHub Issue #29237: Per-sender session isolation for DMs](https://github.com/openclaw/openclaw/issues/29237)
- [GitHub Issue #15146: dmScope setting removed on gateway restart](https://github.com/openclaw/openclaw/issues/15146)
- [GitHub Issue #10172: Feishu DM ignores dmScope configuration](https://github.com/openclaw/openclaw/issues/10172)
- [OpenClaw Gateway Configuration Reference](https://docs.openclaw.ai/gateway/configuration-reference)
- [OpenClaw Security Documentation](https://docs.openclaw.ai/cli/security)
- [OpenClaw Gateway Protocol Documentation](https://docs.openclaw.ai/zh-CN/gateway/protocol)
