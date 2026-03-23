# OpenClaw Chat 设计文档

**日期**: 2026-03-20
**状态**: 设计阶段
**版本**: 1.0

---

## 概述

基于 ClawApp 二次开发一个面向客户服务的 OpenClaw AI 聊天客户端，支持用户认证和动态 Agent 分配。

### 设计目标

1. **安全隔离**：用户之间严格隔离，无法访问彼此的会话
2. **灵活访问**：支持公开链接（Token）和账号密码登录两种方式
3. **可扩展性**：当前使用 SQLite，后续可平滑迁移到 PostgreSQL
4. **最小改动**：保持 ClawApp 原有界面，主要改动集中在服务端

---

## 系统架构

### 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                         客户端 (H5)                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  登录页面     │  │  聊天界面     │  │  IndexedDB (历史)     │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      ClawApp Server (改造)                       │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │  API 层      │  │  认证中间件   │  │  WebSocket 处理      │   │
│  │ (api.js)    │  │  (auth.js)   │  │  (gateway.js)       │   │
│  └─────────────┘  └──────────────┘  └──────────────────────┘   │
│                              │                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    数据访问层 (db.js)                     │  │
│  │  ┌─────────┐  ┌──────────┐  ┌──────────────────────┐    │  │
│  │  │ Users   │  │ Sessions │  │  AccessTokens        │    │  │
│  │  │ Table   │  │  Table   │  │  (来源→Agent)        │    │  │
│  │  └─────────┘  └──────────┘  └──────────────────────┘    │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    OpenClaw Gateway                              │
│                    (ws://localhost:18789)                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 数据库设计

### 表结构

#### users 表

存储注册用户信息。

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

存储公开访问的 Token，编码了 Agent 分配信息。

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

存储登录用户的会话历史。

```sql
CREATE TABLE user_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  gateway_session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  title TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键 |
| user_id | INTEGER | 关联 users.id |
| gateway_session_id | TEXT | Gateway 的 session ID |
| agent_id | TEXT | 使用的 Agent ID |
| title | TEXT | 会话标题 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

---

#### usage_stats 表

使用量统计（为未来限流功能预留）。

```sql
CREATE TABLE usage_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  token_id INTEGER,
  date DATE NOT NULL,
  message_count INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (token_id) REFERENCES access_tokens(id),
  UNIQUE(user_id, token_id, date)
);
```

---

### 索引

```sql
CREATE INDEX idx_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_tokens_token ON access_tokens(token);
CREATE INDEX idx_stats_date ON usage_stats(date);
CREATE INDEX idx_users_username ON users(username);
```

---

## 核心组件设计

### 1. 数据访问层 (server/db.js)

封装所有数据库操作，提供清晰的接口。

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

  // 统计操作
  async incrementUsage(userId, tokenId) { }
  async getDailyUsage(userId, tokenId) { }
}
```

---

### 2. 认证管理器 (server/auth.js)

处理用户认证和 Token 验证。

```javascript
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

class AuthManager {
  constructor(db, jwtSecret) {
    this.db = db;
    this.jwtSecret = jwtSecret;
  }

  // 用户登录：验证密码，返回 JWT
  async login(username, password) {
    const user = await this.db.findUserByUsername(username);
    if (!user) return null;

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return null;

    return jwt.sign(
      { userId: user.id, username: user.username },
      this.jwtSecret,
      { expiresIn: '7d' }
    );
  }

  // 验证 JWT Token
  verifyJWT(token) {
    try {
      return jwt.verify(token, this.jwtSecret);
    } catch (e) {
      return null;
    }
  }

  // 验证访问 Token
  async validateAccessToken(token) {
    const record = await this.db.findToken(token);
    if (!record || !record.is_active) return null;

    if (record.expires_at && new Date() > new Date(record.expires_at)) {
      return null;
    }

    return record;
  }

  // WebSocket 认证：从请求中提取并验证用户身份
  async authenticateWebSocket(req) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const jwtToken = url.searchParams.get('token');
    const accessToken = url.searchParams.get('access_token');

    // 优先验证 JWT（登录用户）
    if (jwtToken) {
      const decoded = this.verifyJWT(jwtToken);
      if (decoded) {
        return { type: 'user', id: decoded.userId, username: decoded.username };
      }
    }

    // 其次验证访问 Token（匿名用户）
    if (accessToken) {
      const tokenRecord = await this.validateAccessToken(accessToken);
      if (tokenRecord) {
        return { type: 'token', id: tokenRecord.id, agentId: tokenRecord.agent_id };
      }
    }

    return null;
  }

  // 生成访问 Token
  generateAccessToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  // 哈希密码
  async hashPassword(password) {
    return bcrypt.hash(password, 10);
  }
}
```

