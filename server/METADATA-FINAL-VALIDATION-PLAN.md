# Metadata功能最终验证计划

生成时间: 2026-03-27

## 目标

在实际OpenClaw环境中验证metadata功能是否解决了记忆混乱问题。

## 前置条件

1. ✅ 代码修改已完成
2. ✅ 单元测试已通过
3. ⏳ OpenClaw Gateway正在运行
4. ⏳ 服务器已启动并连接到Gateway

## 验证场景

### 场景1: 新格式用户记忆隔离

**目的**: 验证不同用户（新格式sessionKey）的记忆是否隔离

**步骤**:
1. 用户A (ID: 37) 发送消息："我叫Alice，最喜欢的颜色是蓝色"
2. 用户B (ID: 38) 发送消息："我叫Bob，最喜欢的颜色是红色"
3. 用户A询问："我叫什么名字？我最喜欢什么颜色？"
4. 用户B询问："我叫什么名字？我最喜欢什么颜色？"

**期望结果**:
- 用户A的AI回答："你叫Alice，最喜欢蓝色"
- 用户B的AI回答："你叫Bob，最喜欢红色"

**SessionKey格式**:
- 用户A: `agent:counselor-bot:jwt:37`
- 用户B: `agent:counselor-bot:jwt:38`

**Metadata**:
```json
// 用户A
{
  "userId": "37",
  "username": "isolation_user_1",
  "connectionSessionId": "..."
}

// 用户B
{
  "userId": "38",
  "username": "isolation_user_2",
  "connectionSessionId": "..."
}
```

---

### 场景2: 旧格式用户记忆隔离

**目的**: 验证使用旧格式sessionKey时，记忆是否正确隔离

**背景**: 用户21在数据库中有多个旧格式的sessions:
- `agent:counselor-bot:0e9e0d9b`
- `agent:counselor-bot:913bb057`
- `agent:counselor-bot:2763f873`

**步骤**:
1. 使用sessionKey `agent:counselor-bot:0e9e0d9b` 发送消息："我在第一个会话中"
2. 使用sessionKey `agent:counselor-bot:913bb057` 发送消息："我在第二个会话中"
3. 切换回第一个sessionKey，询问："我在哪个会话？"
4. 切换到第二个sessionKey，询问："我在哪个会话？"

**期望结果**:
- 第一个会话的AI回答："你在第一个会话中"
- 第二个会话的AI回答："你在第二个会话中"

**关键点**: 虽然sessionKey中包含的是sessionId（0e9e0d9b, 913bb057），但metadata中的userId都是21，OpenClaw应该能够正确识别这是同一个用户的不同会话。

**Metadata**:
```json
// 第一个会话
{
  "userId": "21",
  "username": "user_with_old_session",
  "originalSessionId": "0e9e0d9b",
  "connectionSessionId": "..."
}

// 第二个会话
{
  "userId": "21",
  "username": "user_with_old_session",
  "originalSessionId": "913bb057",
  "connectionSessionId": "..."
}
```

---

### 场景3: 新旧格式混合测试

**目的**: 验证新格式和旧格式用户之间的记忆隔离

**步骤**:
1. 新格式用户 (ID: 37) 发送消息："我使用新格式"
2. 旧格式用户 (ID: 21, session: 0e9e0d9b) 发送消息："我使用旧格式"
3. 新格式用户询问："我使用什么格式？"
4. 旧格式用户询问："我使用什么格式？"

**期望结果**:
- 新格式用户："你使用新格式"
- 旧格式用户："你使用旧格式"

---

## 手动验证步骤

### 方法1: 使用H5界面测试

1. **启动服务器**
   ```bash
   cd server
   npm start
   ```

2. **打开H5界面**
   - 浏览器访问: `http://localhost:3210`
   - 使用不同账号登录（用户37、38、21等）

3. **发送测试消息**
   - 在不同账号的对话中发送上述场景的消息
   - 观察AI是否能正确记住每个用户的信息

4. **检查服务器日志**
   ```bash
   # 查看metadata是否正确添加
   grep "Metadata added" logs/server.log
   ```

### 方法2: 使用API测试脚本

创建测试脚本 `test-memory-isolation-real.js`:

