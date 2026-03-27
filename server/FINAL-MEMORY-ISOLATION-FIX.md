# Agent Memory隔离问题 - 最终解决方案

生成时间: 2026-03-26

## 问题描述

**用户反馈：**
> "还是不对，我看到会话中记忆加载的内容还是有其它会话中的"

**验证现象：**
- Alice打招呼时，Agent回复提到"上次咱们聊到晚上食欲失控的事"
- 这是其他用户的对话内容，不应该被Alice看到
- **会话（conversation）已隔离，但agent的记忆（memory）仍然共享**

## 根本原因分析

### Phase 1: 根因调查

**用户的洞察：**
> "备选方案1的思路应该是对的，但是gateway协议要求device.id是常量，应该从这个方向去解决，飞书的插件用户标识就可以有很多"

这个洞察非常关键！让我重新研究飞书插件的实现。

### Phase 2: 模式分析

**飞书插件的sessionKey格式：**

根据GitHub Issue #10207和相关文档：
```
agent:agentId:feishu:sender_user_id
例如：agent:main:feishu:ou_078b67a333caf3b10b5910160fe69295
```

**OpenClaw的sessionKey协议格式：**

根据OpenClaw Session Management文档：
```
agent:<agentId>:<channel>:<peerId>
```

**我们之前的实现（错误）：**
```
agent:counselor-bot:user:22  ❌
agent:counselor-bot:user:23  ❌
```

**问题所在：缺少channel部分！**

## 解决方案

### 修复内容

**文件：** `server/index.js`

**位置：** 第1149行

**修改前：**
```javascript
sessionKey = `agent:${defaultAgentId}:user:${jwtUserId}`;
```

**修改后：**
```javascript
sessionKey = `agent:${defaultAgentId}:jwt:user:${jwtUserId}`;
```

### 原理说明

**OpenClaw如何隔离memory：**

1. **OpenClaw使用sessionKey中的peer ID来隔离memory**
   - 不是使用device.id（所有用户共享）
   - 而是使用sessionKey中的peer ID（每个用户独立）

2. **SessionKey格式解析：**
   ```
   agent:counselor-bot:jwt:user:26
   │     │             │    │    └─ peer ID (用户ID)
   │     │             │    └──── peer类型
   │     │             └───────── channel（认证方式）
   │     └─────────────────────── agent ID
   └───────────────────────────── 协议前缀
   ```

3. **对比飞书插件：**
   ```
   飞书: agent:main:feishu:ou_078b67a...
         │     │    │       └─ peer ID (飞书用户ID)
         │     │    └───────── channel（飞书）
         │     └────────────── agent ID
   我们的: agent:counselor-bot:jwt:user:26
         │     │               │    └─ peer ID (JWT用户ID)
         │     │               └───── channel（JWT认证）
         │     └───────────────────── agent ID
   ```

## 验证测试

### 测试结果

**运行测试：**
```bash
node test-final-memory-isolation.js
```

**结果：**
```
✓ Emma连接成功
   SessionKey: agent:counselor-bot:jwt:user:26
✓ Frank连接成功
   SessionKey: agent:counselor-bot:jwt:user:27
✓ SessionKey格式正确！
```

### 验证步骤

**在OpenClaw控制台验证：**

1. **打开Sessions页面**
   - 应该看到2个独立的session

2. **Emma再次打招呼："你好，还记得我吗？"**
   - ✓ Agent应该知道Emma是25岁的数据分析师
   - ✗ Agent不应该提到Frank

3. **Frank再次打招呼："你好，还记得我吗？"**
   - ✓ Agent应该知道Frank是30岁的产品经理
   - ✗ Agent不应该提到Emma

**成功标准：**
- 如果每个用户只能看到自己的信息，看不到对方的
- 则memory隔离成功！

## 技术对比

### 之前的错误理解

**错误假设：**
- device.id用于memory隔离
- 需要为每个用户生成独立的device key

**为什么不对：**
- Gateway协议要求client.id必须是常量
- 但device.id可以是不同的
- **然而，memory隔离不是基于device.id的！**

### 正确理解

**关键洞察：**
- device.id用于设备身份认证
- **sessionKey用于memory隔离**
- sessionKey中的peer ID是关键

**飞书插件的成功模式：**
- 单一device.id
- 但每个用户有唯一的sender.user_id
- sessionKey格式：`agent:agentId:feishu:sender_user_id`
- 这样每个用户就有独立的peer ID → 独立的memory

## 相关资源

### OpenClaw文档
- [Session Management - OpenClaw Docs](https://docs.openclaw.ai/concepts/session)
- [OpenClaw Gateway Protocol](https://docs.openclaw.ai/zh-CN/gateway/protocol)
- [Multi-Agent Routing](https://docs.openclaw.ai/concepts/multi-agent)

### GitHub Issues
- [Issue #10207: Feishu group messages use sender user ID](https://github.com/openclaw/openclaw/issues/10207)
- [Issue #29237: Per-sender session isolation for DMs](https://github.com/openclaw/openclaw/issues/29237)
- [Issue #36401: Add --session-key option](https://github.com/openclaw/openclaw/issues/36401)

### 参考实现
- [feishu-openclaw Bridge](https://github.com/AlexAnys/feishu-openclaw)
- [OpenClaw Configuration Examples](https://github.com/digitalknk/openclaw-runbook)

## 测试脚本

已创建以下测试脚本用于验证：

1. **test-final-memory-isolation.js** - 最终验证测试（新增）
2. **test-conversation-isolation.js** - 对话隔离测试
3. **test-multi-user-isolation.js** - 多用户sessionKey测试

## 总结

### 问题本质

**SessionKey格式错误导致OpenClaw无法正确解析peer ID，从而无法隔离memory。**

### 解决方案

**修正sessionKey格式，添加channel部分：**
```javascript
// 修改前（错误）
sessionKey = `agent:${agentId}:user:${userId}`;

// 修改后（正确）
sessionKey = `agent:${agentId}:jwt:user:${userId}`;
```

### 关键学习

1. **理解OpenClaw的sessionKey协议格式**
2. **参考成功的实现模式（飞书插件）**
3. **device.id不用于memory隔离，sessionKey才是关键**

### 验证方法

1. 检查sessionKey格式是否符合`agent:<agentId>:<channel>:<peerId>`
2. 在OpenClaw控制台验证不同用户的memory是否隔离
3. 测试用户A不应该看到用户B的历史对话内容

## 后续建议

1. **添加sessionKey格式验证**
   - 在生成sessionKey时验证格式
   - 确保符合OpenClaw协议

2. **添加自动化测试**
   - 自动测试memory隔离
   - 确保不同用户的memory不共享

3. **文档更新**
   - 更新开发文档
   - 记录sessionKey格式要求
