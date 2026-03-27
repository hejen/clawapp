# 会话删除限制说明

**文档日期**: 2026-03-27
**相关问题**: OpenClaw Gateway缺少会话删除API

---

## 🎯 问题描述

当用户在我们的应用中删除会话时，该会话会从我们的SQLite数据库中删除，但**OpenClaw agent中的会话仍然保留**。

---

## 🔍 根本原因

### OpenClaw Gateway Protocol限制

**现状**（截至2026年3月）：

1. **没有会话删除API**
   - OpenClaw Gateway Protocol定义了以下方法：
     - `chat.send` - 发送消息
     - `sessions.create` - 创建会话
     - `sessions.list` - 列出会话
   - **但缺少 `sessions.delete` 或类似的方法**

2. **社区需求**
   - GitHub issue #30622: 请求重命名/删除会话功能（未解决）
   - GitHub issue #35682: "没有直接的方法来删除单个会话"

3. **Slash命令问题**
   - `/new` 和 `/reset` 命令理论上可以重置会话
   - GitHub issues #4446, #2030显示这些命令在web UI中有问题
   - 2026.3.12的迁移影响了.reset文件
   - **使用slash命令可能导致状态不一致，不推荐**

---

## 📊 当前实现

### DELETE /api/sessions/:id

**位置**: `server/index.js` 第1560-1595行

**实现逻辑**：
```javascript
app.delete('/api/sessions/:id', async (req, res) => {
  // 1. 验证JWT用户
  // 2. 从我们的SQLite数据库中删除会话
  // 3. 记录删除日志

  // 注意：OpenClaw中的会话不会被删除（没有API）
  log.warn('Session remains in OpenClaw (no deletion API available)');
});
```

**删除后的状态**：
- ✅ 会话从我们的数据库中删除
- ✅ 用户在应用中看不到该会话
- ⚠️ 会话仍在OpenClaw agent的存储中
- ⚠️ 会话在OpenClaw中的对话历史保留

---

## 🤔 影响分析

### 对用户的影响

**正面影响**：
- 用户可以清理不需要的会话
- 应用界面保持整洁
- 不影响活跃会话的使用

**负面影响**：
- OpenClaw中会积累已删除的会话
- 可能占用OpenClaw的存储空间
- 如果用户直接访问OpenClaw，可能看到旧会话

### 对系统的影响

**存储**：
- 我们的数据库：及时清理 ✅
- OpenClaw存储：会积累会话 ⚠️

**性能**：
- OpenClaw的性能可能受大量会话影响（长期）
- 需要监控会话增长

**一致性**：
- 我们的应用与OpenClaw状态不一致
- 但这是API限制导致的，无法避免

---

## 💡 解决方案

### 方案1: 接受限制（当前方案）✅

**实施**：
- 保持当前实现
- 添加清晰注释说明限制
- 记录删除日志便于监控
- 创建文档说明情况

**优点**：
- 实现简单，安全
- 不会导致状态不一致
- 等待OpenClaw添加官方API

**缺点**：
- OpenClaw中会积累会话
- 需要长期监控

### 方案2: 使用Slash命令（不推荐）❌

**实施**：
```javascript
// 通过chat.send发送/new命令
session.gatewayWs.send(JSON.stringify({
  type: 'req',
  method: 'chat.send',
  params: {
    sessionKey: session.gatewaySessionId,
    content: '/new'  // 或 /reset
  }
}));
```

**问题**：
- 效果不确定（slash命令有已知bug）
- 可能导致状态不一致
- 需要异步处理，复杂度高
- **风险大于收益**

### 方案3: 定期清理（未来方案）⏳

**前提**：OpenClaw添加会话管理API

**实施**：
- 调用OpenClaw API删除会话
- 同步我们数据库和OpenClaw的状态

**时间表**：
- 等待OpenClaw官方支持
- 关注GitHub issues更新
- 一旦API可用，立即升级

---

## 📈 监控建议

### 1. 记录删除操作

**当前实现已包含**：
```javascript
log.info(`Session deleted from database: id=${id}, userId=${userId}`);
log.warn(`Session remains in OpenClaw (no deletion API available): id=${id}`);
```

**用途**：
- 统计删除的会话数量
- 分析用户删除模式
- 评估OpenClaw会话积累速度

### 2. 监控OpenClaw会话增长

**建议指标**：
- 每日删除的会话数
- OpenClaw中的总会话数（如果可获取）
- 会话增长趋势

**监控方法**：
```sql
-- 统计我们的数据库中的会话
SELECT COUNT(*) FROM sessions WHERE created_at >= date('now', '-7 days');

-- 统计已删除的会话数（通过日志分析）
grep "Session deleted from database" server.log | wc -l
```

### 3. 告警阈值

**建议设置**：
- 每月删除会话数 > 1000：查看是否正常
- OpenClaw会话数 > 10000：考虑手动清理

---

## 🧹 清理策略

### 临时清理（如果需要）

**方法1: 通过OpenClaw CLI**
```bash
# 如果OpenClaw提供了CLI工具
openclaw-cli sessions list
openclaw-cli sessions delete <session-id>
```

**方法2: 直接访问数据库**（风险高，不推荐）
```bash
# 仅在紧急情况下使用
# 可能导致OpenClaw不稳定
# 需要停止OpenClaw服务
```

**方法3: 创建新的Agent**
- 定期创建新的agent ID
- 旧agent的会话自动废弃
- 成本较高，但最干净

### 自动清理（未来）

等待OpenClaw API后，可以实现：
```javascript
// 定期任务
async function cleanupOldOpenClawSessions() {
  // 1. 获取我们数据库中不存在的会话
  // 2. 调用OpenClaw API删除它们
  // 3. 记录清理结果
}
```

---

## 🔗 相关资源

### OpenClaw文档
- [OpenClaw Gateway Protocol](https://docs.openclaw.ai/gateway/protocol)
- [Session Management](https://docs.openclaw.ai/gateway/sessions)

### GitHub Issues
- [[#30622] Request for rename/delete session features](https://github.com/OpenClaw/OpenClaw/issues/30622)
- [[#35682] No direct way to delete individual sessions](https://github.com/OpenClaw/OpenClaw/issues/35682)
- [[#4446] Slash commands not working in web UI](https://github.com/OpenClaw/OpenClaw/issues/4446)
- [[#2030] /new command issues](https://github.com/OpenClaw/OpenClaw/issues/2030)

### 内部文档
- [Agent限制功能实施](AGENT-RESTRICTIONS-IMPLEMENTATION.md)
- [SessionKey修复报告](SESSIONKEY-FIX-REPORT.md)
- [记忆隔离问题排查](MEMORY-ISOLATION-TROUBLESHOOTING-SUMMARY.md)

---

## 📋 实施检查清单

- [x] 修改DELETE /api/sessions/:id实现
- [x] 添加注释说明OpenClaw会话保留
- [x] 增强日志记录
- [x] 创建限制说明文档
- [ ] 定期检查GitHub issues更新
- [ ] 监控会话删除数量
- [ ] 评估是否需要手动清理
- [ ] 等待OpenClaw API支持

---

## 📝 更新日志

### 2026-03-27
- 初始版本
- 说明会话删除限制
- 记录OpenClaw API缺失问题
- 提供监控和清理建议

---

**文档维护者**: Claude Code
**最后更新**: 2026-03-27
**状态**: ✅ 当前实施方案
**待办**: 等待OpenClaw添加会话删除API
