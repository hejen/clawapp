# SessionId Metadata实施报告

生成时间: 2026-03-27

## 实施内容

根据OpenClaw agent的建议，在chat.send的inbound metadata中添加用户识别信息，确保OpenClaw能正确识别用户和会话。

## 修改内容

### 1. 添加辅助函数 `extractSessionId`

**位置**: `server/index.js` 第156-179行

**功能**: 从sessionKey中提取sessionId

```javascript
/**
 * 从sessionKey中提取sessionId
 * 支持新旧两种格式：
 * - 新格式: agent:counselor-bot:jwt:37 → 返回 null（以用户为维度）
 * - 旧格式: agent:counselor-bot:0e9e0d9b → 返回 '0e9e0d9b'
 */
function extractSessionId(sessionKey) {
  if (!sessionKey) return null;

  const parts = sessionKey.split(':');

  // 新格式（4部分）：agent:<agentId>:<channel>:<peerId>
  // 这种格式以用户为维度，没有单独的sessionId
  if (parts.length === 4) {
    return null;
  }

  // 旧格式（3部分）：agent:<agentId>:<sessionId>
  // 这种格式第三部分就是sessionId
  if (parts.length === 3 && parts[0] === 'agent') {
    return parts[2];
  }

  // 其他未知格式
  return null;
}
```

### 2. 修改chat.send处理逻辑

**位置**: `server/index.js` 第1377-1420行

**修改内容**:

**修改前**:
```javascript
log.info(`RPC 请求 [${sid}] id=${reqId} method=${method}`);
const frame = { type: 'req', id: reqId, method, params };

if (method === 'chat.send') {
  setSessionProgress(session, {
    isBusy: true,
    sessionKey: params?.sessionKey || session.progress?.sessionKey || '',
    runId: '',
    state: 'sending',
  });
  // 诊断日志：查看chat.send时的用户信息
  log.info(`[chat.send] Session: ${sid.slice(0, 8)}..., User: ${session.username || 'N/A'} (ID: ${session.jwtUserId || 'N/A'}), SessionKey: ${params?.sessionKey || 'none'}, DeviceId: ${session.deviceKey?.deviceId?.slice(0, 12) || 'N/A'}...`);
}
```

**修改后**:
```javascript
log.info(`RPC 请求 [${sid}] id=${reqId} method=${method}`);

// 处理 chat.send 请求，添加用户识别 metadata
let finalParams = params;
if (method === 'chat.send') {
  setSessionProgress(session, {
    isBusy: true,
    sessionKey: params?.sessionKey || session.progress?.sessionKey || '',
    runId: '',
    state: 'sending',
  });

  // 添加用户识别信息到 metadata，帮助 OpenClaw 正确识别用户和会话
  // 这对于处理旧格式 sessionKey（如 agent:counselor-bot:0e9e0d9b）特别重要
  const sessionId = extractSessionId(params?.sessionKey);
  const userId = session.jwtUserId;
  const username = session.username;

  // 创建或扩展 metadata
  const metadata = {
    ...(params?.metadata || {}),
    // 如果有真实的用户ID，添加到 metadata
    ...(userId ? { userId: String(userId) } : {}),
    ...(username ? { username } : {}),
    // 如果是从旧格式 sessionKey 中提取的 sessionId，也添加进去
    ...(sessionId ? { originalSessionId: sessionId } : {}),
    // 添加当前WebSocket连接的sessionId，帮助追踪
    connectionSessionId: sid,
  };

  finalParams = {
    ...params,
    metadata,
  };

  // 诊断日志
  log.info(`[chat.send] Session: ${sid.slice(0, 8)}..., User: ${username || 'N/A'} (ID: ${userId || 'N/A'}), SessionKey: ${params?.sessionKey || 'none'}`);
  if (sessionId) {
    log.info(`[chat.send] Extracted sessionId from old format: ${sessionId}`);
  }
  if (metadata.userId || metadata.originalSessionId) {
    log.info(`[chat.send] Metadata added: userId=${metadata.userId || 'N/A'}, originalSessionId=${metadata.originalSessionId || 'N/A'}`);
  }
}

const frame = { type: 'req', id: reqId, method, params: finalParams };
```

## Metadata字段说明

添加到chat.send的metadata包含以下字段：

| 字段 | 类型 | 说明 | 示例 |
|------|------|------|------|
| `userId` | string | 当前登录用户的ID | "37" |
| `username` | string | 当前登录用户的用户名 | "isolation_user_1" |
| `originalSessionId` | string? | 从旧格式sessionKey中提取的sessionId | "0e9e0d9b" |
| `connectionSessionId` | string | 当前WebSocket连接的sessionId | "abc123..." |

## 工作原理

### 新格式SessionKey

