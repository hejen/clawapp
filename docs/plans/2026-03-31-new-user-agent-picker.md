# 新用户首次登录 Agent 选择引导页 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 新用户首次 JWT 登录后展示全屏 Agent 选择引导页，替代自动创建无标题会话的现有行为。

**Architecture:** 后端在 JWT 用户连接时检测是否为新用户（无历史会话），在 connect 响应中增加 `newUser` 标记。前端收到该标记后展示全屏 Agent 选择页，用户选择后创建会话并进入聊天。前端复用现有 `.guide-overlay` 样式骨架。

**Tech Stack:** 原生 JS（无框架）、CSS 自定义属性、SQLite（better-sqlite3）

---

### Task 1: 后端 — connect 响应增加 newUser 标记

**Files:**
- Modify: `server/index.js:1144-1173` (JWT 用户会话查找逻辑)
- Modify: `server/index.js:1191-1201` (connect 响应构建)

**Step 1: 修改 JWT 用户连接逻辑，增加 newUser 检测**

在 `server/index.js` 约 L1155 处，`getUserSession` 查询后，记录用户是否有任何会话（不仅限当前 agent）：

```javascript
    // For JWT users, use user-specific session (if exists)
    if (authType === 'jwt' && jwtUserId) {
      const agentId = defaults?.defaultAgentId || 'counselor-bot';

      log.info(`[/api/connect] JWT user lookup, userId: ${jwtUserId}, agentId: ${agentId}`);

      // 检查用户是否有任何历史会话（用于判断是否为新用户）
      const allUserSessions = await db.getUserSessions(jwtUserId);
      const isNewUser = !allUserSessions || allUserSessions.length === 0;
      log.info(`[/api/connect] JWT user isNewUser: ${isNewUser}, existingSessions: ${allUserSessions?.length || 0}`);

      // Check if user has an existing session for this agent
      const userSession = await db.getUserSession(jwtUserId, agentId);
      if (userSession) {
        sessionKey = userSession.gateway_session_id;
        log.info(`[/api/connect] JWT user session FOUND, sessionKey: ${sessionKey}`);
      } else if (isNewUser) {
        // 新用户：不自动创建会话，返回临时 sessionKey 占位
        // 前端会在 Agent 选择后通过 POST /api/sessions 创建真实会话
        const { generateSessionKey } = await import('./utils/uuid.js');
        sessionKey = await generateSessionKey(agentId, jwtUserId, async () => false);
        log.info(`[/api/connect] New JWT user, generated placeholder sessionKey: ${sessionKey}`);
      } else {
        // 老用户但没有当前 agent 的会话
        const { generateSessionKey } = await import('./utils/uuid.js');
        sessionKey = await generateSessionKey(agentId, jwtUserId, async () => false);
        log.info(`[/api/connect] JWT user has NO sessions for this agent, generated user-specific sessionKey: ${sessionKey}`);
      }

      // Store isNewUser for response
      connectNewUser = isNewUser;
    } else {
```

**Step 2: 修改 connect 响应，携带 newUser 标记**

在 `server/index.js` 约 L1191 的 `responseData` 构建处，增加 `newUser` 字段：

```javascript
    const responseData = {
      ok: true,
      sid,
      sessionKey,
      hello: session.hello
    };

    // Return PROXY_TOKEN to JWT users so they can save it for future connections
    if (authType === 'jwt' && effectiveToken) {
      responseData.proxyToken = effectiveToken;
    }

    // 告知前端是否为新用户（无历史会话），前端据此展示 Agent 选择引导页
    if (connectNewUser) {
      responseData.newUser = true;
    }

    res.json(responseData);
```

注意：需要在 connect handler 顶部声明 `let connectNewUser = false;`。

**Step 3: 验证**

1. 用一个新注册的 JWT 用户调用 `POST /api/connect`，检查响应中是否包含 `newUser: true`
2. 用已有会话的老用户调用 `POST /api/connect`，检查响应中不包含 `newUser` 字段

**Step 4: Commit**

```bash
git add server/index.js
git commit -m "feat: add newUser flag to connect response for JWT users"
```

---

### Task 2: 后端 — agents 接口返回 description

**Files:**
- Modify: `server/api.js:248-251` (agents 响应中添加 description 字段)

**Step 1: 在 agents 响应中添加 description**

当前 `/api/agents` 只返回 `name` 和 `display_name`，Agent 选择引导页需要 `description` 来展示说明：

```javascript
      agents: agents.map(a => ({
        name: a.name,
        display_name: a.display_name,
        description: a.description || ''
      }))
```

**Step 2: 验证**

调用 `GET /api/agents`，确认响应包含 `description` 字段。

**Step 3: Commit**

