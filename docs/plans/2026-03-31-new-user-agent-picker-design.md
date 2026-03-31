# 新用户首次登录 Agent 选择引导页设计

**日期**: 2026-03-31
**状态**: 已确认

## 问题

JWT 用户首次登录后，系统在 WebSocket 连接时自动以 `counselor-bot` 创建一个无标题会话，用户直接进入空白聊天界面，不知道自己在哪里、在跟谁对话，产生困惑。

## 方案

首次登录的新用户（无历史会话）连接成功后，展示全屏 Agent 选择引导页，用户选择 Agent 后才创建会话并进入聊天。

## 交互流程

```
用户注册 → 登录 → JWT 连接成功 → 后端检测无历史会话 → 返回标记
  → 前端展示全屏 Agent 选择引导页（列出所有可用 Agent）
    → 用户点击某个 Agent → 调用 POST /api/sessions 创建会话（以 Agent display_name 作为默认标题）
      → 切换到该会话 → 进入聊天界面
```

## 改动点

### 1. 后端 `server/index.js`

- JWT 用户连接时（约 L1142-1173），如果该用户没有任何会话，**不自动创建默认会话**
- 在连接成功的 meta 响应中增加 `newUser: true` 标记，让前端知道需要展示引导页

### 2. 前端 `h5/src/main.js`

- 新增 `showAgentPicker(onSelect)` 函数：全屏覆盖，展示可用 Agent 卡片网格
- 修改 JWT 连接成功回调（约 L221-252）：检测 `meta.newUser`，若为 true 则调用 `showAgentPicker`
- Agent 卡片点击后：调用 `POST /api/sessions` 创建会话，设置 sessionKey，进入聊天
- 移除或保留旧的 `showGuideIfNeeded()`（旧的欢迎提示），新用户流程不再需要

### 3. 前端样式 `h5/src/components.css`

- 复用 `.guide-overlay` 骨架
- 新增 `.agent-picker-grid` 网格布局，每个卡片 `.agent-picker-card` 展示：
  - Agent 名称（display_name）
  - Agent 描述（description）
  - 点击高亮效果

## Agent 卡片 UI 参考

```
┌─────────────────────────────┐
│     选择一个智能体开始对话     │
│                             │
│  ┌───────────┐ ┌───────────┐│
│  │ 🤖        │ │ 🤖        ││
│  │ 心理咨询师 │ │ xxx智能体  ││
│  │ 专业心理.. │ │ ...描述..  ││
│  └───────────┘ └───────────┘│
└─────────────────────────────┘
```

## 边界情况

- 只有一个 Agent 时：仍然展示选择页，保持一致体验
- Agent 列表获取失败：降级为直接创建默认 counselor-bot 会话（当前行为）
- 非 JWT 用户（Token 用户）：不受影响，保持现有流程
- 老用户（有历史会话）：不受影响，正常进入聊天