---

### 3. WebSocket 代理 (server/gateway.js)

处理 WebSocket 连接，代理到 OpenClaw Gateway。

```javascript
const WebSocket = require('ws');
const EventEmitter = require('events');

class GatewayProxy extends EventEmitter {
  constructor(authManager, openclawUrl, openclawToken) {
    super();
    this.auth = authManager;
    this.openclawUrl = openclawUrl;
    this.openclawToken = openclawToken;
    this.connections = new Map(); // ws -> authInfo
  }

  // 处理新连接
  async handleConnection(ws, req) {
    // 1. 认证
    const authInfo = await this.auth.authenticateWebSocket(req);
    if (!authInfo) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    // 2. 存储认证信息
    this.connections.set(ws, authInfo);

    // 3. 连接到 OpenClaw Gateway
    const gatewayWs = this.connectToGateway(authInfo);

    // 4. 设置消息代理
    this.setupProxy(ws, gatewayWs, authInfo);

    // 5. 清理
    ws.on('close', () => {
      this.connections.delete(ws);
      gatewayWs.close();
    });
  }

  // 连接到 OpenClaw Gateway
  connectToGateway(authInfo) {
    const ws = new WebSocket(this.openclawUrl, {
      headers: {
        'Authorization': `Bearer ${this.openclawToken}`
      }
    });

    return ws;
  }

  // 设置双向消息代理
  setupProxy(clientWs, gatewayWs, authInfo) {
    // 客户端 → Gateway（过滤）
    clientWs.on('message', (data) => {
      const msg = JSON.parse(data);

      // Agent 权限检查
      if (msg.agent || msg.agentId) {
        const requestedAgent = msg.agent || msg.agentId;
        // TODO: 验证用户是否有权限访问该 Agent
      }

      gatewayWs.send(JSON.stringify(msg));
    });

    // Gateway → 客户端（过滤 session）
    gatewayWs.on('message', (data) => {
      const msg = JSON.parse(data);

      // 过滤 session 列表
      if (msg.type === 'session_list') {
        msg.sessions = this.filterSessions(msg.sessions, authInfo);
      }

      clientWs.send(JSON.stringify(msg));
    });
  }

  // 过滤 session：用户只能看到自己的
  filterSessions(sessions, authInfo) {
    if (authInfo.type === 'token') {
      // 匿名用户：只返回当前连接相关的 session
      // TODO: 实现 session 映射逻辑
      return sessions;
    } else {
      // 登录用户：从数据库获取用户的 session 列表
      // TODO: 查询数据库并过滤
      return sessions;
    }
  }
}
```

---

### 4. API 路由 (server/api.js)

HTTP API 端点。

```javascript
const express = require('express');
const router = express.Router();

// POST /api/login - 用户登录
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }

  const token = await req.authManager.login(username, password);

  if (!token) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  res.json({ token, username });
});

// POST /api/register - 用户注册（可选）
router.post('/register', async (req, res) => {
  const { username, password, email } = req.body;

  // TODO: 验证输入
  // TODO: 检查用户是否已存在
  // TODO: 创建用户

  res.json({ success: true });
});

// POST /api/tokens - 创建访问 Token（需要认证）
router.post('/tokens', requireAuth, async (req, res) => {
  const { agentId, label, expiresIn } = req.body;

  if (!agentId) {
    return res.status(400).json({ error: 'agent_id 不能为空' });
  }

  const token = req.authManager.generateAccessToken();
  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;

  await req.db.createToken(token, agentId, req.user.username, {
    sourceLabel: label,
    expiresAt
  });

  res.json({ token, agentId, label, expiresAt });
});

// GET /api/tokens - 列出 Token（需要认证）
router.get('/tokens', requireAuth, async (req, res) => {
  const tokens = await req.db.listTokens(req.user.username);
  res.json(tokens);
});

// DELETE /api/tokens/:token - 删除 Token（需要认证）
router.delete('/tokens/:token', requireAuth, async (req, res) => {
  await req.db.deactivateToken(req.params.token);
  res.json({ success: true });
});

// GET /api/sessions - 获取用户会话历史（需要认证）
router.get('/sessions', requireAuth, async (req, res) => {
  const sessions = await req.db.getUserSessions(req.user.id);
  res.json(sessions);
});

// 认证中间件
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未认证' });
  }

  const token = authHeader.substring(7);
  const decoded = req.authManager.verifyJWT(token);

  if (!decoded) {
    return res.status(401).json({ error: 'Token 无效' });
  }

  req.user = decoded;
  next();
}

module.exports = router;
```

---

## 访问流程

### 登录用户流程

