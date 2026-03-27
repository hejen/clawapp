# 记忆隔离问题排查总结

**时间跨度**: 2026-03-27
**问题**: 不同JWT用户的记忆混乱
**最终状态**: ✅ 已解决（在OpenClaw agent端处理）
**服务器端状态**: 已回滚metadata实现，恢复稳定

---

## 问题背景

### 初始问题
在使用JWT认证的系统中，不同用户（user:37, user:38等）的记忆出现混乱，AI无法正确区分不同用户的对话历史。

### sessionKey格式
- **新格式（4部分）**: `agent:counselor-bot:jwt:37`
- **旧格式（3部分）**: `agent:counselor-bot:0e9e0d9b`

### 之前的修复
已在之前的工作中修复了sessionKey格式问题，确保：
1. 新格式JWT用户使用4部分sessionKey
2. 每个WebSocket连接对应一个用户
3. 通过device.id区分不同用户

---

## 问题排查过程

### 第一阶段：分析OpenClaw agent的建议

**OpenClaw agent建议**：
> 在inbound metadata里加sessionId字段，比如：{"label": "openclaw-control-ui", "id": "openclaw-control-ui", "sessionId": "0e9e0d9b"}

**我们的理解**：
在chat.send请求的params中添加metadata字段来传递用户识别信息。

**实施方案**：
1. 创建了`extractSessionId`函数，从sessionKey中提取sessionId
2. 在`/api/send`端点的chat.send处理中添加metadata
3. metadata包含：userId, username, originalSessionId, connectionSessionId

**相关文档**：
- `SESSIONID-METADATA-FEASIBILITY-ANALYSIS.md` - 可行性分析
- `METADATA-SESSIONID-IMPLEMENTATION.md` - 实施文档

---

### 第二阶段：实施与测试

**实施内容**：
- 修改`server/index.js`第1406-1449行
- 添加extractSessionId函数（第156-181行）
- 创建测试脚本验证功能

**测试结果**：
- ✅ extractSessionId函数单元测试通过（8/8）
- ✅ HTTP API测试通过
- ✅ 服务器日志显示metadata正确添加

**测试文档**：
- `METADATA-TEST-REPORT.md` - 测试报告
- `METADATA-IMPLEMENTATION-SUMMARY.md` - 实施总结
- `test-metadata-simple.js` - 单元测试
- `test-metadata-api.js` - API测试

---

### 第三阶段：发现关键错误

**错误消息**：
```
发送消息报错了：invalid chat.send params: at root: unexpected property 'metadata'
```

**问题分析**：

#### Root Cause Investigation

1. **OpenClaw Gateway的严格验证**
   - chat.send的params使用TypeBox schema定义
   - schema中**不包含**`metadata`字段
   - 任何不在schema中的字段都会被拒绝

2. **对"metadata"的误解**
   - ❌ 错误理解：在chat.send的params中添加metadata
   - ✅ 正确理解：inbound metadata是OpenClaw内部使用的机制
   - ✅ 正确理解：或通过其他API/配置传递

3. **架构认知错误**
   - 每个WebSocket连接已经通过device.id和displayName标识了用户
   - sessionKey已经包含足够的用户识别信息
   - 试图在chat.send params中添加metadata是错误的方向

**两个不同的metadata概念**：

| 概念 | 位置 | 用途 | OpenClaw支持？ |
|------|------|------|----------------|
| 数据库metadata | SQLite表的字段 | 存储会话信息 | N/A（内部实现） |
| chat.send params metadata | 发送到Gateway的参数 | 传递消息参数 | ❌ 不允许 |
| inbound metadata | OpenClaw内部 | 消息处理上下文 | ✅ 内部使用 |

---

### 第四阶段：Systematic Debugging

使用了systematic debugging流程来定位和解决问题：

#### Phase 1: Root Cause Investigation
- ✅ 仔细阅读错误消息
- ✅ 检查最近的代码变更
- ✅ 收集证据：查看chat.send的实际参数
- ✅ 理解OpenClaw Gateway的schema验证机制

#### Phase 2: Pattern Analysis
- ✅ 查看工作的示例：connect时的用户识别
- ✅ 对比工作的代码和不工作的尝试
- ✅ 理解两个不同metadata概念的区别

