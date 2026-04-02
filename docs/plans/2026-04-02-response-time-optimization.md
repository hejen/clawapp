# 响应时间优化 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 Agent 响应时间控制在 10s 以内，长对话不退化

**Architecture:** 前端限制历史加载量减少渲染开销；后端自动检测对话轮数并在超阈值时发送 `/compact` 命令给 Gateway 压缩上下文。

**Tech Stack:** Node.js (Express + WebSocket), Vite, vanilla JS

---

### Task 1: 限制前端历史加载量（B1）

**Files:**
- Modify: `h5/src/chat-ui.js:1401`

**Step 1: 修改 loadHistory 中的 chatHistory limit**

将 `chatHistory` 请求从 200 条改为 50 条。200 条历史仅用于本地显示，不影响 Gateway 侧的上下文管理。

```javascript
// h5/src/chat-ui.js line 1401
// 改前:
wsClient.chatHistory(_sessionKey, 200),
// 改后:
wsClient.chatHistory(_sessionKey, 50),
```

**Step 2: 验证**

Run: 访问 http://localhost:3210，登录后查看浏览器 Network 面板，确认 `/api/send` 请求中 `chatHistory` 的 `limit` 参数为 50。

**Step 3: Commit**

```bash
git add h5/src/chat-ui.js
git commit -m "perf: reduce chatHistory load limit from 200 to 50"
```

---

### Task 2: 后端自动 Compact 机制（A2）

**Files:**
- Modify: `server/index.js:1404-1429`（chat.send 转发逻辑）

**Step 1: 添加消息轮数计数器和配置**

在 `server/index.js` 的常量区域（约 line 135-142 附近）添加：

```javascript
// 自动 compact 配置
const AUTO_COMPACT_ROUNDS = parseInt(process.env.AUTO_COMPACT_ROUNDS, 10) || 10
const _sessionMsgCount = new Map() // sessionId → user message count
```

**Step 2: 在 chat.send 转发逻辑中添加计数和自动 compact**

在 `server/index.js` 的 chat.send 处理块（约 line 1404-1417）中：

```javascript
if (method === 'chat.send') {
  setSessionProgress(session, {
    isBusy: true,
    sessionKey: params?.sessionKey || session.progress?.sessionKey || '',
    runId: '',
    state: 'sending',
  })

  // 自动 compact：统计用户消息轮数，超过阈值时压缩上下文
  const sKey = params?.sessionKey
  if (sKey) {
    const count = (_sessionMsgCount.get(sKey) || 0) + 1
    _sessionMsgCount.set(sKey, count)
    if (count >= AUTO_COMPACT_ROUNDS) {
      _sessionMsgCount.set(sKey, 0)
      log.info(`[auto-compact] Session ${sKey} reached ${count} messages, sending /compact`)
      // 发送 /compact 命令（异步，不阻塞用户消息）
      const compactFrame = {
        type: 'req',
        id: `auto-compact-${randomUUID()}`,
        method: 'chat.send',
        params: {
          sessionKey: sKey,
          message: '/compact',
          deliver: false,
          idempotencyKey: randomUUID(),
        }
      }
      if (session.upstream?.readyState === WebSocket.OPEN) {
        session.upstream.send(JSON.stringify(compactFrame))
      }
    }
  }
}
```

**Step 3: 在会话清理时清除计数**

在 `cleanupSession` 函数中（约 line 346-367），添加清除计数逻辑。找到 `sessions.delete(sid)` 所在位置，在其之前添加：

```javascript
_sessionMsgCount.delete(sid)
```

同时遍历 `_sessionMsgCount` 找到其他使用同一 upstream session 的 key 并清理（如果存在 session key 到 upstream sid 的映射）。

**Step 4: 验证**

1. 设置环境变量测试：`AUTO_COMPACT_ROUNDS=3` 重启后端
2. 发送 3 条消息，观察后端日志出现 `[auto-compact]`
3. 恢复默认值：移除环境变量或设为 10

**Step 5: Commit**

```bash
git add server/index.js
git commit -m "feat: auto-compact sessions after N messages to reduce context size"
```

---

### Task 3: 优化流式渲染节流参数（A3 微调）

**Files:**
- Modify: `h5/src/chat-ui.js:66`

**Step 1: 降低渲染节流间隔**

当前 `RENDER_THROTTLE` 为 30ms，已使用 `requestAnimationFrame`。将节流间隔提高到 50ms 减少 DOM 操作频率（每秒最多 20 次渲染，人眼无法区分差异）。

```javascript
// h5/src/chat-ui.js line 66
// 改前:
const RENDER_THROTTLE = 30
// 改后:
const RENDER_THROTTLE = 50
```

**Step 2: Commit**

```bash
git add h5/src/chat-ui.js
git commit -m "perf: increase render throttle from 30ms to 50ms"
```

---

### Task 4: 推送代码并验证

**Step 1: Push**

```bash
git push
```

**Step 2: 验证清单**

- [ ] 新会话首条消息：typing indicator 立即显示
- [ ] 发送 10 条消息后，后端日志出现 `[auto-compact]`
- [ ] 长对话后响应时间不显著退化
- [ ] 流式渲染无明显卡顿
