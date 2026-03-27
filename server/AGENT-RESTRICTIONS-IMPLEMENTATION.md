# Agent限制功能实施文档

**实施时间**: 2026-03-27
**目的**: 设置默认agent为counselor-bot，禁止使用main agent

---

## 🎯 实施目的

### 1. 默认Agent设置为counselor-bot
所有用户创建新会话时，默认使用`counselor-bot`而不是`main`。

### 2. 禁止使用main agent
完全禁止用户创建或使用`main` agent的会话，保留main agent用于系统用途。

---

## 📝 修改内容

### 修改的文件
- `server/index.js`

### 具体修改

#### 1. /api/connect接口修改

**位置**: 第1145行

**修改前**:
```javascript
const agentId = defaults?.defaultAgentId || 'main';
```

**修改后**:
```javascript
const agentId = defaults?.defaultAgentId || 'counselor-bot';
```

**位置**: 第1167行

**修改前**:
```javascript
sessionKey = defaults?.mainSessionKey || `agent:${defaults?.defaultAgentId || 'main'}:main`;
```

**修改后**:
```javascript
sessionKey = defaults?.mainSessionKey || `agent:${defaults?.defaultAgentId || 'counselor-bot'}:main`;
```

**新增验证** (第1171-1181行):
```javascript
// SECURITY: Prevent use of 'main' agent sessions
if (sessionKey && (sessionKey.includes(':main:') || sessionKey.includes(':main:jwt:') || sessionKey.startsWith('agent:main:'))) {
  log.warn(`[/api/connect] Blocked attempt to use 'main' agent session: userId=${jwtUserId}, sessionKey=${sessionKey}`);
  cleanupSession(sid);
  return res.status(403).json({
    ok: false,
    error: '不允许使用main agent。请使用counselor-bot或其他指定的agent。',
    code: 'FORBIDDEN_AGENT'
  });
}
```

#### 2. /api/sessions接口修改

**位置**: 第1454-1470行

**新增验证**:
```javascript
// SECURITY: Prevent creation of 'main' agent sessions
if (agentId === 'main' || (gatewaySessionId && gatewaySessionId.includes(':main:'))) {
  log.warn(`[/api/sessions] Blocked attempt to create 'main' agent session: userId=${userId}, agentId=${agentId}, sessionId=${gatewaySessionId}`);
  return res.status(403).json({
    ok: false,
    error: '不允许创建main agent的会话。请使用counselor-bot或其他指定的agent。',
    code: 'FORBIDDEN_AGENT'
  });
}
```

---

## 🔒 安全措施

### 1. 多层验证

**在/api/sessions中验证**:
- 检查请求中的`agentId`参数
- 检查`gatewaySessionId`中是否包含`:main:`

**在/api/connect中验证**:
- 检查生成的`sessionKey`是否包含main agent
- 检查多种可能的main agent模式：
  - `:main:` - Token用户的sessionKey格式
  - `:main:jwt:` - 错误的JWT用户sessionKey格式
  - `agent:main:` - 直接以main开头的sessionKey

### 2. 会话清理

当检测到main agent的使用时：
- 立即清理会话 (`cleanupSession(sid)`)
- 返回403禁止错误
- 记录安全警告日志

### 3. 错误响应

统一的错误响应格式：
```json
{
  "ok": false,
  "error": "不允许使用main agent。请使用counselor-bot或其他指定的agent。",
  "code": "FORBIDDEN_AGENT"
}
```

---

## 📊 SessionKey格式

### Counselor-bot (默认，允许)
```
agent:counselor-bot:jwt:<userId>
```
例如：`agent:counselor-bot:jwt:37`

### Main agent (禁止)
```
agent:main:jwt:<userId>
agent:main:main
```
这些格式都会被拒绝

---

## 🧪 测试验证

### 自动化测试

创建了测试脚本：`test-agent-restrictions.js`

**测试内容**：
1. 验证默认agent是counselor-bot
2. 验证创建main agent会话被拒绝
3. 验证connect时使用main agent被拒绝