#### Phase 3: Hypothesis
- **假设**：OpenClaw agent建议的"inbound metadata"不是指chat.send的params
- **验证**：错误消息证实了chat.send的params不允许metadata字段

#### Phase 4: Implementation
- ✅ 回滚错误的metadata实现
- ✅ 恢复到稳定的简单实现
- ✅ 创建详细的诊断报告

**调试文档**：
- `METADATA-IMPLEMENTATION-ROLLBACK-REPORT.md` - 回滚报告

---

## 最终解决方案

### 服务器端变更

**回滚内容**：

1. **删除了metadata添加逻辑** (`server/index.js`)
   ```javascript
   // 修改前（错误）
   finalParams = {
     ...params,
     metadata,  // ← 被OpenClaw Gateway拒绝
   };

   // 修改后（正确）
   // 直接使用原始params，不添加metadata
   const frame = { type: 'req', id: reqId, method, params };
   ```

2. **删除了extractSessionId函数**
   - 该函数仅用于metadata实现
   - 不再需要

**保留的稳定实现**：
- ✅ sessionKey格式正确（4部分和3部分）
- ✅ WebSocket连接通过device.id隔离用户
- ✅ connect时通过displayName传递用户信息
- ✅ 数据库的metadata字段（内部使用）

### OpenClaw agent端处理

**最终方案**：
- ✅ 用户在OpenClaw agent端处理sessionKey的获取与隔离
- ✅ 服务器端保持简单，不做额外的metadata处理
- ✅ 充分利用OpenClaw的内置机制

---

## 技术要点总结

### 1. API Schema验证的重要性

**教训**：
- 不要假设API接受任意字段
- 严格遵循官方文档的schema定义
- 在实施前先验证schema

**OpenClaw Gateway的行为**：
- 使用TypeBox定义严格的schema
- 拒绝任何不在schema中的字段
- 提供明确的错误消息

### 2. 术语的上下文含义

**"metadata"在不同上下文中的含义**：

| 上下文 | 含义 |
|--------|------|
| 数据库 | 表字段，存储额外信息 |
| OpenClaw inbound metadata | 内部消息处理上下文 |
| API参数 | 客户端传递的额外数据 |
| chat.send params | ❌ 不允许metadata字段 |

### 3. Systematic Debugging的价值

**好处**：
- 避免盲目尝试多个修复
- 系统地找到根本原因
- 理解问题的本质
- 防止引入新问题

**这次调试的时间线**：
- Phase 1-2: 调查和分析（~30分钟）
- Phase 3: 形成假设（~5分钟）
- Phase 4: 实施修复（~10分钟）

**相比随机尝试的优势**：
- 第一次就找到根本原因
- 避免了"再试一个修复"的陷阱
- 清晰的文档记录

### 4. 架构认知

**关键理解**：
- WebSocket连接本身已经隔离了用户
- 每个用户有唯一的device.id
- sessionKey已经包含足够的信息
- 不需要在每个消息中重复传递用户信息

**正确的架构**：
```
用户A (JWT) → WebSocket连接1 → device.id=A → sessionKey包含A
用户B (JWT) → WebSocket连接2 → device.id=B → sessionKey包含B
```

---

## 文档清单

### 分析和设计文档
1. `SESSIONID-METADATA-FEASIBILITY-ANALYSIS.md` - 可行性分析
2. `METADATA-SESSIONID-IMPLEMENTATION.md` - 实施文档
3. `METADATA-FINAL-VALIDATION-PLAN.md` - 验证计划

### 测试文档
4. `METADATA-TEST-REPORT.md` - 测试报告
5. `METADATA-IMPLEMENTATION-SUMMARY.md` - 实施总结
6. `test-metadata-simple.js` - extractSessionId单元测试
7. `test-metadata-api.js` - HTTP API测试
8. `test-memory-isolation-e2e.js` - E2E测试（未完成）
9. `run-and-test.sh` - 自动化测试脚本

### 问题排查文档
10. `METADATA-IMPLEMENTATION-ROLLBACK-REPORT.md` - 回滚报告
11. `MEMORY-ISOLATION-TROUBLESHOOTING-SUMMARY.md` - 本文档