```bash
git add server/api.js
git commit -m "feat: include agent description in /api/agents response"
```

---

### Task 3: 前端 — api-client 传递 newUser 标记

**Files:**
- Modify: `h5/src/api-client.js:124-148` (connect 成功处理 + onReady 回调)

**Step 1: 在 api-client.js 中保存并传递 newUser 标记**

在 `connect` 方法中，保存 `newUser` 标记并在 onReady 回调中传递：

```javascript
      this._sid = data.sid
      this._hello = data.hello
      this._sessionKey = data.sessionKey
      this._proxyToken = data.proxyToken || null
      this._newUser = data.newUser || false  // 新增
```

在 onReady 回调调用处：

```javascript
      this._readyCallbacks.forEach(fn => {
        try {
          console.log('[api-client] Calling onReady callback with:', this._hello, this._sessionKey, { proxyToken: this._proxyToken, newUser: this._newUser })
          fn(this._hello, this._sessionKey, { proxyToken: this._proxyToken, newUser: this._newUser })
        } catch (e) {
          console.error('[api-client] onReady callback error:', e)
        }
      })
```

**Step 2: Commit**

```bash
git add h5/src/api-client.js
git commit -m "feat: pass newUser flag through api-client onReady callback"
```

---

### Task 4: 前端 — i18n 添加 Agent 选择页文案

**Files:**
- Modify: `h5/src/i18n.js:149-154` (中文)
- Modify: `h5/src/i18n.js:336-340` (英文)

**Step 1: 添加中文文案**

在 `'guide.start'` 后面添加：

```javascript
    'guide.start': '开始使用',
    'agent.pick.title': '选择一个智能体开始对话',
    'agent.pick.subtitle': '选择你感兴趣的智能体，开始你的第一次对话',
```

**Step 2: 添加英文文案**

在 `'guide.start'` 后面添加：

```javascript
    'guide.start': 'Get Started',
    'agent.pick.title': 'Choose an Agent to Start',
    'agent.pick.subtitle': 'Select an agent you are interested in to begin your first conversation',
```

**Step 3: Commit**

```bash
git add h5/src/i18n.js
git commit -m "feat: add i18n strings for agent picker page"
```

---

### Task 5: 前端 — Agent 选择引导页样式

**Files:**
- Modify: `h5/src/components.css` (在现有 `.guide-*` 样式后追加)

**Step 1: 添加 Agent 选择页 CSS**

在 `.guide-btn { margin-top: 0; }` 后面添加：

```css
/* Agent 选择引导页 */
.agent-picker-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin: 20px 0;
}

.agent-picker-card {
  background: var(--bg-card);
  border: 2px solid var(--border);
  border-radius: var(--radius-md);
  padding: 16px 14px;
  cursor: pointer;
  transition: border-color 0.2s, transform 0.15s;
  text-align: center;
}

.agent-picker-card:active {
  transform: scale(0.97);
  border-color: var(--accent);
}

.agent-picker-icon {
  font-size: 32px;
  margin-bottom: 10px;
  line-height: 1;
}

.agent-picker-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.agent-picker-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.agent-picker-subtitle {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: -8px;
  margin-bottom: 4px;
}

.agent-picker-loading {
  text-align: center;
  padding: 32px;
  color: var(--text-muted);
  font-size: 14px;
}

.agent-picker-error {
  text-align: center;
  padding: 20px;
  color: var(--danger);
  font-size: 14px;
}
```

**Step 2: Commit**

```bash
git add h5/src/components.css
git commit -m "feat: add agent picker page styles"
```

---

### Task 6: 前端 — 实现 showAgentPicker 函数

**Files:**
- Modify: `h5/src/main.js` (替换 `showGuideIfNeeded` 函数，约 L459-480)

**Step 1: 替换 showGuideIfNeeded 为 showAgentPicker**

将 `h5/src/main.js` 中整个 `showGuideIfNeeded` 函数（L459-480）替换为新的 `showAgentPicker` 函数：

