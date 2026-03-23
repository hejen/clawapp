# OpenClaw Chat 设计文档（基于 ClawApp 二次开发）

**日期**: 2026-03-22
**状态**: 设计阶段
**版本**: 2.0
**基于**: [ClawApp](https://github.com/qingchencloud/clawapp)

---

## 概述

基于 ClawApp 二次开发一个面向客户服务的 OpenClaw AI 聊天客户端，支持用户认证和动态 Agent 分配。

### 设计目标

1. **功能完整** - 继承 ClawApp 核心功能（流式聊天、会话管理、Markdown 渲染）
2. **安全隔离** - 用户之间严格隔离，无法访问彼此的会话
3. **灵活访问** - 支持公开链接（Token）和账号密码登录两种方式
4. **可扩展性** - 当前使用 SQLite，后续可平滑迁移到 PostgreSQL
5. **最小改动** - 在 ClawApp 基础上添加认证系统，保留原有功能

---

## 系统架构

### 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                    客户端 (ClawApp H5)                       │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │ 统一认证页  │  │  聊天界面     │  │ IndexedDB (离线)   │  │
│  │ 账号登录    │  │ (保留原功能)  │  │ 会话+消息          │  │
│  └─────────────┘  └──────────────┘  └────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │ WebSocket (带认证)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  ClawApp Server (改造)                       │
│  ┌──────────────┐  ┌─────────────┐  ┌──────────────────┐   │
│  │ 认证中间件   │  │  会话管理    │  │ WebSocket 处理   │   │
│  │ (auth.js)    │  │ (session.js)│  │ (保留 + 过滤)    │   │
│  └──────────────┘  └─────────────┘  └──────────────────┘   │
│                            │                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │               数据访问层 (db.js)                     │   │
│  │  ┌─────────┐  ┌──────────┐  ┌────────────────┐     │   │
│  │  │ Users   │  │ Sessions │  │ AccessTokens   │     │   │
│  │  └─────────┘  └──────────┘  └────────────────┘     │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │ Ed25519 + Gateway Token
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    OpenClaw Gateway                          │
│                    (ws://localhost:18789)                    │
└─────────────────────────────────────────────────────────────┘
```

### 核心改动点

| 模块 | 原 ClawApp | 改造后 |
|------|-----------|--------|
| **前端连接页** | 单一 Token 输入 | 账号密码登录/注册（Token 通过 URL 参数） |
| **后端认证** | PROXY_TOKEN 单一认证 | JWT Token 或 PROXY_TOKEN |
| **会话存储** | 仅 IndexedDB（本地） | 登录用户：数据库 + IndexedDB，Token 用户：仅 IndexedDB |
| **会话隔离** | 无隔离（所有连接共享） | 用户只能看到自己的会话 |
| **WebSocket 代理** | 直接转发 | 添加 session 过滤逻辑 |

---

## 数据库设计

### 表结构

#### users 表

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  email TEXT UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键 |
| username | TEXT | 用户名（唯一） |
| password_hash | TEXT | bcrypt 密码哈希 |
| email | TEXT | 邮箱（可选，唯一） |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

---

#### access_tokens 表

```sql
CREATE TABLE access_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT UNIQUE NOT NULL,
  agent_id TEXT NOT NULL,
  source_label TEXT,
  is_active BOOLEAN DEFAULT 1,
  expires_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT
);
```

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键 |
| token | TEXT | 访问 Token（唯一） |
| agent_id | TEXT | 绑定的 OpenClaw Agent ID |
| source_label | TEXT | 来源标识（用于管理） |
| is_active | BOOLEAN | 是否启用 |
| expires_at | DATETIME | 过期时间（可选） |
| created_at | DATETIME | 创建时间 |
| created_by | TEXT | 创建者用户名 |

---

#### user_sessions 表

```sql
CREATE TABLE user_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  gateway_session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  title TEXT,
  metadata TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键 |
| user_id | INTEGER | 关联 users.id（可为 NULL，表示 Token 用户创建） |
| gateway_session_id | TEXT | Gateway 的 session ID |
| agent_id | TEXT | 使用的 Agent ID |
| title | TEXT | 会话标题 |
| metadata | TEXT | 会话配置（JSON 格式） |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

---

## HTTP API 接口

### 认证相关

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | `/api/auth/register` | 用户注册 | 否 |
| POST | `/api/auth/login` | 用户登录 | 否 |
| GET | `/api/auth/me` | 获取当前用户信息 | 是 |

### Token 管理

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | `/api/tokens` | 创建访问 Token | 是 |
| GET | `/api/tokens` | 列出我的 Token | 是 |
| DELETE | `/api/tokens/:id` | 删除 Token | 是 |

### 会话管理

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/api/sessions` | 获取会话列表 | 是 |
| POST | `/api/sessions` | 创建新会话 | 是 |
| DELETE | `/api/sessions/:id` | 删除会话 | 是 |
| PUT | `/api/sessions/:id` | 更新会话标题 | 是 |

---

## 核心组件设计

### 1. 数据访问层 (server/db.js)

```javascript
class Database {
  constructor(dbPath) {
    this.db = new sqlite3.Database(dbPath);
    this.init();
  }

  init() {
    // 创建表和索引
  }

  // 用户操作
  async createUser(username, passwordHash, email) { }
  async findUserByUsername(username) { }
  async updateUser(userId, data) { }

  // Token 操作
  async createToken(token, agentId, createdBy, options = {}) { }
  async findToken(token) { }
  async deactivateToken(token) { }
  async listTokens(createdBy) { }

  // 会话操作
  async saveSession(userId, gatewaySessionId, agentId, title) { }
  async getUserSessions(userId) { }
  async deleteSession(sessionId) { }
}
```

---

### 2. 认证管理器 (server/auth.js)

```javascript
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

class AuthManager {
  constructor(db, jwtSecret) {
    this.db = db;
    this.jwtSecret = jwtSecret;
  }

  // 用户登录
  async login(username, password) {
    const user = await this.db.findUserByUsername(username);
    if (!user) return null;

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return null;

    return {
      token: jwt.sign(
        { userId: user.id, username: user.username },
        this.jwtSecret,
        { expiresIn: '24h', issuer: 'openclaw-chat' }
      ),
      user: { id: user.id, username: user.username }
    };
  }

  // 用户注册
  async register(username, password, email) {
    const passwordHash = await bcrypt.hash(password, 10);
    return this.db.createUser(username, passwordHash, email);
  }

  // 验证 JWT
  verifyJWT(token) {
    try {
      return jwt.verify(token, this.jwtSecret);
    } catch (e) {
      return null;
    }
  }

  // 验证访问 Token
  async validateAccessToken(token) {
    return this.db.findActiveToken(token);
  }

  // 生成访问 Token
  generateAccessToken() {
    return require('crypto').randomBytes(32).toString('hex');
  }
}
```

---

### 3. 会话管理器 (server/session.js)

```javascript
class SessionManager {
  constructor(db) {
    this.db = db;
    // 连接 → session IDs 映射（用于 Token 用户）
    this.connectionSessions = new Map();
  }

  // 过滤 session 列表
  async filterSessions(gatewaySessions, authInfo) {
    if (authInfo.type === 'user') {
      // 登录用户：从数据库获取
      const userSessions = await this.db.getUserSessions(authInfo.id);
      const sessionIds = new Set(userSessions.map(s => s.gateway_session_id));
      return gatewaySessions.filter(s => sessionIds.has(s.id));
    } else {
      // Token 用户：返回当前连接的 session
      const sessions = this.connectionSessions.get(authInfo.id) || new Set();
      return gatewaySessions.filter(s => sessions.has(s.id));
    }
  }

  // 记录连接创建的 session
  trackSession(authInfo, sessionId) {
    if (authInfo.type === 'token') {
      if (!this.connectionSessions.has(authInfo.id)) {
        this.connectionSessions.set(authInfo.id, new Set());
      }
      this.connectionSessions.get(authInfo.id).add(sessionId);
    }
  }

  // 保存用户 session 到数据库
  async saveUserSession(userId, gatewaySessionId, agentId, title) {
    return this.db.saveSession(userId, gatewaySessionId, agentId, title);
  }

  // 清理断开的连接
  disconnectClient(authInfo) {
    if (authInfo.type === 'token') {
      this.connectionSessions.delete(authInfo.id);
    }
  }
}
```

---

## 前端改动设计

### 文件改动列表

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `h5/index.html` | **重写** | 统一认证页面（仅显示账号登录/注册） |
| `h5/src/main.js` | **修改** | 添加认证流程 |
| `h5/src/ws-client.js` | **保留** | WebSocket 协议层（无需改动） |
| `h5/src/chat-ui.js` | **保留** | 聊天界面（无需改动） |
| `h5/src/session-picker.js` | **保留** | 会话管理（无需改动） |
| `h5/src/auth.js` | **新增** | 认证逻辑模块 |
| `h5/src/api.js` | **新增** | HTTP API 客户端 |
| `h5/src/message-db.js` | **修改** | 添加数据库同步逻辑 |
| `h5/src/offline-queue.js` | **保留** | 离线队列（无需改动） |

---

### 统一认证页面设计

#### 登录模式

```
┌────────────────────────────────────────┐
│           OpenClaw Chat                │
├────────────────────────────────────────┤
│                                        │
│         ┌────────────────────────┐     │
│         │                        │     │
│         │    [Logo]              │     │
│         │                        │     │
│         └────────────────────────┘     │
│                                        │
│   ┌────────────────────────────────┐  │
│   │  用户名                        │  │
│   │  __________________________    │  │
│   │                                │  │
│   │  密码                          │  │
│   │  __________________________    │  │
│   │                                │  │
│   │  [登录]                        │  │
│   └────────────────────────────────┘  │
│                                        │
│   还没有账号？[立即注册]               │
│                                        │
└────────────────────────────────────────┘
```

#### 注册模式

```
┌────────────────────────────────────────┐
│           OpenClaw Chat                │
├────────────────────────────────────────┤
│                                        │
│   ┌────────────────────────────────┐  │
│   │  用户名                        │  │
│   │  __________________________    │  │
│   │                                │  │
│   │  邮箱（可选）                  │  │
│   │  __________________________    │  │
│   │                                │  │
│   │  密码                          │  │
│   │  __________________________    │  │
│   │                                │  │
│   │  确认密码                      │  │
│   │  __________________________    │  │
│   │                                │  │
│   │  [注册] [返回登录]             │  │
│   └────────────────────────────────┘  │
│                                        │
└────────────────────────────────────────┘
```

#### 访问方式

- **正常访问** `http://server:3210/` → 显示登录页面
- **Token 链接** `http://server:3210/?t=xxx` → 后台自动使用 Token 连接，直接进入聊天界面

---

### 新增模块：auth.js

```javascript
// h5/src/auth.js
class AuthManager {
  constructor() {
    this.init();
  }

  init() {
    // 检查 URL 是否有 Token 参数
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('t');

    if (token) {
      // Token 访问模式：直接连接，不显示登录页
      this.connectWithToken(token);
    } else {
      // 检查本地是否有 JWT
      const jwt = localStorage.getItem('jwt_token');
      if (jwt) {
        this.connectWithJWT(jwt);
      } else {
        // 显示登录页面
        this.showLoginPage();
      }
    }
  }

  // 账号登录
  async login(username, password) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    if (!res.ok) throw new Error('登录失败');
    const { token, user } = await res.json();
    localStorage.setItem('jwt_token', token);
    localStorage.setItem('user_info', JSON.stringify(user));
    return this.connectWithJWT(token);
  }

  // 注册
  async register(username, password, email) {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, email })
    });
    if (!res.ok) throw new Error('注册失败');
    return res.json();
  }

  // Token 模式连接（后台使用）
  connectWithToken(token) {
    localStorage.setItem('access_token', token);
    this.connectWebSocket(token);
  }

  // JWT 模式连接
  connectWithJWT(token) {
    this.connectWebSocket(token);
  }

  // 退出登录
  logout() {
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('user_info');
    location.reload();
  }

  showLoginPage() {
    // 显示登录页面
    document.getElementById('loginPage').style.display = 'block';
  }
}
```

---

### 新增模块：api.js

```javascript
// h5/src/api.js
class API {
  constructor(baseURL) {
    this.baseURL = baseURL;
    this.token = localStorage.getItem('jwt_token');
  }

  async request(method, path, data) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(this.baseURL + path, {
      method,
      headers,
      body: data ? JSON.stringify(data) : null
    });

    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  // Token 管理
  createToken(agentId, label) {
    return this.request('POST', '/api/tokens', { agentId, label });
  }

  listTokens() {
    return this.request('GET', '/api/tokens');
  }

  deleteToken(id) {
    return this.request('DELETE', `/api/tokens/${id}`);
  }

  // 会话管理
  listSessions() {
    return this.request('GET', '/api/sessions');
  }

  createSession(agentId, title) {
    return this.request('POST', '/api/sessions', { agentId, title });
  }

  deleteSession(id) {
    return this.request('DELETE', `/api/sessions/${id}`);
  }
}
```

---

## 后端实现设计

### 后端文件结构

```
server/
├── index.js           # 主入口（改造）
├── auth.js            # 认证管理器（新增）
├── db.js              # 数据库层（新增）
├── session.js         # 会话管理（新增）
├── api.js             # HTTP API 路由（新增）
├── middleware.js      # Express 中间件（新增）
├── package.json       # 依赖更新
├── .env.example       # 配置模板（更新）
└── data/
    └── chat.db        # SQLite 数据库
```

---

### 与原 ClawApp 的集成方式

**保留的原有模块：**
- `server/index.js` 中的 WebSocket 代理逻辑
- Ed25519 设备签名认证
- 与 OpenClaw Gateway 的握手协议

**新增的认证流程：**

```javascript
// 修改后的 server/index.js 核心逻辑
const express = require('express');
const WebSocket = require('ws');
const Database = require('./db');
const AuthManager = require('./auth');
const SessionManager = require('./session');

// 原有配置
const PROXY_TOKEN = process.env.PROXY_TOKEN;
const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL;
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;

// 新增：数据库和认证
const db = new Database(process.env.DATABASE_PATH || './server/data/chat.db');
const authManager = new AuthManager(db, process.env.JWT_SECRET);
const sessionManager = new SessionManager(db);

const app = express();
app.use(express.json());

// ========== 新增：HTTP API ==========
app.use('/api', require('./api'));

// ========== 新增：认证中间件 ==========
async function authenticateWebSocket(req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');

  if (!token) return null;

  // 判断是 JWT 还是 Access Token
  if (token.startsWith('eyJ')) {
    // JWT Token（登录用户）
    const decoded = authManager.verifyJWT(token);
    if (decoded) {
      return { type: 'user', id: decoded.userId, username: decoded.username };
    }
  } else {
    // Access Token（公开链接）
    const tokenRecord = await authManager.validateAccessToken(token);
    if (tokenRecord) {
      return { type: 'token', id: tokenRecord.id, agentId: tokenRecord.agent_id };
    }
  }

  return null;
}

// ========== 修改后的 WebSocket 处理 ==========
const wss = new WebSocket.Server({ server });

wss.on('connection', async (ws, req) => {
  // 1. 认证
  const authInfo = await authenticateWebSocket(req);
  if (!authInfo) {
    ws.close(4001, 'Unauthorized');
    return;
  }

  // 2. 连接到 Gateway（保留原逻辑）
  const gatewayWs = await connectToGateway();

  // 3. 设置代理（添加会话过滤）
  setupProxy(ws, gatewayWs, authInfo);
});

// 设置双向代理（添加会话过滤）
function setupProxy(clientWs, gatewayWs, authInfo) {
  // 客户端 → Gateway（转发所有消息）
  clientWs.on('message', (data) => {
    gatewayWs.send(data);
  });

  // Gateway → 客户端（过滤 session）
  gatewayWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

      // 过滤 session 列表
      if (msg.type === 'session_list') {
        msg.sessions = sessionManager.filterSessions(msg.sessions, authInfo);
      }

      clientWs.send(JSON.stringify(msg));
    } catch (e) {
      clientWs.send(data);
    }
  });
}

// 连接到 OpenClaw Gateway（保留原 Ed25519 握手）
async function connectToGateway() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(GATEWAY_URL);

    ws.on('open', () => {
      // Ed25519 握手（保留原逻辑）
      ws.send(JSON.stringify({
        type: 'auth',
        token: GATEWAY_TOKEN
      }));

      resolve(ws);
    });

    ws.on('error', reject);
  });
}
```

---

### 环境变量配置

```bash
# .env - 新增配置项

# ============ 原有配置 ============
PROXY_TOKEN=your-proxy-token
OPENCLAW_GATEWAY_URL=ws://localhost:18789
OPENCLAW_GATEWAY_TOKEN=your-gateway-token

# ============ 新增配置 ============
# JWT 密钥（至少 32 字符）
JWT_SECRET=your-very-long-random-secret-key

# 数据库路径
DATABASE_PATH=./server/data/chat.db

# 可选：CORS 白名单
ALLOWED_ORIGINS=*
```

---

## 迁移策略与实施计划

### 实施步骤

#### 阶段 1：Fork 并准备 ClawApp

```bash
# 1. Fork ClawApp 仓库到您的 GitHub
# 2. 克隆到本地
git clone https://github.com/YOUR_USERNAME/clawapp.git openclaw-chat
cd openclaw-chat

# 3. 安装依赖
npm run install:all

# 4. 构建前端
npm run build:h5

# 5. 测试原始功能
cp server/.env.example server/.env
# 编辑 .env 填入 Gateway Token
npm start
```

**验收标准：** 原始 ClawApp 功能正常工作

---

#### 阶段 2：添加数据库层

```bash
# 1. 安装新依赖
npm install sqlite3 bcrypt jsonwebtoken --save

# 2. 创建 server/db.js
# 3. 创建数据库初始化脚本
```

**新增文件：**
- `server/db.js`
- `server/init-db.js`

**验收标准：** 数据库表创建成功，可以执行增删改查

---

#### 阶段 3：添加认证系统

```bash
# 1. 创建 server/auth.js
# 2. 创建 server/api.js
# 3. 创建 server/middleware.js
# 4. 修改 server/index.js 集成认证
```

**修改文件：**
- `server/index.js`
- `server/.env.example`

**新增文件：**
- `server/auth.js`
- `server/api.js`
- `server/middleware.js`

**验收标准：** 账号注册/登录 API 正常，JWT Token 验证正常

---

#### 阶段 4：添加会话管理

```bash
# 1. 创建 server/session.js
# 2. 在 WebSocket 代理中添加会话过滤
```

**新增文件：**
- `server/session.js`

**修改文件：**
- `server/index.js`

**验收标准：** 登录用户只能看到自己的会话，Token 用户只能看到当前连接的会话

---

#### 阶段 5：修改前端

```bash
# 1. 修改 h5/index.html
# 2. 创建 h5/src/auth.js
# 3. 创建 h5/src/api.js
# 4. 修改 h5/src/main.js
# 5. 修改 h5/src/message-db.js
# 6. 重新构建前端
npm run build:h5
```

**修改文件：**
- `h5/index.html`
- `h5/src/main.js`
- `h5/src/message-db.js`

**新增文件：**
- `h5/src/auth.js`
- `h5/src/api.js`

**验收标准：** 登录页面正常，账号登录功能正常，Token 链接直接进入聊天

---

#### 阶段 6：测试与优化

```bash
# 1. 功能测试
# 2. 安全测试
# 3. 性能优化
# 4. 文档更新
```

---

### 测试清单

- [ ] 账号注册功能
- [ ] 账号登录功能
- [ ] JWT Token 认证
- [ ] Access Token 认证
- [ ] 会话隔离验证
- [ ] 消息收发功能
- [ ] Markdown 渲染
- [ ] 会话创建/删除
- [ ] 跨设备会话同步（登录用户）
- [ ] Token 链接访问

---

## 高级功能接口预留设计

为了在本次迭代完成后能够快速添加图片、语音等高级功能，在架构设计中预留了相应的接口和扩展点。

### 消息类型扩展

#### 当前消息格式（文本）

```javascript
{
  type: 'chat',
  content: '文本消息内容',
  sessionId: 'session-id'
}
```

#### 预留扩展消息类型

```javascript
// 图片消息
{
  type: 'image',
  content: {
    url: 'https://server.com/media/images/xxx.jpg',
    thumbnail: 'https://server.com/media/thumbs/xxx_thumb.jpg',
    filename: 'photo.jpg',
    size: 102400
  },
  sessionId: 'session-id'
}

// 语音消息
{
  type: 'audio',
  content: {
    url: 'https://server.com/media/audio/xxx.mp3',
    duration: 15.5,  // 秒
    transcription: '语音转文字结果（可选）'
  },
  sessionId: 'session-id'
}

// 文件消息（未来扩展）
{
  type: 'file',
  content: {
    url: 'https://server.com/media/files/document.pdf',
    filename: 'document.pdf',
    size: 2048000,
    mimeType: 'application/pdf'
  },
  sessionId: 'session-id'
}
```

---

### 前端接口预留

#### media.js 扩展接口

```javascript
// h5/src/media.js（保留自 ClawApp，已预留）
class MediaManager {
  // 图片处理
  async uploadImage(file) {
    // 本迭代：返回占位符
    return { url: '', error: 'Not implemented yet' };

    // 未来实现：
    // const formData = new FormData();
    // formData.append('file', file);
    // const res = await fetch('/api/media/upload', {
    //   method: 'POST',
    //   headers: { 'Authorization': `Bearer ${this.token}` },
    //   body: formData
    // });
    // return res.json();
  }

  // 语音录制
  async startRecording() {
    // 本迭代：抛出未实现错误
    throw new Error('Voice recording not implemented yet');

    // 未来实现：
    // this.mediaRecorder = new MediaRecorder(stream);
    // this.mediaRecorder.start();
  }

  async stopRecording() {
    // 本迭代：抛出未实现错误
    throw new Error('Voice recording not implemented yet');

    // 未来实现：
    // const blob = await new Promise(resolve => {
    //   this.mediaRecorder.ondataavailable = e => resolve(e.data);
    //   this.mediaRecorder.stop();
    // });
    // return this.uploadAudio(blob);
  }
}
```

#### UI 组件预留位置

```html
<!-- h5/chat-ui.html 中的输入区域 -->
<div class="input-area">
  <!-- 图片上传按钮（本迭代禁用） -->
  <button class="btn-icon" id="imageBtn" disabled title="图片上传">
    <svg>...</svg>
  </button>

  <!-- 语音输入按钮（本迭代禁用） -->
  <button class="btn-icon" id="voiceBtn" disabled title="语音输入">
    <svg>...</svg>
  </button>

  <!-- 文本输入框（本迭代启用） -->
  <textarea id="messageInput" placeholder="输入消息..."></textarea>

  <!-- 发送按钮 -->
  <button class="send-btn" id="sendBtn">
    <svg>...</svg>
  </button>
</div>
```

---

### 后端接口预留

#### API 路由预留

```javascript
// server/api.js 中预留的路由
const router = express.Router();

// 本迭代实现的接口
router.post('/api/auth/login', ...);
router.post('/api/auth/register', ...);

// ========== 预留：媒体文件管理 ==========
// router.post('/api/media/upload', mediaController.upload);
// router.get('/api/media/:id', mediaController.get);
// router.delete('/api/media/:id', mediaController.delete);

// ========== 预留：语音处理 ==========
// router.post('/api/audio/upload', audioController.upload);
// router.post('/api/audio/transcribe', audioController.transcribe);

module.exports = router;
```

#### media.js 服务端模块

```javascript
// server/media.js（预留，下个迭代实现）
class MediaManager {
  constructor(db, uploadDir) {
    this.db = db;
    this.uploadDir = uploadDir;
  }

  // 上传文件
  async uploadFile(file, userId, type) {
    // 未来实现：
    // 1. 验证文件类型和大小
    // 2. 生成唯一文件名
    // 3. 保存到磁盘或云存储
    // 4. 记录到数据库
    // 5. 返回访问 URL
  }

  // 获取文件
  async getFile(fileId, userId) {
    // 未来实现：
    // 1. 验证用户权限
    // 2. 返回文件流或 URL
  }

  // 删除文件
  async deleteFile(fileId, userId) {
    // 未来实现：
    // 1. 验证用户权限
    // 2. 删除磁盘文件
    // 3. 删除数据库记录
  }
}
```

---

### 数据库扩展预留

#### media 表（下个迭代添加）

```sql
-- 预留：媒体文件表
CREATE TABLE media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  file_type TEXT NOT NULL,  -- 'image', 'audio', 'file'
  filename TEXT NOT NULL,
  original_name TEXT,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  metadata TEXT,  -- JSON: 宽度、高度、时长等
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 索引
CREATE INDEX idx_media_user ON media(user_id);
CREATE INDEX idx_media_type ON media(file_type);
```

---

### WebSocket 消息处理扩展

#### 当前实现（文本消息）

```javascript
// server/index.js - setupProxy 函数
function setupProxy(clientWs, gatewayWs, authInfo) {
  clientWs.on('message', (data) => {
    // 当前：直接转发所有消息到 Gateway
    gatewayWs.send(data);
  });
}
```

#### 扩展实现（支持媒体）

```javascript
// 下个迭代扩展
function setupProxy(clientWs, gatewayWs, authInfo) {
  clientWs.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);

      // 处理媒体上传
      if (msg.type === 'image_upload' || msg.type === 'audio_upload') {
        const mediaUrl = await mediaManager.uploadFile(
          msg.content,
          authInfo.id,
          msg.type.replace('_upload', '')
        );

        // 转换为标准消息格式
        const standardMsg = {
          type: msg.type.replace('_upload', ''),
          content: { url: mediaUrl },
          sessionId: msg.sessionId
        };

        gatewayWs.send(JSON.stringify(standardMsg));
        return;
      }

      // 其他消息直接转发
      gatewayWs.send(data);
    } catch (e) {
      clientWs.send(JSON.stringify({ error: e.message }));
    }
  });
}
```

---

### 环境变量预留

```bash
# .env - 预留配置项

# ============ 媒体文件配置（下个迭代启用） ============
# MEDIA_UPLOAD_DIR=./server/uploads
# MEDIA_MAX_SIZE=10485760  # 10MB
# MEDIA_ALLOWED_TYPES=image/jpeg,image/png,image/gif,audio/mp3,audio/wav
#
# # 云存储配置（可选）
# MEDIA_STORAGE=local  # local | s3 | oss | cos
# AWS_S3_BUCKET=
# AWS_S3_REGION=
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
```

---

### 功能实现优先级

| 功能 | 优先级 | 依赖 | 预计工作量 |
|------|--------|------|-----------|
| **图片收发** | P0 | 媒体上传 API、前端图片选择器 | 2-3 天 |
| **语音输入** | P1 | HTTPS 环境、语音录制 API、转录服务 | 3-4 天 |
| **文件传输** | P2 | 文件上传 API、文件类型检测 | 2 天 |
| **视频通话** | P3 | WebRTC、信令服务器 | 1-2 周 |

---

### 快速启用指南

#### 启用图片功能（下个迭代）

```bash
# 1. 安装依赖
npm install multer @aws-sdk/client-s3

# 2. 取消注释 server/api.js 中的媒体路由
# 3. 实现 server/media.js
# 4. 创建 media 表
# 5. 前端启用图片按钮
# 6. 重新构建前端
npm run build:h5
```

#### 启用语音功能

```bash
# 1. 配置 HTTPS（语音输入需要安全上下文）
# 2. 取消注释前端语音按钮
# 3. 实现语音录制逻辑
# 4. 配置语音转录服务（可选）
# 5. 重新构建前端
npm run build:h5
```

---

### ClawApp 原有功能保留

ClawApp 中已有的高级功能模块完全保留，本迭代仅禁用 UI 入口：

| 模块 | 状态 | 说明 |
|------|------|------|
| `h5/src/media.js` | 保留 | 图片处理逻辑完整，本迭代不调用 |
| `h5/src/commands.js` | 保留 | 快捷指令面板完整 |
| `h5/src/markdown.js` | 保留 | Markdown 渲染完整 |
| `h5/src/theme.js` | 保留 | 主题切换完整 |
| `h5/src/i18n.js` | 保留 | 国际化完整 |
| `h5/src/settings.js` | 保留 | 设置面板完整 |

这些模块在下个迭代可以直接启用，无需重写。

---

## 核心决策回顾

| 决策点 | 选择 | 理由 |
|--------|------|------|
| **前端功能范围** | 保留核心功能（流式聊天、会话管理、Markdown） | 满足客服场景需求 |
| **代码整合方式** | Fork ClawApp + 修改 | 保留原有功能，减少重复开发 |
| **认证模式** | 双模式（账号登录 + Token 访问） | 灵活支持不同使用场景 |
| **实现方案** | 方案 B（统一认证入口） | 用户体验统一，便于维护 |

---

## 技术栈总结

| 层级 | 技术 | 说明 |
|------|------|------|
| **前端** | HTML + Vanilla JS | 复用 ClawApp，无框架依赖 |
| **后端** | Node.js + Express | 复用 ClawApp |
| **WebSocket** | ws | 复用 ClawApp |
| **数据库** | SQLite3 | 轻量级，便于迁移到 PostgreSQL |
| **认证** | JWT + bcrypt | 业界标准 |
| **存储** | IndexedDB | 浏览器本地缓存 |

---

## 未来扩展方向

1. **功能增强**
   - 添加管理后台（Token 管理、用户管理）
   - 支持语音输入（需要 HTTPS）
   - 支持图片收发

2. **性能优化**
   - 迁移到 PostgreSQL
   - 添加 Redis 缓存
   - 消息队列化

3. **企业功能**
   - 多租户组织管理
   - 权限系统（RBAC）
   - 审计日志

---

**文档版本**: 2.0
**最后更新**: 2026-03-22
