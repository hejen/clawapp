# 会话 Key 优化设计文档

**日期**: 2026-03-30
**作者**: Claude Sonnet
**状态**: 设计阶段

---

## 问题描述

### 当前实现的问题

当前会话创建流程中，`sessionKey` 的格式为 `agent:{agentName}:{userInputName}`，用户输入的名称直接作为会话标识符的一部分。这导致以下问题：

1. **名称冲突风险**：用户可以修改会话名称，如果多个会话使用相同名称，会导致 `sessionKey` 冲突
2. **职责混淆**：名称既是展示属性又是标识符，违反了单一职责原则
3. **扩展性差**：未来如果要实现会话权限、共享等功能，当前设计会成为障碍

### 用户需求

- ✅ 支持跨设备访问（会话需要在不同设备间同步）
- ✅ 允许用户随时修改会话名称
- ❌ 不需要兼容现有会话数据（可以采用全新设计）

---

## 设计方案

### 核心变更

**变更前**：
```
sessionKey = "agent:counselor-bot:用户输入的名称"
```

**变更后**：
```
sessionKey = "agent:counselor-bot:{UUID}"
title = "用户输入的名称"  // 纯展示属性
```

### 架构设计

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│   前端 H5    │         │   后端 API   │         │   数据库     │
└──────┬──────┘         └──────┬──────┘         └──────┬──────┘
       │                       │                       │
       │ 1. 输入名称           │                       │
       │    "我的咨询"         │                       │
       ├──────────────────────>│                       │
       │  POST /api/sessions  │                       │
       │  { agentId, title }  │                       │
       │                       │                       │
       │                       │ 2. 生成 UUID         │
       │                       │    retry 3次         │
       │                       ├─────────────────────>│
       │                       │ 3. 检查唯一性        │
       │                       │<─────────────────────┤
       │                       │                       │
       │<──────────────────────┤                       │
       │ 4. 返回结果          │                       │
       │  {                   │                       │
       │    id: "uuid-xxx",   │                       │
       │    gateway_session_id:                      │
       │      "agent:counselor-bot:abc123-def456"   │
       │  }                  │                       │
       │                       │                       │
```

---

## 数据结构

### 前端会话对象

```javascript
{
  id: "550e8400-e29b-41d4-a716-446655440000",      // 服务器生成的 UUID
  gateway_session_id: "agent:counselor-bot:550e8400-e29b-41d4-a716-446655440000",
  title: "我的心理咨询",                              // 用户自定义，可修改
  agent_id: "counselor-bot",
  created_at: "2026-03-30T10:00:00Z",
  updated_at: "2026-03-30T10:00:00Z"
}
```

### IndexedDB 存储

**消息表**：
```javascript
{
  id: "msg-uuid-xxx",
  sessionKey: "agent:counselor-bot:550e8400-...",  // 使用新的 sessionKey
  role: "assistant",
  content: "你好，有什么可以帮助你的？",
  timestamp: 1711778400000,
  sync: true
}
```

**会话表**：
```javascript
{
  sessionKey: "agent:counselor-bot:550e8400-...",
  name: "我的心理咨询",
  updatedAt: 1711778400000,
  lastActivity: 1711778400000
}
```

---

## 组件变更

### 前端文件修改

#### 1. `h5/src/session-picker.js`

**删除**：
```javascript
// 第162行：删除随机名称生成
- const defaultSessionName = uuid().split('-')[0]
```

**修改创建会话逻辑**：
```javascript
// 第208行：不再使用用户输入构建 sessionKey
- const gatewaySessionId = `agent:${agent}:${name}`
+ const gatewaySessionId = null  // 让服务器生成

// 调用 API
const result = await api.createSession(null, agent, name)
const newKey = result.gateway_session_id  // 使用服务器返回的 sessionKey
```

#### 2. `h5/src/api.js`

**修改 `createSession` 方法**：
```javascript
async createSession(gatewaySessionId, agentId, title = null, metadata = null) {
  return this.request('POST', '/api/sessions', {
    gatewaySessionId,  // 改为可选，null 时由后端生成
    agentId,
    title,
    metadata
  });
}
```

### 后端 API 变更

#### 创建会话接口

**请求**：
```http
POST /api/sessions
Content-Type: application/json

