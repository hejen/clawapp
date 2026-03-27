# SessionKey格式修复报告

生成时间: 2026-03-26

## 问题描述

用户反馈：即使修改了代码，不同JWT用户的记忆仍然混乱。

## 根本原因分析

### Phase 1: 根因调查

**问题发现：**
- 之前使用的sessionKey格式：`agent:counselor-bot:jwt:user:37`（5部分）
- 飞书插件的格式：`agent:main:feishu:ou_abc123`（4部分）

**关键洞察：**
OpenClaw Gateway的sessionKey协议只解析4部分：`agent:<agentId>:<channel>:<peerId>`

如果提供5部分格式，OpenClaw只解析前4部分，导致：
- 飞书的peerId: `ou_abc123`（完整用户ID）✓
- 我们的peerId: `jwt`（用户ID被忽略了！）✗

**结果：**所有JWT用户的peerId都被解析成 `jwt`，导致记忆无法隔离！

## 解决方案

### 修改内容

**文件：** `server/index.js`

**位置1：** `/api/connect` 端点（第1140-1165行）

**修改前：**
```javascript
const userPeerId = `jwt:user:${jwtUserId}`;
sessionKey = `agent:${agentId}:${userPeerId}`;
// 结果：agent:counselor-bot:jwt:user:37 (5部分)
```

**修改后：**
```javascript
// 直接使用4部分格式
sessionKey = `agent:${agentId}:jwt:${jwtUserId}`;
// 结果：agent:counselor-bot:jwt:37 (4部分)
```

**位置2：** `/api/sessions` 端点（第1445-1458行）

**修改前：**
```javascript
const userPeerId = `jwt:user:${userId}`;
finalGatewaySessionId = `agent:${agentIdToUse}:${userPeerId}`;
// 结果：agent:counselor-bot:jwt:user:37 (5部分)
```

**修改后：**
```javascript
// 直接使用4部分格式
finalGatewaySessionId = `agent:${agentIdToUse}:jwt:${userId}`;
// 结果：agent:counselor-bot:jwt:37 (4部分)
```

## 格式对比

### 修改前（错误）
```
agent:counselor-bot:jwt:user:37
│     │             │    │    └─ 用户ID（被忽略）
│     │             │    └───── peer类型
│     │             └───────── channel（被误认为是peerId）
│     └─────────────────────── agent ID
└───────────────────────────── 协议前缀

OpenClaw解析：peerId = "jwt" ← 所有用户共享！
```

### 修改后（正确）
```
agent:counselor-bot:jwt:37
│     │             │    └─ 用户ID（唯一标识）
│     │             └─────── channel（认证方式）
│     └───────────────────── agent ID
└─────────────────────────── 协议前缀

OpenClaw解析：peerId = "37" ← 每个用户不同！
```

### 飞书插件格式（参考）
```
agent:main:feishu:ou_abc123
│     │    │       └─ 飞书用户ID（唯一标识）
│     │    └───────── channel（飞书）
│     └────────────── agent ID
└───────────────────── 协议前缀

OpenClaw解析：peerId = "ou_abc123"
```

## 验证测试

### 测试脚本
运行：`node test-multi-user-sessionkey.js`

### 测试结果
```
✓ 用户37: agent:counselor-bot:jwt:37
✓ 用户38: agent:counselor-bot:jwt:38
✓ 用户39: agent:counselor-bot:jwt:39

✓ 所有用户的SessionKey都不同！
✓ 每个用户的peerId都不同！
```

## 技术细节

### OpenClaw SessionKey协议

根据OpenClaw文档和飞书插件的实现：
- **格式**：`agent:<agentId>:<channel>:<peerId>`
- **部分说明**：
  - `agent`: 协议前缀（固定）
  - `<agentId>`: Agent标识（如counselor-bot、main）
  - `<channel>`: 渠道类型（如jwt、feishu、telegram）
  - `<peerId>`: 用户唯一标识（必须唯一！）

### 记忆隔离机制

OpenClaw使用sessionKey中的peerId来隔离记忆：
- **正确**：每个用户有唯一的peerId → 记忆隔离 ✓
- **错误**：多个用户共享相同的peerId → 记忆混乱 ✗

## 数据库迁移

### 旧格式sessionKeys
数据库中可能存在旧格式的sessionKeys：
```
agent:counselor-bot:7
agent:counselor-bot:2524
agent:counselor-bot:294ee7c8
```

### 建议
1. **清理旧sessions**：建议用户删除并重新创建会话
2. **自动迁移**：新连接会自动使用新格式
3. **兼容性**：旧格式仍然可以工作，但记忆不会隔离

## Device Key隔离

### 当前实现
代码已经正确实现了device key隔离：
- 每个JWT用户有独立的device ID
- 通过 `fetchUserDeviceKey` 函数自动生成
- 存储在 `users.device_id` 字段

### 验证
```bash
sqlite3 data/chat.db "SELECT id, username, SUBSTR(device_id, 1, 16) FROM users WHERE id IN (37, 38);"
```

结果：
```
37|isolation_user_1|0b70176b3822928a
38|isolation_user_2|f703bcd50f65cccc
```

## 总结

### 问题本质
**SessionKey格式错误（5部分而非4部分），导致OpenClaw无法正确解析peerId。**

### 解决方案
**修正sessionKey格式，使用4部分格式：`agent:<agentId>:jwt:<userId>`**

### 关键学习
1. **OpenClaw sessionKey协议是严格的4部分格式**
2. **peerId必须是用户唯一标识**
3. **参考成功的实现模式（飞书插件）**
4. **测试验证格式是否符合协议**

## 验证步骤

1. **重启服务器**：加载新代码
2. **测试连接**：使用 `node test-multi-user-sessionkey.js`
3. **验证格式**：确认sessionKey是4部分格式
4. **验证隔离**：每个用户的peerId都不同
5. **实际测试**：在OpenClaw控制台验证记忆隔离

## 后续建议

1. **添加sessionKey格式验证**
   - 在生成时验证格式
   - 确保符合4部分协议

2. **添加自动化测试**
   - 自动测试sessionKey格式
   - 验证记忆隔离

3. **文档更新**
   - 记录sessionKey格式要求
   - 说明与OpenClaw协议的关系

4. **用户迁移指南**
   - 说明如何清理旧sessions
   - 指导用户重新创建会话

## 相关资源

### OpenClaw文档
- [Session Management](https://docs.openclaw.ai/concepts/session)
- [Gateway Protocol](https://docs.openclaw.ai/zh-CN/gateway/protocol)

### 参考实现
- [飞书OpenClaw Bridge](https://github.com/AlexAnys/feishu-openclaw)
- 飞书sessionKey格式：`agent:main:feishu:ou_abc123`

### 测试脚本
- `test-sessionkey-format.js` - 单用户sessionKey格式测试
- `test-multi-user-sessionkey.js` - 多用户sessionKey对比测试