**SessionKey**: `agent:counselor-bot:jwt:37`

**处理流程**:
1. `extractSessionId()` 返回 `null`（新格式没有单独sessionId）
2. 从session对象中获取 `userId=37`, `username=isolation_user_1`
3. 创建metadata:
   ```json
   {
     "userId": "37",
     "username": "isolation_user_1",
     "connectionSessionId": "abc123..."
   }
   ```
4. OpenClaw从sessionKey中正确解析peerId为37

### 旧格式SessionKey

**SessionKey**: `agent:counselor-bot:0e9e0d9b`

**处理流程**:
1. `extractSessionId()` 返回 `"0e9e0d9b"`
2. 从session对象中获取 `userId=21`, `username=user_with_old_session`
3. 创建metadata:
   ```json
   {
     "userId": "21",
     "username": "user_with_old_session",
     "originalSessionId": "0e9e0d9b",
     "connectionSessionId": "abc123..."
   }
   ```
4. OpenClaw从metadata中获取真实用户ID（21），而不是从sessionKey解析

## 优势

1. ✅ **自动处理**: 后端自动添加metadata，前端无需修改
2. ✅ **向后兼容**: metadata是可选字段，不影响现有功能
3. ✅ **完整信息**: 提供userId、username、sessionId等完整上下文
4. ✅ **支持新旧格式**: 无论哪种sessionKey格式都能正确识别用户
5. ✅ **详细日志**: 添加诊断日志，便于调试

## 测试验证

### 测试脚本

创建了测试脚本 `server/test-metadata-sessionid.js`

**运行测试**:
```bash
cd server
node test-metadata-sessionid.js
```

**测试内容**:
1. 测试新格式sessionKey（4部分）
2. 测试旧格式sessionKey（3部分）
3. 验证metadata是否正确添加

### 验证方法

**查看服务器日志**:

当发送chat.send请求时，应该看到以下日志：

**新格式**:
```
[chat.send] Session: abc123..., User: isolation_user_1 (ID: 37), SessionKey: agent:counselor-bot:jwt:37
[chat.send] Metadata added: userId=37, originalSessionId=N/A
```

**旧格式**:
```
[chat.send] Session: abc123..., User: user_with_old_session (ID: 21), SessionKey: agent:counselor-bot:0e9e0d9b
[chat.send] Extracted sessionId from old format: 0e9e0d9b
[chat.send] Metadata added: userId=21, originalSessionId=0e9e0d9b
```

## 与OpenClaw Agent建议的对应

**OpenClaw Agent的建议**:
```json
{
  "label": "openclaw-control-ui",
  "id": "openclaw-control-ui",
  "sessionId": "0e9e0d9b"
}
```

**我们的实现**:
```json
{
  "userId": "21",
  "username": "user_with_old_session",
  "originalSessionId": "0e9e0d9b",
  "connectionSessionId": "abc123..."
}
```

**差异说明**:
- OpenClaw建议的是在client metadata中添加（连接级别）
- 我们实现的是在chat.send的metadata中添加（请求级别）
- 我们的实现更灵活，因为：
  1. 每个请求都可以有不同的metadata
  2. 提供更完整的用户识别信息
  3. 同时支持新旧两种sessionKey格式

## 后续步骤

1. ✅ **代码修改完成**: 已添加extractSessionId函数和metadata处理
2. ⏳ **重启服务器**: 加载新代码
3. ⏳ **运行测试**: 执行test-metadata-sessionid.js
4. ⏳ **验证日志**: 检查服务器日志中的metadata信息
5. ⏳ **实际测试**: 在OpenClaw控制台验证记忆隔离

## 预期效果

实施后，应该能够解决：

1. **旧格式sessionKey的记忆混乱问题**
   - OpenClaw可以通过metadata中的userId正确识别用户
   - 不会将sessionId误认为userId

2. **新格式sessionKey的正常工作**
   - metadata提供额外的用户信息
   - 增强用户识别的可靠性

3. **调试便利性**
   - 详细的日志记录
   - 便于追踪问题

## 文件清单

- `server/index.js` - 修改的源代码
  - 添加了 `extractSessionId()` 函数
  - 修改了chat.send的处理逻辑

- `server/test-metadata-sessionid.js` - 测试脚本
  - 测试新格式sessionKey
  - 测试旧格式sessionKey
  - 验证metadata功能

- `server/METADATA-SESSIONID-IMPLEMENTATION.md` - 本文档
  - 实施说明
  - 技术细节
  - 测试方法

## 相关文档

- `server/SESSIONKEY-FIX-REPORT.md` - SessionKey格式修复报告
- `server/SESSIONID-METADATA-FEASIBILITY-ANALYSIS.md` - 可行性分析