{
  "gatewaySessionId": null,  // 可选，null 时自动生成
  "agentId": "counselor-bot",
  "title": "我的心理咨询"
}
```

**响应**：
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "gateway_session_id": "agent:counselor-bot:550e8400-e29b-41d4-a716-446655440000",
  "title": "我的心理咨询",
  "agent_id": "counselor-bot",
  "created_at": "2026-03-30T10:00:00Z",
  "updated_at": "2026-03-30T10:00:00Z"
}
```

---

## 错误处理

### UUID 冲突重试机制

```javascript
async function generateSessionKey(agentName) {
  const maxRetries = 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const uuid = generateUUIDv4();  // 生成 128 位随机 UUID
      const sessionKey = `agent:${agentName}:${uuid}`;

      // 尝试插入数据库，触发唯一约束检查
      await db.sessions.insert({ sessionKey });

      return sessionKey;  // 成功，返回唯一 sessionKey
    } catch (error) {
      if (error.code === 'DUPLICATE_KEY') {
        logger.warn(`UUID conflict on attempt ${attempt + 1}, retrying...`);
        continue;  // 冲突，重试
      }
      throw error;  // 其他错误，直接抛出
    }
  }

  // 3 次都失败
  logger.error(`Failed to generate unique sessionKey after ${maxRetries} attempts`);
  throw new Error('INTERNAL_ERROR');
}
```

### 为什么 3 次足够？

- UUID v4 冲突概率：≈ 1/2^122 ≈ 10^-37
- 连续 3 次冲突的概率几乎为 0
- 3 次重试可以避免极端情况下的无限循环

---

## 测试策略

### 单元测试

**API 客户端测试**：
- ✅ `createSession()` 正确传递参数
- ✅ `updateSessionTitle()` 正确更新 title

**IndexedDB 测试**：
- ✅ `saveSessionInfo()` 正确保存 sessionKey 和 name
- ✅ `getSession()` 正确读取会话信息

### 集成测试

**创建会话流程**：
```
1. 用户输入名称 "测试会话"
2. 调用 api.createSession(null, agentId, "测试会话")
3. 验证返回的 gateway_session_id 格式为 "agent:xxx:uuid"
4. 验证 IndexedDB 中正确存储
```

**修改名称流程**：
```
1. 修改会话名称为 "新名称"
2. 验证 api.updateSessionTitle() 调用成功
3. 验证 sessionKey 保持不变
4. 验证 IndexedDB 和 UI 都更新为 "新名称"
```

### 手动测试场景

| 场景 | 步骤 | 预期结果 |
|------|------|----------|
| 创建重复名称会话 | 创建两个名称相同的会话 | 两个会话有不同的 sessionKey |
| 修改名称 | 将会话名称修改为任意值 | sessionKey 不变，title 更新 |
| 特殊字符名称 | 创建名称包含 emoji/特殊符号的会话 | 正常创建，名称正确显示 |
| 超长名称 | 创建名称 >100 字符的会话 | 后端验证并拒绝或截断 |

---

## 实施计划

详见实现计划文档（待创建）。

---

## 影响范围

### 优点

- ✅ 完全解决名称冲突问题
- ✅ 名称可随时修改，不影响会话标识
- ✅ 符合 RESTful 设计原则
- ✅ 便于未来扩展（权限、共享等功能）

### 缺点

- ⚠️ 需要修改后端 API（新增 UUID 生成逻辑）
- ⚠️ 需要修改前端代码（3个文件）

### 兼容性

- ❌ 现有会话需要重新创建（用户已确认可接受）
- ✅ 新会话采用新格式，不影响跨设备访问

---

## 版本管理

根据项目版本管理规范：
- **MAJOR**: 不变（UI/功能模块未变）
- **MINOR**: 递增（新增会话管理优化功能）
- **PATCH**: 不变

**新版本**: 1.0.0 → 1.1.0
