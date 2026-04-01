# Agent 响应时间优化设计

**日期**：2026-04-02
**目标**：将 Agent 首字响应时间控制在 10s 以内，长对话不退化

## 背景

用户反馈 Agent 回答耗时较长，新会话和旧会话都慢。核心瓶颈：
- **上下文无限累积**：对话历史不断增长，10 轮后可达 150K tokens
- **系统提示词每次重发**：5K-10K tokens/轮
- **首次响应无即时反馈**：用户发送后只能等待，感知上更慢

## 方案：A + B 组合

### 方案 A：前端体验 + OpenClaw 会话自动管理

#### A1. 前端即时反馈优化

用户发送消息后：
- 立即显示"已收到"提示（当前已有 typing indicator，保持即可）
- 确保 typing indicator 延迟 ≤ 150ms 显示

**改动文件**：`h5/src/chat-ui.js`（微调 `doSend` 中的 `showTyping` 时序）

#### A2. 自动 Compact 机制

在后端维护每个会话的消息轮数计数，当超过阈值时自动发送 `/compact` 给 Gateway 压缩上下文。

**实现思路**：
- 在 `server/index.js` 中维护 `sessionMessageCount` Map
- 每次 `chat.send` 转发时计数 +1
- 当计数达到阈值（默认 10 轮）时，自动追加一条 `/compact` 指令
- Compact 后重置计数

**阈值可配置**：通过环境变量 `AUTO_COMPACT_ROUNDS` 设置，默认 10

**改动文件**：`server/index.js`

#### A3. 流式渲染优化

当前前端逐 token 更新 DOM，高频操作造成性能损耗。

**优化**：用 `requestAnimationFrame` 批量合并 token 更新，每帧只做一次 DOM 操作。

**改动文件**：`h5/src/chat-ui.js`（修改流式消息更新逻辑）

### 方案 B：Prompt Caching 优化

#### B1. 限制历史轮数

当前 `chatHistory` 请求 200 条完整消息，大量历史占用上下文窗口。

**优化**：
- 后端在转发 `chat.send` 时不做改动（历史由 Gateway 管理）
- 利用 OpenClaw 的 `/compact` 自动管理上下文大小
- 可选：前端 `loadHistory` 仅加载最近 50 条用于显示（不影响发送）

**改动文件**：`h5/src/chat-ui.js`（调整 `chatHistory` limit 参数）

#### B2. 新会话使用轻量上下文

对于新创建的会话（通过 agent picker），确保不携带旧会话的历史。

**当前状态**：已实现 — `switchToSession` 切换到新 session key 后，Gateway 侧是新会话。

**无需额外改动**。

## 不做的事

- **不实现多模型分级**（方案 C）：增加复杂度，留作后续优化
- **不修改 OpenClaw Gateway 配置**：当前没有直接修改 Gateway 配置的权限
- **不实现连接池**：每个会话一个 WebSocket 是 OpenClaw 的设计，不应绕过

## 验证指标

| 指标 | 当前 | 目标 |
|------|------|------|
| 新会话首字响应 | 待测量 | < 10s |
| 10 轮对话后响应 | 待测量 | < 10s |
| 20 轮对话后响应 | 待测量 | < 10s |
| 流式渲染帧率 | 待测量 | 60fps |

## 实施顺序

1. A1（即时反馈）— 改动最小，立即可做
2. A3（流式渲染优化）— 前端改动
3. A2（自动 compact）— 后端改动，需要测试
4. B1（限制历史轮数）— 前端参数调整