**运行测试**：
```bash
# 需要先设置有效的JWT token
export TEST_JWT_TOKEN="your_token_here"
node test-agent-restrictions.js
```

### 手动测试

#### 测试1: 创建会话时的默认agent

**请求**:
```bash
curl -X POST http://localhost:3210/api/sessions \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "测试会话"}'
```

**期望结果**:
```json
{
  "ok": true,
  "gateway_session_id": "agent:counselor-bot:jwt:37",
  "agent_id": "counselor-bot"
}
```

#### 测试2: 尝试创建main agent会话

**请求**:
```bash
curl -X POST http://localhost:3210/api/sessions \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"agentId": "main", "title": "测试main"}'
```

**期望结果**:
```json
{
  "ok": false,
  "error": "不允许创建main agent的会话。请使用counselor-bot或其他指定的agent。",
  "code": "FORBIDDEN_AGENT"
}
```

**HTTP状态码**: `403 Forbidden`

---

## 📈 影响分析

### 正面影响

1. **统一的Agent管理**
   - 所有用户默认使用同一个agent (counselor-bot)
   - 便于管理和维护

2. **防止误用**
   - 阻止用户创建错误的agent会话
   - 避免因main agent导致的潜在问题

3. **系统安全性**
   - 保留main agent用于系统用途
   - 防止用户影响系统配置

### 兼容性

**新用户**:
- ✅ 自动使用counselor-bot
- ✅ 体验一致

**现有用户**:
- ⚠️  如果现有会话使用main agent：
  - JWT用户：不受影响（已使用counselor-bot）
  - Token用户：首次连接时会被拒绝，需要更新sessionKey

**迁移方案**:
如果需要迁移现有main agent会话，可以：
1. 在数据库中将所有`agent:main:*`的sessionKey更新为`agent:counselor-bot:*`
2. 通知用户重新创建会话

---

## 🔍 日志监控

### 关键日志

**被阻止的尝试**:
```
[/api/connect] Blocked attempt to use 'main' agent session: userId=37, sessionKey=agent:main:jwt:37
[/api/sessions] Blocked attempt to create 'main' agent session: userId=37, agentId=main, sessionId=agent:main:jwt:37
```

**正常的会话创建**:
```
[/api/sessions] JWT user creating session: userId=37, agentId=counselor-bot, sessionId=agent:counselor-bot:jwt:37
[/api/connect] JWT user has NO sessions, generated user-specific sessionKey: agent:counselor-bot:jwt:37
```

### 监控建议

1. **统计被阻止的尝试**
   - 监控日志中"Blocked attempt"的数量
   - 分析是否需要用户教育

2. **错误率监控**
   - 监控403错误的比例
   - 确保没有误杀正常请求

---

## 🔄 回滚方案

如果需要回滚这些修改：

```bash
# 查看commit
git log --oneline | grep "agent"

# 回滚到指定commit
git revert <commit-hash>

# 或者手动修改：
# 1. 将 'counselor-bot' 改回 'main'
# 2. 删除验证逻辑
```

---

## 📚 相关文档

- [OpenClaw Gateway Protocol](https://docs.openclaw.ai/gateway/protocol)
- [SessionKey修复报告](SESSIONKEY-FIX-REPORT.md)
- [记忆隔离问题排查](MEMORY-ISOLATION-TROUBLESHOOTING-SUMMARY.md)

---

## ✅ 实施检查清单

- [x] 修改/api/connect的默认agent
- [x] 修改/api/sessions的默认agent
- [x] 在/api/sessions中添加main agent验证
- [x] 在/api/connect中添加main agent验证
- [x] 创建测试脚本
- [x] 编写实施文档
- [ ] 更新API文档
- [ ] 运行测试验证
- [ ] 部署到生产环境

---

**实施人员**: Claude Code
**审核状态**: 待测试验证
**生产就绪**: ⏳ 需要测试验证
