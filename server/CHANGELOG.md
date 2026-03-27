# 变更日志 (CHANGELOG)

## [未发布] - 2026-03-27

### 🔄 回滚 (Revert)

**回滚: metadata实现**

**原因**: OpenClaw Gateway拒绝chat.send请求中的metadata字段

**错误消息**:
```
invalid chat.send params: at root: unexpected property 'metadata'
```

**变更内容**:

1. **删除了extractSessionId函数**
   - 位置: `server/index.js` 第156-181行
   - 原因: 仅用于metadata实现，不再需要

2. **简化了chat.send处理逻辑**
   - 位置: `server/index.js` 第1406-1449行
   - 变更: 移除了metadata添加逻辑
   - 恢复: 直接使用原始params，不修改

3. **删除了相关测试文件**（保留作为历史记录）
   - `test-metadata-simple.js`
   - `test-metadata-api.js`
   - `test-metadata-sessionid.js`
   - `run-and-test.sh`

### 📝 新增文档

1. `MEMORY-ISOLATION-TROUBLESHOOTING-SUMMARY.md` - 完整的问题排查总结
2. `METADATA-IMPLEMENTATION-ROLLBACK-REPORT.md` - 回滚报告

### 📚 已有的文档（保留）

- `SESSIONID-METADATA-FEASIBILITY-ANALYSIS.md` - 可行性分析
- `METADATA-SESSIONID-IMPLEMENTATION.md` - 实施文档
- `METADATA-TEST-REPORT.md` - 测试报告
- `METADATA-IMPLEMENTATION-SUMMARY.md` - 实施总结
- `METADATA-FINAL-VALIDATION-PLAN.md` - 验证计划

### ✅ 修复的问题

- **聊天功能恢复**: 消除"unexpected property 'metadata'"错误
- **服务器稳定性**: 恢复到稳定的简单实现
- **API兼容性**: 遵守OpenClaw Gateway的schema定义

### 🔍 根本原因

**问题**: 尝试在chat.send的params中添加metadata字段

**根本原因**:
- OpenClaw Gateway使用TypeBox进行严格的schema验证
- chat.send的params schema中不包含metadata字段
- 误解了OpenClaw agent建议的"inbound metadata"的含义

**解决方案**:
- 回滚metadata实现
- 让OpenClaw agent端处理sessionKey逻辑
- 服务器端保持简单

### 💡 经验教训

1. **验证假设**: 在实施前先验证API schema
2. **理解上下文**: 术语在不同上下文有不同含义
3. **不要对抗schema**: 严格遵守API定义
4. **Systematic debugging**: 系统化地找到根本原因

---

## [之前的版本] - 2026-03-20 及更早

### ✨ 新增

- JWT认证支持
- sessionKey格式修复（4部分格式）
- 用户设备key自动迁移
- WebSocket连接隔离

### 🔧 修复

- 旧格式sessionKey的处理
- 用户识别问题
- 设备key自动生成

---

**变更记录格式**:
- 🔄 回滚 (Revert)
- ✨ 新增 (Added)
- 🔧 修复 (Fixed)
- 📝 文档 (Documentation)
- ❌ 删除 (Removed)
- ⚠️ 弃用 (Deprecated)
- 🔒 安全 (Security)
- ✅ 测试 (Tests)

**相关链接**:
- [完整问题排查总结](MEMORY-ISOLATION-TROUBLESHOOTING-SUMMARY.md)
- [回滚详细报告](METADATA-IMPLEMENTATION-ROLLBACK-REPORT.md)
