# SessionId Metadata方案可行性分析

生成时间: 2026-03-27

## 问题描述

**背景**：
- SessionKey格式已修复为4部分：`agent:<agentId>:<channel>:<peerId>`
- 但数据库中存在旧格式的sessions（3部分）：`agent:counselor-bot:0e9e0d9b`
- 用户21有多个sessions，每个有不同的sessionId（如：0e9e0d9b, 913bb057, 2763f873）
- 当发送消息时，OpenClaw不知道具体是哪个sessionId

**OpenClaw Agent的建议**：
在inbound metadata中添加sessionId字段：
```json
{
  "label": "openclaw-control-ui",
  "id": "openclaw-control-ui",
  "sessionId": "0e9e0d9b"
}
```

## 当前实现分析

### 1. Client连接时的Metadata

**位置**：`server/index.js` 第198-213行

```javascript
const connectFrame = {
  type: 'req',
  id: `connect-${randomUUID()}`,
  method: 'connect',
  params: {
    minProtocol: 3, maxProtocol: 3,
    client: {
      id: clientId,                    // 固定为 'gateway-client'
      displayName: clientDisplayName,  // 例如: "user:37 (username)"
      version: '1.0.0',
      platform: 'web',
      mode: 'backend'
    },
    role: 'operator',
    scopes: SCOPES,
    caps: [],
    auth,
    device: { id: deviceKeyToUse.deviceId, publicKey: deviceKeyToUse.publicKey, signedAt, nonce, signature },
    locale: 'zh-CN',
    userAgent,  // 例如: "OpenClaw-Mobile-Proxy/1.0.0 [username(userId)]"
  },
};
```

**关键发现**：
1. `client.id` 必须是固定值 `'gateway-client'`（代码注释明确说明）
2. 已经通过 `displayName` 和 `userAgent` 传递了用户信息
3. **没有传递sessionId**

### 2. Chat.send调用链

**前端** (`h5/src/ws-client.js` 第250-254行)：
```javascript
chatSend(sessionKey, message, attachments) {
  const params = {
    sessionKey,
    message,
    deliver: false,
    idempotencyKey: uuid()
  }
  if (attachments?.length) params.attachments = attachments
  return this.request('chat.send', params)
}
```

**后端** (`server/index.js` 第1378-1399行)：
```javascript
const frame = { type: 'req', id: reqId, method, params };

if (method === 'chat.send') {
  setSessionProgress(session, {
    isBusy: true,
    sessionKey: params?.sessionKey || session.progress?.sessionKey || '',
    runId: '',
    state: 'sending',
  });
}

// 直接转发params到Gateway
session.upstream.send(JSON.stringify(frame));
```

**关键发现**：
- 前端发送的params中没有metadata字段
- 后端只是简单转发params到OpenClaw Gateway
- **没有在chat.send中传递sessionId**

## 方案可行性分析

### 方案A：在Client对象中添加sessionId（不推荐）⚠️

**实现方式**：
修改connect frame的client对象：
```javascript
client: {
  id: 'gateway-client',  // 不能修改
  label: 'openclaw-chat',
  sessionId: '0e9e0d9b',  // 添加这个字段
  displayName: clientDisplayName,
  // ...
}
```

**问题**：
1. ❌ **协议不明确**：OpenClaw Gateway协议文档没有说明client对象支持哪些自定义字段
2. ❌ **生命周期问题**：client连接是一次性的，后续切换session时无法更新
3. ❌ **全局性**：一个WebSocket连接对应一个client，但用户可能有多个sessions

**结论**：不可行

### 方案B：在chat.send的params中添加metadata（推荐）✅

**实现方式**：

**1. 修改前端** (`h5/src/ws-client.js`)：
```javascript
chatSend(sessionKey, message, attachments, sessionId) {
  const params = {
    sessionKey,
    message,
    deliver: false,
    idempotencyKey: uuid()
  }
  if (attachments?.length) params.attachments = attachments
  if (sessionId) params.metadata = { sessionId }  // 添加这一行
  return this.request('chat.send', params)
}
```

**2. 前端调用时传递sessionId** (`h5/src/chat-ui.js`)：
```javascript
// 从当前session信息中提取sessionId
const currentSessionId = extractSessionId(_sessionKey)
await wsClient.chatSend(_sessionKey, text, attachments, currentSessionId)
```

**3. 后端自动处理** (`server/index.js`)：
```javascript
// 在chat.send处理时，自动提取并添加metadata
if (method === 'chat.send') {
  // 从sessionKey或session对象中提取sessionId
  const sessionId = extractSessionId(params.sessionKey) || session.id

  // 如果params中没有metadata，自动添加
  if (!params.metadata) {
    params.metadata = {}
  }
  params.metadata.sessionId = sessionId

  // 然后转发到Gateway
  session.upstream.send(JSON.stringify(frame));
}
```

**优点**：
1. ✅ **每次请求都可以传递不同的sessionId**：符合实际使用场景
2. ✅ **后端自动处理**：前端不需要大改
3. ✅ **向后兼容**：metadata是可选字段
4. ✅ **符合OpenClaw建议**：在inbound metadata中添加sessionId