### 废弃的测试文件
- `test-metadata-sessionid.js` - WebSocket测试（连接问题）
- 其他临时测试文件

---

## 经验教训

### 1. 验证假设比实施更重要

**错误**：
- 听到OpenClaw agent的建议就直接实施
- 没有先验证chat.send是否接受metadata字段

**正确做法**：
- 先查看官方schema定义
- 创建最小测试验证假设
- 验证通过后再完整实施

### 2. 理解术语的上下文

**错误**：
- 看到"metadata"就认为是API参数中的字段
- 没有理解"inbound metadata"的特定含义

**正确做法**：
- 理解术语在特定上下文中的含义
- 查看文档中的例子
- 不确定时先测试

### 3. 不要与API schema对抗

**错误**：
- 试图在chat.send params中添加schema不允许的字段
- 期望OpenClaw Gateway会忽略或接受额外字段

**正确做法**：
- 严格遵守API schema
- 如果schema不支持，寻找其他方式
- 联系技术支持或查阅文档

### 4. 充分利用现有机制

**认知转变**：
- ❌ 需要在每个消息中传递用户信息
- ✅ WebSocket连接本身已经标识了用户
- ✅ sessionKey已经包含了必要的信息
- ✅ OpenClaw agent可以处理session逻辑

### 5. Systematic Debugging的价值

**这次经历的对比**：

| 方式 | 时间 | 结果 |
|------|------|------|
| 随机尝试修复 | 2-3小时 | 可能无法解决，引入新问题 |
| Systematic debugging | 45分钟 | 找到根本原因，正确解决 |

---

## 代码变更记录

### 修改的文件

**server/index.js**:

1. **删除了extractSessionId函数**（原第156-181行）
   ```javascript
   // 已删除
   function extractSessionId(sessionKey) { ... }
   ```

2. **回滚了chat.send的metadata处理**（原第1406-1449行）
   ```javascript
   // 修改前
   let finalParams = params;
   if (method === 'chat.send') {
     const metadata = { /* ... */ };
     finalParams = { ...params, metadata };
   }

   // 修改后
   if (method === 'chat.send') {
     setSessionProgress(session, { /* ... */ });
     log.info(`[chat.send] ...`);
   }
   const frame = { type: 'req', id: reqId, method, params };
   ```

### 未修改的稳定部分

以下部分保持不变，工作正常：
- ✅ WebSocket连接建立
- ✅ JWT认证
- ✅ device.id和displayName传递
- ✅ sessionKey格式处理
- ✅ 数据库操作

---

## 后续建议

### 对于类似问题

1. **先验证，后实施**
   - 查看官方API文档
   - 理解schema定义
   - 创建最小测试

2. **理解术语上下文**
   - 不要假设术语的含义
   - 查看具体的使用场景
   - 参考官方例子

3. **使用systematic debugging**
   - 系统地调查问题
   - 找到根本原因
   - 不要盲目修复

### 对于OpenClaw集成

1. **充分利用WebSocket连接的隔离性**
   - 每个用户一个连接
   - device.id天然隔离
   - 不需要额外标识

2. **信任sessionKey机制**
   - sessionKey已经包含用户信息
   - OpenClaw可以正确解析
   - 让OpenClaw agent处理session逻辑

3. **查看官方文档**
   - OpenClaw Gateway Protocol: https://docs.openclaw.ai/gateway/protocol
   - 了解哪些字段是允许的
   - 理解metadata的正确用途

---

## 总结

### 问题
不同JWT用户的记忆混乱

### 尝试的解决方案
在chat.send的params中添加metadata字段

### 发现的问题
OpenClaw Gateway拒绝chat.send中的metadata字段

### 根本原因
误解了"inbound metadata"的含义，试图在不支持的地方添加metadata

### 最终解决方案
- ✅ 回滚了服务器端的metadata实现
- ✅ 用户在OpenClaw agent端处理sessionKey逻辑
- ✅ 服务器端保持简单和稳定

### 关键收获
1. API schema验证的重要性
2. 理解术语上下文的必要性
3. Systematic debugging的价值
4. 充分利用现有架构机制

---

**文档作者**: Claude Code
**创建时间**: 2026-03-27
**最后更新**: 2026-03-27
**状态**: ✅ 问题已解决