```
1. 用户访问 chat.example.com
   ↓
2. 前端检查本地是否有 JWT token
   ├─ 有：直接连接 WebSocket
   └─ 无：重定向到登录页面
   ↓
3. 输入用户名/密码 → POST /api/login
   ↓
4. 服务器验证数据库 → 返回 JWT token
   ↓
5. 前端存储 token → 连接 WebSocket (ws://server?token=xxx)
   ↓
6. 服务器验证 JWT → 从数据库获取用户的 session 列表
   ↓
7. 用户选择或创建会话 → 开始聊天
   ↓
8. 消息通过代理转发到 OpenClaw Gateway
```

### 公开链接（Token）流程

```
1. 用户访问 chat.example.com?t=<access_token>
   ↓
2. 前端解析 URL 中的 token → 连接 WebSocket
   ↓
3. 服务器验证 access_token → 获取绑定的 agent_id
   ↓
4. 创建新会话 → 开始聊天（只能看到自己的会话）
   ↓
5. 消息通过代理转发到 OpenClaw Gateway
```

---

## 安全考虑

### 1. 密码安全
- 使用 bcrypt 哈希存储密码
- 密码强度验证（可选）

### 2. Token 安全
- JWT 签名使用强密钥（至少 32 字符）
- 访问 Token 使用 32 字节随机字符串
- Token 可设置过期时间

### 3. 网络安全
- 生产环境使用 HTTPS/WSS
- CORS 控制

### 4. 数据安全
- SQL 参数化查询防止注入
- 敏感信息不记录日志

---

## 扩展性考虑

### 数据库迁移

当用户规模增长需要迁移到 PostgreSQL 时：

```javascript
// 当前：SQLite
const db = new Database('data/chat.db');

// 迁移后：PostgreSQL
// 只需替换 db.js 中的实现
const db = new PostgresDatabase({ /* pg config */ });
```

上层代码（auth.js, gateway.js, api.js）无需修改。

### 未来功能扩展点

1. **限流**：使用 `usage_stats` 表记录每日消息数
2. **多租户**：添加 `organizations` 表，按组织隔离用户
3. **审计日志**：添加 `audit_logs` 表记录敏感操作
4. **实时通知**：集成 WebSocket 通知系统

---

## 项目结构

```
/data/app/openclaw-chat/
├── server/
│   ├── index.js              # 主入口
│   ├── db.js                 # 数据库操作层
│   ├── auth.js               # 认证逻辑
│   ├── gateway.js            # WebSocket 代理
│   ├── api.js                # HTTP API 路由
│   ├── middleware.js         # Express 中间件
│   ├── package.json
│   ├── .env.example
│   └── data/
│       └── chat.db           # SQLite 数据库文件
├── h5/                       # 前端（复用 ClawApp）
│   ├── src/
│   │   ├── main.js           # 入口
│   │   ├── login.js          # 登录页面逻辑（新增）
│   │   ├── ws-client.js      # WebSocket 客户端
│   │   ├── chat-ui.js        # 聊天 UI
│   │   └── ...
│   ├── index.html
│   └── ...
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-03-20-openclaw-chat-design.md
├── .env                      # 环境变量
├── package.json
└── README.md
```

---

## 环境变量

```bash
# .env 配置
PORT=3210                           # 服务端口
NODE_ENV=development

# JWT 密钥（至少 32 字符）
JWT_SECRET=your-very-long-random-secret-key-change-this

# OpenClaw Gateway 配置
OPENCLAW_GATEWAY_URL=ws://localhost:18789
OPENCLAW_GATEWAY_TOKEN=your-gateway-token
# 或使用密码认证
# OPENCLAW_GATEWAY_PASSWORD=your-gateway-password

# 数据库路径
DATABASE_PATH=./server/data/chat.db

# CORS（可选）
ALLOWED_ORIGINS=http://localhost:3210,https://yourdomain.com
```

---

## 依赖包

```json
{
  "dependencies": {
    "express": "^4.18.0",
    "ws": "^8.14.0",
    "sqlite3": "^5.1.6",
    "bcrypt": "^5.1.1",
    "jsonwebtoken": "^9.0.2",
    "dotenv": "^16.3.1"
  }
}
```

---

## 实现检查清单

- [ ] 初始化项目结构
- [ ] 实现 Database 类 (db.js)
- [ ] 实现 AuthManager 类 (auth.js)
- [ ] 实现 GatewayProxy 类 (gateway.js)
- [ ] 实现 API 路由 (api.js)
- [ ] 创建登录页面前端 (login.js)
- [ ] 修改前端 WebSocket 连接逻辑
- [ ] 添加 session 过滤逻辑
- [ ] 编写测试
- [ ] 更新 README.md

---

**文档版本**: 1.0
**最后更新**: 2026-03-20