**问题**：
1. ⚠️ **需要验证OpenClaw Gateway是否支持chat.send的metadata参数**
2. ⚠️ **需要从哪里获取sessionId？**

### SessionId的来源问题

**核心问题**：sessionId从哪里来？

#### 情况1：新格式SessionKey（4部分）
格式：`agent:counselor-bot:jwt:37`

这里**没有sessionId**！
- agentId = counselor-bot
- channel = jwt
- peerId = 37 (用户ID)

**问题**：新格式本身就是以用户为维度的，每个用户只有一个sessionKey，不存在多session的情况。

#### 情况2：旧格式SessionKey（3部分）
格式：`agent:counselor-bot:0e9e0d9b`

这里有sessionId：
- agentId = counselor-bot
- sessionId = 0e9e0d9b

**问题**：这是旧格式，新连接不会再生成这种格式。

## 真正的问题分析

### 问题根源

让我重新理解一下：

1. **新格式（当前使用）**：
   ```
   SessionKey: agent:counselor-bot:jwt:37
   意义：用户37的所有对话都使用这个sessionKey
   ```

2. **旧格式（数据库中）**：
   ```
   SessionKey: agent:counselor-bot:0e9e0d9b
   意义：这是一个具体的会话，sessionId是0e9e0d9b
   ```

3. **数据库记录**：
   ```
   55|21|agent:counselor-bot:0e9e0d9b|counselor-bot|2026-03-26 15:15:09
   ```
   用户21有多个会话，每个会话有不同的sessionId

### 问题是什么？

当用户使用旧格式的sessionKey发送消息时：
- SessionKey: `agent:counselor-bot:0e9e0d9b`
- OpenClaw解析后的peerId是 `0e9e0d9b`（被当作用户ID）
- 但实际上，`0e9e0d9b` 是一个sessionId，不是userId

**结果**：
- OpenClaw认为这是用户 `0e9e0d9b` 发送的消息
- 但实际上这是用户21的一个会话

### OpenClaw Agent的建议理解

OpenClaw agent说"在inbound metadata里加sessionId"，意思是：

当我们使用旧格式sessionKey发送消息时，同时告诉OpenClaw：
- "这个消息其实属于用户21"
- "具体是sessionId为0e9e0d9b的会话"

这样OpenClaw就能正确处理记忆了。

## 最佳解决方案

### 方案：在chat.send中添加完整的用户识别信息

**实现**：

修改后端 `server/index.js` 的chat.send处理：

```javascript
if (method === 'chat.send') {
  // 添加用户识别信息到metadata
  const metadata = {
    // 如果是JWT用户，添加用户ID
    userId: session.jwtUserId || null,
    username: session.username || null,

    // 添加原始sessionId（如果sessionKey中包含）
    originalSessionId: extractSessionId(params.sessionKey),

    // 添加当前WebSocket连接的sessionId
    connectionSessionId: session.id,
  }

  // 如果params中没有metadata，创建一个
  if (!params.metadata) {
    params.metadata = {}
  }

  // 合并我们的metadata
  Object.assign(params.metadata, metadata)

  // 转发到Gateway
  session.upstream.send(JSON.stringify({
    type: 'req',
    id: reqId,
    method,
    params
  }))
}
```

**优点**：
1. ✅ 提供完整的上下文信息
2. ✅ OpenClaw可以根据metadata中的字段正确识别用户
3. ✅ 支持新旧两种sessionKey格式
4. ✅ 后端自动处理，前端无需修改

## 总结

### 可行性：✅ 可行

OpenClaw agent建议的方案是可行的，但需要正确实现：

1. ✅ **在inbound metadata中添加字段是可行的**
2. ✅ **应该在chat.send的params中添加metadata字段**
3. ✅ **后端自动处理，提取并添加用户信息**

### 实现建议

**优先级1（立即实现）**：
- 在后端chat.send处理中，自动添加metadata
- 包含：userId, username, originalSessionId等

**优先级2（验证）**：
- 与OpenClaw确认metadata字段的具体格式
- 确认哪些字段是必需的

**优先级3（前端优化）**：
- 前端也可以传递额外的metadata（如果需要）

### 关键洞察

**真正的解决方案不是"添加sessionId"**，而是**添加完整的用户识别信息**：

- 对于新格式（jwt:37），peerId就是userId，OpenClaw可以正确识别
- 对于旧格式（0e9e0d9b），我们需要通过metadata告诉OpenClaw真实的userId

这样，无论使用哪种sessionKey格式，OpenClaw都能正确识别用户并隔离记忆。

## 实施步骤

1. ✅ **分析完成**：理解了问题和OpenClaw的建议
2. ⏳ **修改后端**：在chat.send中添加metadata处理
3. ⏳ **测试验证**：使用旧sessionKey测试，验证记忆隔离
4. ⏳ **文档更新**：记录metadata字段格式

## 相关文件

- `server/index.js` - 需要修改chat.send处理逻辑
- `h5/src/ws-client.js` - 前端chatSend调用（可选修改）
- `server/SESSIONKEY-FIX-REPORT.md` - SessionKey格式修复记录