```javascript
import http from 'http';
import jwt from 'jsonwebtoken';

const SERVER_HOST = 'localhost';
const SERVER_PORT = 3210;
const JWT_SECRET = 'FGRwZZWx7KciUPYWEGRCyAUOdRjwDrp7y71s0gJVQso=';

async function chatSend(userId, username, sessionKey, message) {
  const token = jwt.sign(
    { userId, username },
    JWT_SECRET,
    { expiresIn: '24h', issuer: 'openclaw-chat' }
  );

  // 1. 连接WebSocket
  // 2. 发送chat.send请求
  // 3. 等待响应
  // 4. 返回AI的回复
}

async function testScenario1() {
  console.log('=== 场景1: 新格式用户记忆隔离 ===\n');

  // 用户A发送个人信息
  await chatSend(37, 'user_37', 'agent:counselor-bot:jwt:37',
    '我叫Alice，最喜欢的颜色是蓝色');

  // 用户B发送个人信息
  await chatSend(38, 'user_38', 'agent:counselor-bot:jwt:38',
    '我叫Bob，最喜欢的颜色是红色');

  // 等待AI处理

  // 用户A询问
  const replyA = await chatSend(37, 'user_37', 'agent:counselor-bot:jwt:37',
    '我叫什么名字？我最喜欢什么颜色？');

  console.log('用户A的AI回复:', replyA);

  // 用户B询问
  const replyB = await chatSend(38, 'user_38', 'agent:counselor-bot:jwt:38',
    '我叫什么名字？我最喜欢什么颜色？');

  console.log('用户B的AI回复:', replyB);

  // 验证
  if (replyA.includes('Alice') && replyA.includes('蓝色') &&
      replyB.includes('Bob') && replyB.includes('红色')) {
    console.log('\n✅ 场景1通过：记忆正确隔离！');
  } else {
    console.log('\n❌ 场景1失败：记忆未正确隔离');
  }
}

// 运行测试
testScenario1();
```

---

## 验证清单

### 代码层面
- [x] extractSessionId函数实现正确
- [x] metadata添加逻辑实现正确
- [x] 单元测试通过
- [x] API测试通过

### 运行时层面
- [ ] 服务器成功启动
- [ ] 成功连接到OpenClaw Gateway
- [ ] chat.send请求成功发送
- [ ] metadata正确添加到请求中

### 功能层面
- [ ] 新格式用户记忆隔离（场景1）
- [ ] 旧格式会话记忆隔离（场景2）
- [ ] 新旧格式用户互不干扰（场景3）

### OpenClaw层面
- [ ] OpenClaw接收到metadata
- [ ] OpenClaw使用userId识别用户
- [ ] OpenClaw正确隔离记忆
- [ ] 不同用户/会话的记忆独立

---

## 故障排查

### 如果记忆仍然混乱

1. **检查metadata是否发送**
   ```bash
   # 查看服务器日志
   grep "Metadata added" logs/server.log
   ```

2. **检查OpenClaw是否收到metadata**
   - 可能需要在OpenClaw控制台查看inbound消息
   - 确认metadata字段是否包含在chat.send请求中

3. **检查OpenClaw是否使用metadata**
   - 查看OpenClaw文档，确认如何使用metadata中的userId
   - 可能需要与OpenClaw技术支持沟通

4. **检查sessionKey格式**
   ```bash
   # 查看实际的sessionKey
   grep "SessionKey:" logs/server.log
   ```

### 如果连接失败

1. **检查Gateway连接**
   ```bash
   # 查看Gateway连接日志
   grep "Gateway" logs/server.log
   ```

2. **检查端口占用**
   ```bash
   netstat -ano | grep :3210
   ```

3. **检查认证**
   ```bash
   # 查看认证日志
   grep "auth\|token" logs/server.log
   ```

---

## 成功标准

### 基本成功
- ✅ metadata正确添加到所有chat.send请求
- ✅ 日志显示userId和sessionId信息

### 完全成功
- ✅ OpenClaw确认收到metadata
- ✅ 新格式用户记忆完全隔离
- ✅ 旧格式会话记忆正确处理
- ✅ 没有记忆混乱的情况发生

---

## 时间线

- 2026-03-27 02:29 - metadata功能实施完成
- 2026-03-27 02:35 - 单元测试和API测试通过
- 待定 - 实际OpenClaw环境验证

---

## 相关文档

- 实施文档: `METADATA-SESSIONID-IMPLEMENTATION.md`
- 测试报告: `METADATA-TEST-REPORT.md`
- 可行性分析: `SESSIONID-METADATA-FEASIBILITY-ANALYSIS.md`
- SessionKey修复: `SESSIONKEY-FIX-REPORT.md`