```javascript
/** 新用户引导 — Agent 选择页 */
async function showAgentPicker(onSelect) {
  const overlay = document.createElement('div')
  overlay.className = 'guide-overlay'
  overlay.id = 'agent-picker-overlay'
  overlay.innerHTML = `
    <div class="guide-card">
      <h2>${t('agent.pick.title')}</h2>
      <p class="agent-picker-subtitle">${t('agent.pick.subtitle')}</p>
      <div id="agent-picker-grid" class="agent-picker-grid">
        <div class="agent-picker-loading">加载中...</div>
      </div>
    </div>
  `
  document.body.appendChild(overlay)

  try {
    const response = await api.request('GET', '/api/agents')
    if (!response.ok || !response.agents || response.agents.length === 0) {
      throw new Error('No agents available')
    }

    const grid = document.getElementById('agent-picker-grid')
    grid.innerHTML = response.agents.map(agent => `
      <div class="agent-picker-card" data-agent-id="${agent.name}" data-agent-name="${escapeText(agent.display_name)}">
        <div class="agent-picker-icon">&#129302;</div>
        <div class="agent-picker-name">${escapeText(agent.display_name)}</div>
        ${agent.description ? `<div class="agent-picker-desc">${escapeText(agent.description)}</div>` : ''}
      </div>
    `).join('')

    grid.querySelectorAll('.agent-picker-card').forEach(card => {
      card.onclick = () => {
        const agentId = card.dataset.agentId
        const agentName = card.dataset.agentName
        overlay.remove()
        onSelect(agentId, agentName)
      }
    })
  } catch (e) {
    console.error('[agent-picker] Failed to load agents:', e)
    const grid = document.getElementById('agent-picker-grid')
    grid.innerHTML = `<div class="agent-picker-error">${t('session.load.error')}: ${escapeText(e.message)}</div>
      <button class="btn-primary guide-btn" style="margin-top:12px" id="agent-picker-retry">${t('guide.start')}</button>`
    document.getElementById('agent-picker-retry').onclick = () => {
      overlay.remove()
      // 降级：直接使用默认 agent 创建会话
      onSelect('counselor-bot', '心理咨询师')
    }
  }
}
```

**Step 2: Commit**

```bash
git add h5/src/main.js
git commit -m "feat: implement showAgentPicker function"
```

---

### Task 7: 前端 — JWT 连接成功后展示 Agent 选择页

**Files:**
- Modify: `h5/src/main.js:221-252` (JWT onReady 回调)

**Step 1: 修改 JWT onReady 回调，新用户走 Agent 选择流程**

将 `h5/src/main.js` 中 JWT 的 `wsClient.onReady` 回调（L221-252）改为：

```javascript
      // Setup Gateway ready callback
      wsClient.onReady((hello, sessionKey, meta) => {
        console.log('[initApp] WebSocket connected, sessionKey:', sessionKey, 'newUser:', meta?.newUser)

        // Re-enable all interactions now that WebSocket is connected
        const chatPage = document.getElementById('chat-page')
        if (chatPage) {
          const allButtons = chatPage.querySelectorAll('button')
          allButtons.forEach(btn => btn.disabled = false)
          const textarea = chatPage.querySelector('textarea')
          if (textarea) textarea.disabled = false
          console.log('[initApp] Re-enabled all interactions')
        }

        // If server returned a proxyToken, save it for future connections
        if (meta?.proxyToken) {
          saveConfig(apiBase, meta.proxyToken)
          console.log('[JWT] Saved PROXY_TOKEN for future connections')
        }

        setSessionKey(sessionKey)
        showPage('chat-page')
        if (!chatInitialized) {
          chatInitialized = true
          initChatUI(() => {
            wsClient.disconnect()
            showPage('setup-page')
            chatInitialized = false
          })
        }

        // 新用户：展示 Agent 选择引导页
        if (meta?.newUser) {
          showAgentPicker(async (agentId, agentName) => {
            console.log('[initApp] New user selected agent:', agentId, agentName)
            try {
              const result = await api.createSession(null, agentId, agentName)
              if (result.ok) {
                // 切换到新创建的会话
                setSessionKey(result.gateway_session_id)
                requestAnimationFrame(() => loadHistory())
              } else {
                console.error('[initApp] Failed to create session:', result)
              }
            } catch (e) {
              console.error('[initApp] Failed to create session:', e)
            }
          })
        } else {
          // 老用户：正常加载历史
          requestAnimationFrame(() => loadHistory())
        }
      })
```

**Step 2: Commit**

```bash
git add h5/src/main.js
git commit -m "feat: show agent picker for new JWT users on first login"
```

---

### Task 8: 手动验证

**验证场景 1 — 新用户首次登录**
1. 注册一个新账户
2. 登录后应看到全屏 Agent 选择引导页
3. 点击一个 Agent 卡片
4. 应自动创建以该 Agent 名称命名的会话并进入聊天

**验证场景 2 — 老用户登录**
1. 用已有会话的账户登录
2. 应直接进入聊天页面，不显示 Agent 选择页

**验证场景 3 — Token 用户**
1. 用 Token 方式连接
2. 行为不变，不受影响

**验证场景 4 — Agent 列表加载失败**
1. 断开后端或模拟 /api/agents 失败
2. 引导页应显示错误信息和降级按钮
3. 点击降级按钮后应使用 counselor-bot 创建会话

**验证场景 5 — 暗色/亮色主题**
1. 切换主题后 Agent 选择页样式正常
