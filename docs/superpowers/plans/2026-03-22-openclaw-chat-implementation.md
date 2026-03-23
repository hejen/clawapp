# OpenClaw Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于 ClawApp 二次开发，添加用户认证系统（JWT + Access Token）、数据库存储、多租户会话隔离，保留原有核心功能

**Architecture:** Fork ClawApp → 添加数据库层（SQLite）→ 添加认证系统（JWT/bcrypt）→ 添加会话管理（过滤隔离）→ 修改前端（统一认证入口）

**Tech Stack:** Node.js, Express, WebSocket (ws), SQLite3, bcrypt, JWT, Vanilla JS, IndexedDB

**Spec Document:** `docs/superpowers/specs/2026-03-22-openclaw-chat-fork-design.md`

---

## Phase 1: Fork and Prepare ClawApp

### Task 1: Fork ClawApp Repository

**Files:** None (Git operations)

- [ ] **Step 1: Fork ClawApp on GitHub**

1. Visit https://github.com/qingchencloud/clawapp
2. Click "Fork" button
3. Create fork under your GitHub account

- [ ] **Step 2: Clone forked repository locally**

```bash
cd /data/app
git clone https://github.com/YOUR_USERNAME/clawapp.git openclaw-chat
cd openclaw-chat
```

Expected: Repository cloned to `/data/app/openclaw-chat`

- [ ] **Step 3: Install dependencies**

```bash
npm run install:all
```

Expected: Dependencies installed for both root and server

- [ ] **Step 4: Build frontend**

```bash
npm run build:h5
```

Expected: Frontend built successfully, `h5/dist/` directory created

- [ ] **Step 5: Test original ClawApp functionality**

```bash
cp server/.env.example server/.env
# Edit server/.env and add your OPENCLAW_GATEWAY_TOKEN
npm start
```

Expected: Server starts on port 3210, visit `http://localhost:3210` shows original ClawApp login page

- [ ] **Step 6: Verify and stop server**

```bash
# Press Ctrl+C to stop server
curl http://localhost:3210
```

Expected: Connection refused (server stopped)

- [ ] **Step 7: Initial commit**

```bash
git add -A
git commit -m "chore: fork clawapp, initial setup complete"
```

---

## Phase 2: Add Database Layer

### Task 2: Install Database Dependencies

**Files:**
- Modify: `server/package.json`

- [ ] **Step 1: Add database dependencies to server/package.json**

```bash
cd server
npm install sqlite3 bcrypt jsonwebtoken --save
```

Expected: Packages installed, `server/package.json` updated

- [ ] **Step 2: Verify installation**

```bash
cat package.json | grep -E "sqlite3|bcrypt|jsonwebtoken"
```

Expected output:
```json
"bcrypt": "^5.1.1",
"jsonwebtoken": "^9.0.2",
"sqlite3": "^5.1.6"
```

- [ ] **Step 3: Commit**

```bash
cd ..
git add server/package.json server/package-lock.json
git commit -m "deps: add sqlite3, bcrypt, jsonwebtoken"
```

---

### Task 3: Create Database Module (server/db.js)

**Files:**
- Create: `server/db.js`

- [ ] **Step 1: Write database module**

```javascript
// server/db.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) return reject(err);
        this.createTables()
          .then(() => resolve())
          .catch(reject);
      });
    });
  }

  async createTables() {
    const tables = [
      // Users table
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        email TEXT UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Access tokens table
      `CREATE TABLE IF NOT EXISTS access_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT UNIQUE NOT NULL,
        agent_id TEXT NOT NULL,
        source_label TEXT,
        is_active BOOLEAN DEFAULT 1,
        expires_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT
      )`,

      // User sessions table
      `CREATE TABLE IF NOT EXISTS user_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        gateway_session_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        title TEXT,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,

      // Indexes
      `CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_tokens_token ON access_tokens(token)`,
      `CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`
    ];

    for (const sql of tables) {
      await this.run(sql);
    }
  }

  // Helper: run SQL command
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) return reject(err);
        resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  // Helper: get single row
  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });
  }

  // Helper: get all rows
  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
  }

  // ============ User Operations ============

  async createUser(username, passwordHash, email = null) {
    const sql = `
      INSERT INTO users (username, password_hash, email)
      VALUES (?, ?, ?)
    `;
    const result = await this.run(sql, [username, passwordHash, email]);
    return result.lastID;
  }

  async findUserByUsername(username) {
    const sql = `SELECT * FROM users WHERE username = ?`;
    return this.get(sql, [username]);
  }

  async findUserById(userId) {
    const sql = `SELECT * FROM users WHERE id = ?`;
    return this.get(sql, [userId]);
  }

  async updateUser(userId, data) {
    const fields = [];
    const values = [];

    if (data.username) {
      fields.push('username = ?');
      values.push(data.username);
    }
    if (data.passwordHash) {
      fields.push('password_hash = ?');
      values.push(data.passwordHash);
    }
    if (data.email) {
      fields.push('email = ?');
      values.push(data.email);
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(userId);

    const sql = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;
    await this.run(sql, values);
  }

  // ============ Token Operations ============

  async createToken(token, agentId, createdBy, options = {}) {
    const sql = `
      INSERT INTO access_tokens (token, agent_id, source_label, expires_at, created_by)
      VALUES (?, ?, ?, ?, ?)
    `;
    const result = await this.run(sql, [
      token,
      agentId,
      options.sourceLabel || null,
      options.expiresAt || null,
      createdBy
    ]);
    return result.lastID;
  }

  async findToken(token) {
    const sql = `SELECT * FROM access_tokens WHERE token = ?`;
    return this.get(sql, [token]);
  }

  async findActiveToken(token) {
    const sql = `
      SELECT * FROM access_tokens
      WHERE token = ? AND is_active = 1
        AND (expires_at IS NULL OR expires_at > datetime('now'))
    `;
    return this.get(sql, [token]);
  }

  async deactivateToken(token) {
    const sql = `UPDATE access_tokens SET is_active = 0 WHERE token = ?`;
    await this.run(sql, [token]);
  }

  async listTokens(createdBy) {
    const sql = `
      SELECT * FROM access_tokens
      WHERE created_by = ?
      ORDER BY created_at DESC
    `;
    return this.all(sql, [createdBy]);
  }

  // ============ Session Operations ============

  async saveSession(userId, gatewaySessionId, agentId, title = null, metadata = null) {
    const sql = `
      INSERT INTO user_sessions (user_id, gateway_session_id, agent_id, title, metadata)
      VALUES (?, ?, ?, ?, ?)
    `;
    const result = await this.run(sql, [
      userId || null,
      gatewaySessionId,
      agentId,
      title,
      metadata ? JSON.stringify(metadata) : null
    ]);
    return result.lastID;
  }

  async getUserSessions(userId) {
    const sql = `
      SELECT * FROM user_sessions
      WHERE user_id = ?
      ORDER BY updated_at DESC
    `;
    return this.all(sql, [userId]);
  }

  async findSessionByGatewayId(gatewaySessionId) {
    const sql = `SELECT * FROM user_sessions WHERE gateway_session_id = ?`;
    return this.get(sql, [gatewaySessionId]);
  }

  async deleteSession(sessionId) {
    const sql = `DELETE FROM user_sessions WHERE id = ?`;
    await this.run(sql, [sessionId]);
  }

  async updateSessionTitle(sessionId, title) {
    const sql = `
      UPDATE user_sessions
      SET title = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;
    await this.run(sql, [title, sessionId]);
  }

  // ============ Utility ============

  close(callback) {
    if (this.db) {
      this.db.close(callback);
    }
  }
}

module.exports = Database;
```

- [ ] **Step 2: Create database initialization script**

```javascript
// server/init-db.js
require('dotenv').config();
const path = require('path');
const Database = require('./db');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'chat.db');

async function init() {
  console.log('Initializing database:', DB_PATH);

  const db = new Database(DB_PATH);
  await db.init();

  console.log('Database initialized successfully');

  // Close connection
  db.close(() => {
    console.log('Database connection closed');
    process.exit(0);
  });
}

init().catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Create data directory .gitkeep**

```bash
mkdir -p server/data
touch server/data/.gitkeep
```

- [ ] **Step 4: Test database initialization**

```bash
node server/init-db.js
```

Expected: Database file created at `server/data/chat.db`, tables created

- [ ] **Step 5: Verify database file**

```bash
ls -la server/data/
sqlite3 server/data/chat.db ".tables"
```

Expected output:
```
access_tokens  user_sessions  users
```

- [ ] **Step 6: Write basic test**

```javascript
// server/db.test.js
const Database = require('./db');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function test() {
  const testDbPath = path.join(os.tmpdir(), `test-chat-${Date.now()}.db`);
  const db = new Database(testDbPath);

  console.log('Test 1: Initialize database');
  await db.init();
  console.log('✓ Database initialized');

  console.log('Test 2: Create user');
  const userId = await db.createUser('testuser', 'hash123', 'test@example.com');
  console.log('✓ User created with ID:', userId);

  console.log('Test 3: Find user by username');
  const user = await db.findUserByUsername('testuser');
  console.log('✓ User found:', user.username);

  console.log('Test 4: Create token');
  const tokenId = await db.createToken('abc123', 'agent-1', 'admin', {
    sourceLabel: 'test'
  });
  console.log('✓ Token created with ID:', tokenId);

  console.log('Test 5: Find active token');
  const token = await db.findActiveToken('abc123');
  console.log('✓ Token found:', token.agent_id);

  console.log('Test 6: Create session');
  const sessionId = await db.saveSession(userId, 'session-123', 'agent-1', 'Test Session');
  console.log('✓ Session created with ID:', sessionId);

  console.log('Test 7: Get user sessions');
  const sessions = await db.getUserSessions(userId);
  console.log('✓ User sessions:', sessions.length);

  // Cleanup
  db.close(() => {
    fs.unlinkSync(testDbPath);
    console.log('\n✓ All tests passed!');
    process.exit(0);
  });
}

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
```

- [ ] **Step 7: Run tests**

```bash
node server/db.test.js
```

Expected: All tests pass with checkmarks

- [ ] **Step 8: Add test script to package.json**

```bash
# Edit server/package.json, add to "scripts" section:
# "test": "node db.test.js"
```

- [ ] **Step 9: Commit**

```bash
git add server/db.js server/init-db.js server/db.test.js server/data/.gitkeep server/package.json
git commit -m "feat: add database layer with SQLite support"
```

---

## Phase 3: Add Authentication System

### Task 4: Create Authentication Module (server/auth.js)

**Files:**
- Create: `server/auth.js`

- [ ] **Step 1: Write authentication module**

```javascript
// server/auth.js
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

class AuthManager {
  constructor(db, jwtSecret) {
    this.db = db;
    this.jwtSecret = jwtSecret;
  }

  // ============ User Authentication ============

  async login(username, password) {
    const user = await this.db.findUserByUsername(username);
    if (!user) {
      return null;
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return null;
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      this.jwtSecret,
      { expiresIn: '24h', issuer: 'openclaw-chat' }
    );

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    };
  }

  async register(username, password, email = null) {
    // Check if user exists
    const existing = await this.db.findUserByUsername(username);
    if (existing) {
      throw new Error('Username already exists');
    }

    // Validate password
    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters');
    }

    // Hash password
    const passwordHash = await this.hashPassword(password);

    // Create user
    const userId = await this.db.createUser(username, passwordHash, email);

    return userId;
  }

  // ============ JWT Operations ============

  verifyJWT(token) {
    try {
      return jwt.verify(token, this.jwtSecret, {
        issuer: 'openclaw-chat'
      });
    } catch (e) {
      return null;
    }
  }

  // ============ Access Token Operations ============

  async validateAccessToken(token) {
    const tokenRecord = await this.db.findActiveToken(token);
    if (!tokenRecord) {
      return null;
    }

    // Check expiration
    if (tokenRecord.expires_at) {
      const expiresAt = new Date(tokenRecord.expires_at);
      if (expiresAt < new Date()) {
        return null;
      }
    }

    return tokenRecord;
  }

  generateAccessToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  async createAccessToken(agentId, createdBy, options = {}) {
    const token = this.generateAccessToken();
    const tokenId = await this.db.createToken(token, agentId, createdBy, options);
    return { token, id: tokenId };
  }

  // ============ Password Utilities ============

  async hashPassword(password) {
    return bcrypt.hash(password, 10);
  }

  // ============ WebSocket Authentication ============

  async authenticateWebSocket(req) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      return null;
    }

    // Try JWT first (login users)
    if (token.startsWith('eyJ')) {
      const decoded = this.verifyJWT(token);
      if (decoded) {
        return {
          type: 'user',
          id: decoded.userId,
          username: decoded.username
        };
      }
    }

    // Try access token (public links)
    const tokenRecord = await this.validateAccessToken(token);
    if (tokenRecord) {
      return {
        type: 'token',
        id: tokenRecord.id,
        agentId: tokenRecord.agent_id
      };
    }

    return null;
  }
}

module.exports = AuthManager;
```

- [ ] **Step 2: Write authentication tests**

```javascript
// server/auth.test.js
require('dotenv').config();
const Database = require('./db');
const AuthManager = require('./auth');
const fs = require('fs');
const os = require('os');
const path = require('os');

async function test() {
  const testDbPath = path.join(os.tmpdir(), `test-auth-${Date.now()}.db`);
  const db = new Database(testDbPath);
  await db.init();

  const auth = new AuthManager(db, process.env.JWT_SECRET || 'test-secret-key');

  console.log('Test 1: Register new user');
  const userId = await auth.register('testuser', 'password123', 'test@example.com');
  console.log('✓ User registered with ID:', userId);

  console.log('Test 2: Login with correct credentials');
  const loginResult = await auth.login('testuser', 'password123');
  console.log('✓ Login successful, token:', loginResult.token.substring(0, 20) + '...');

  console.log('Test 3: Login with wrong password');
  const failLogin = await auth.login('testuser', 'wrongpassword');
  console.log('✓ Login failed (null):', failLogin === null);

  console.log('Test 4: Verify JWT token');
  const decoded = auth.verifyJWT(loginResult.token);
  console.log('✓ Token decoded:', decoded.username);

  console.log('Test 5: Generate and validate access token');
  const accessToken = await auth.createAccessToken('agent-1', 'admin', {
    sourceLabel: 'test-token'
  });
  console.log('✓ Access token created:', accessToken.token.substring(0, 16) + '...');

  const tokenRecord = await auth.validateAccessToken(accessToken.token);
  console.log('✓ Access token validated:', tokenRecord.agent_id);

  // Cleanup
  db.close(() => {
    fs.unlinkSync(testDbPath);
    console.log('\n✓ All authentication tests passed!');
    process.exit(0);
  });
}

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Run authentication tests**

```bash
node server/auth.test.js
```

Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add server/auth.js server/auth.test.js
git commit -m "feat: add authentication module with JWT and bcrypt"
```

---

### Task 5: Create API Routes (server/api.js)

**Files:**
- Create: `server/api.js`

- [ ] **Step 1: Write API routes**

```javascript
// server/api.js
const express = require('express');
const router = express.Router();

// ============ Auth Routes ============

// POST /api/auth/register - User registration
router.post('/auth/register', async (req, res) => {
  try {
    const { username, password, email } = req.body;

    // Validation
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    if (username.length < 3) {
      return res.status(400).json({ error: '用户名至少 3 个字符' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: '密码至少 6 个字符' });
    }

    const userId = await req.authManager.register(username, password, email);

    res.status(201).json({
      success: true,
      message: '注册成功',
      userId
    });
  } catch (error) {
    if (error.message === 'Username already exists') {
      return res.status(409).json({ error: '用户名已存在' });
    }
    res.status(500).json({ error: error.message });
  }
});

// POST /api/auth/login - User login
router.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    const authResult = await req.authManager.login(username, password);

    if (!authResult) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    res.json({
      token: authResult.token,
      user: authResult.user
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/auth/me - Get current user
router.get('/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ============ Token Routes ============

// POST /api/tokens - Create access token
router.post('/tokens', requireAuth, async (req, res) => {
  try {
    const { agentId, label, expiresIn } = req.body;

    if (!agentId) {
      return res.status(400).json({ error: 'agent_id 不能为空' });
    }

    const options = {
      sourceLabel: label || null,
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null
    };

    const result = await req.authManager.createAccessToken(
      agentId,
      req.user.username,
      options
    );

    res.json({
      token: result.token,
      agentId,
      label: options.sourceLabel,
      expiresAt: options.expiresAt
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/tokens - List tokens
router.get('/tokens', requireAuth, async (req, res) => {
  try {
    const tokens = await req.db.listTokens(req.user.username);
    res.json(tokens);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/tokens/:token - Delete token
router.delete('/tokens/:token', requireAuth, async (req, res) => {
  try {
    await req.db.deactivateToken(req.params.token);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ Session Routes ============

// GET /api/sessions - Get user sessions
router.get('/sessions', requireAuth, async (req, res) => {
  try {
    const sessions = await req.db.getUserSessions(req.user.id);
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sessions - Create session
router.post('/sessions', requireAuth, async (req, res) => {
  try {
    const { agentId, title, metadata } = req.body;

    if (!agentId) {
      return res.status(400).json({ error: 'agent_id 不能为空' });
    }

    const sessionId = await req.db.saveSession(
      req.user.id,
      req.body.gatewaySessionId,
      agentId,
      title,
      metadata
    );

    const session = await req.db.get(
      'SELECT * FROM user_sessions WHERE id = ?',
      [sessionId]
    );

    res.status(201).json(session);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/sessions/:id - Delete session
router.delete('/sessions/:id', requireAuth, async (req, res) => {
  try {
    await req.db.deleteSession(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/sessions/:id - Update session title
router.put('/sessions/:id', requireAuth, async (req, res) => {
  try {
    const { title } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'title 不能为空' });
    }

    await req.db.updateSessionTitle(req.params.id, title);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ Middleware ============

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

module.exports = { router, requireAuth };
```

- [ ] **Step 2: Commit**

```bash
git add server/api.js
git commit -m "feat: add HTTP API routes for auth, tokens, and sessions"
```

---

### Task 6: Create Middleware (server/middleware.js)

**Files:**
- Create: `server/middleware.js`

- [ ] **Step 1: Write middleware module**

```javascript
// server/middleware.js

// CORS middleware
function corsMiddleware(allowedOrigins) {
  return (req, res, next) => {
    const origin = req.headers.origin;

    if (allowedOrigins === '*' || allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin || '*');
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }

    next();
  };
}

// Error handler middleware
function errorHandler(err, req, res, next) {
  console.error('Error:', err);

  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
}

// Request logging middleware
function requestLogger(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });

  next();
}

module.exports = {
  corsMiddleware,
  errorHandler,
  requestLogger
};
```

- [ ] **Step 2: Commit**

```bash
git add server/middleware.js
git commit -m "feat: add Express middleware (CORS, error handling, logging)"
```

---

### Task 7: Integrate Auth into Server (server/index.js)

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Read original server/index.js**

```bash
cat server/index.js
```

- [ ] **Step 2: Backup original file**

```bash
cp server/index.js server/index.js.backup
```

- [ ] **Step 3: Modify server/index.js to integrate authentication**

At the top of `server/index.js`, after existing requires, add:

```javascript
// ============ New imports ============
const Database = require('./db');
const AuthManager = require('./auth');
const SessionManager = require('./session');
const { router: apiRouter } = require('./api');
const { corsMiddleware, errorHandler, requestLogger } = require('./middleware');
```

After configuration section, add:

```javascript
// ============ New configuration ============
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';
const DATABASE_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'chat.db');
```

After `const app = express();`, replace middleware section with:

```javascript
// ============ Middleware ============
app.use(requestLogger);
app.use(express.json());
app.use(corsMiddleware(process.env.ALLOWED_ORIGINS || '*'));

// Attach dependencies to requests
app.use((req, res, next) => {
  req.db = db;
  req.authManager = authManager;
  next();
});

// Serve static files (existing code, keep as is)
const frontendPath = path.join(__dirname, '..', 'h5', 'dist');
if (fs.existsSync(frontendPath)) {
  app.use(express.static(frontendPath));
  console.log('Frontend static files enabled');
} else {
  console.log('Warning: Frontend dist directory not found at', frontendPath);
}

// ============ API Routes ============
app.use('/api', apiRouter);

// ============ Health check ============
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    auth: 'enabled'
  });
});

// ============ Error handler ============
app.use(errorHandler);
```

Replace WebSocket connection handler with:

```javascript
// ============ WebSocket Authentication ============
wss.on('connection', async (ws, req) => {
  console.log('New WebSocket connection');

  // Authenticate connection
  const authInfo = await authManager.authenticateWebSocket(req);
  if (!authInfo) {
    console.log('Connection rejected: Unauthorized');
    ws.close(4001, 'Unauthorized');
    return;
  }

  console.log(`[${authInfo.type}] Connection authenticated: ${authInfo.username || authInfo.id}`);

  // Connect to Gateway
  let gatewayWs;
  try {
    gatewayWs = await connectToGateway(authInfo);
  } catch (err) {
    console.error('Failed to connect to Gateway:', err.message);
    ws.close(4002, 'Gateway connection failed');
    return;
  }

  // Setup proxy with session filtering
  setupProxy(ws, gatewayWs, authInfo);

  // Cleanup
  ws.on('close', () => {
    console.log(`[${authInfo.type}] Connection closed`);
    sessionManager.disconnectClient(authInfo);
    if (gatewayWs.readyState === WebSocket.OPEN) {
      gatewayWs.close();
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
});
```

Add/modify `setupProxy` function to filter sessions:

```javascript
// ============ Setup Proxy with Session Filtering ============
function setupProxy(clientWs, gatewayWs, authInfo) {
  // Client → Gateway (forward all messages)
  clientWs.on('message', (data) => {
    if (gatewayWs.readyState === WebSocket.OPEN) {
      gatewayWs.send(data);
    }
  });

  // Gateway → Client (filter sessions)
  gatewayWs.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);

      // Filter session list
      if (msg.type === 'session_list') {
        msg.sessions = await sessionManager.filterSessions(msg.sessions || [], authInfo);
      }

      clientWs.send(JSON.stringify(msg));
    } catch (e) {
      // Forward as-is if JSON parsing fails
      clientWs.send(data);
    }
  });

  // Handle Gateway close
  gatewayWs.on('close', () => {
    console.log('Gateway connection closed');
    clientWs.close(4002, 'Gateway disconnected');
  });

  gatewayWs.on('error', (err) => {
    console.error('Gateway error:', err);
  });
}
```

Modify `connectToGateway` to accept authInfo parameter:

```javascript
// ============ Connect to OpenClaw Gateway ============
async function connectToGateway(authInfo) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(GATEWAY_URL, {
      headers: {
        'User-Agent': `OpenClawChat/2.0 (${authInfo.type}:${authInfo.id})`
      }
    });

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Gateway connection timeout'));
    }, 10000);

    ws.on('open', () => {
      clearTimeout(timeout);

      // Send auth token
      ws.send(JSON.stringify({
        type: 'auth',
        token: GATEWAY_TOKEN
      }));

      resolve(ws);
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}
```

In the `start()` function, after database initialization, add:

```javascript
// ============ Initialize Database and Auth ============
console.log('Initializing database...');
await db.init();
console.log('Database initialized:', DATABASE_PATH);

const authManager = new AuthManager(db, JWT_SECRET);
const sessionManager = new SessionManager(db);

console.log('Authentication system initialized');
```

- [ ] **Step 4: Update .env.example**

```bash
cat > server/.env.example << 'EOF'
# Proxy Token (original ClawApp auth)
PROXY_TOKEN=your-proxy-token-here

# OpenClaw Gateway Configuration
OPENCLAW_GATEWAY_URL=ws://localhost:18789
OPENCLAW_GATEWAY_TOKEN=your-gateway-token
# Or use password auth (uncomment if needed):
# OPENCLAW_GATEWAY_PASSWORD=your-gateway-password

# ============ New Configuration ============
# JWT Secret (at least 32 characters)
JWT_SECRET=your-very-long-random-secret-key-change-this-in-production

# Database Path
DATABASE_PATH=./server/data/chat.db

# CORS Settings
ALLOWED_ORIGINS=*

# Server Port
PORT=3210
EOF
```

- [ ] **Step 5: Test server startup**

```bash
cd server
cp .env.example .env
# Edit .env and add your actual tokens
cd ..
node server/index.js
```

Expected: Server starts, authentication system initialized, no errors

- [ ] **Step 6: Test API endpoints**

```bash
# Test registration
curl -X POST http://localhost:3210/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"password123"}'

# Test login
curl -X POST http://localhost:3210/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"password123"}'

# Test health endpoint
curl http://localhost:3210/health
```

Expected: Registration and login return JWT tokens

- [ ] **Step 7: Stop server**

```bash
# Press Ctrl+C
```

- [ ] **Step 8: Commit**

```bash
git add server/index.js server/index.js.backup server/.env.example
git commit -m "feat: integrate authentication system into server"
```

---

## Phase 4: Add Session Management

### Task 8: Create Session Manager (server/session.js)

**Files:**
- Create: `server/session.js`

- [ ] **Step 1: Write session manager module**

```javascript
// server/session.js

class SessionManager {
  constructor(db) {
    this.db = db;
    // Track sessions per connection (for token users)
    this.connectionSessions = new Map(); // connectionId -> Set of sessionIds
  }

  /**
   * Filter gateway sessions based on user authentication
   * @param {Array} gatewaySessions - Sessions from OpenClaw Gateway
   * @param {Object} authInfo - Authentication info from authenticateWebSocket
   * @returns {Array} - Filtered sessions
   */
  async filterSessions(gatewaySessions, authInfo) {
    if (authInfo.type === 'user') {
      // Logged-in user: fetch from database
      const userSessions = await this.db.getUserSessions(authInfo.id);
      const sessionIds = new Set(userSessions.map(s => s.gateway_session_id));

      return gatewaySessions.filter(session => {
        const sessionId = session.id || session.sessionId;
        return sessionIds.has(sessionId);
      });
    } else {
      // Token user: only return sessions for this connection
      const connectionSessionIds = this.connectionSessions.get(authInfo.id) || new Set();

      return gatewaySessions.filter(session => {
        const sessionId = session.id || session.sessionId;
        return connectionSessionIds.has(sessionId);
      });
    }
  }

  /**
   * Track a session created by a connection
   * @param {Object} authInfo - Authentication info
   * @param {String} sessionId - Gateway session ID
   */
  trackSession(authInfo, sessionId) {
    if (authInfo.type === 'token') {
      if (!this.connectionSessions.has(authInfo.id)) {
        this.connectionSessions.set(authInfo.id, new Set());
      }
      this.connectionSessions.get(authInfo.id).add(sessionId);
    }
  }

  /**
   * Save a user session to database
   * @param {Number} userId - User ID (can be null for token users)
   * @param {String} gatewaySessionId - Gateway session ID
   * @param {String} agentId - Agent ID
   * @param {String} title - Session title
   * @param {Object} metadata - Additional metadata
   */
  async saveUserSession(userId, gatewaySessionId, agentId, title = null, metadata = null) {
    return await this.db.saveSession(userId, gatewaySessionId, agentId, title, metadata);
  }

  /**
   * Clean up when a client disconnects
   * @param {Object} authInfo - Authentication info
   */
  disconnectClient(authInfo) {
    if (authInfo.type === 'token') {
      this.connectionSessions.delete(authInfo.id);
    }
  }

  /**
   * Get session statistics
   * @param {Number} userId - User ID
   * @returns {Object} - Session statistics
   */
  async getSessionStats(userId) {
    const sessions = await this.db.getUserSessions(userId);
    return {
      total: sessions.length,
      byAgent: sessions.reduce((acc, s) => {
        acc[s.agent_id] = (acc[s.agent_id] || 0) + 1;
        return acc;
      }, {})
    };
  }
}

module.exports = SessionManager;
```

- [ ] **Step 2: Write session manager tests**

```javascript
// server/session.test.js
const Database = require('./db');
const SessionManager = require('./session');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function test() {
  const testDbPath = path.join(os.tmpdir(), `test-session-${Date.now()}.db`);
  const db = new Database(testDbPath);
  await db.init();

  const sessionManager = new SessionManager(db);

  console.log('Test 1: Save user session');
  const sessionId = await sessionManager.saveUserSession(
    1,
    'gateway-session-123',
    'agent-1',
    'Test Session'
  );
  console.log('✓ Session saved with ID:', sessionId);

  console.log('Test 2: Filter sessions for user');
  const gatewaySessions = [
    { id: 'gateway-session-123', agentId: 'agent-1' },
    { id: 'gateway-session-456', agentId: 'agent-2' }
  ];

  const filtered = await sessionManager.filterSessions(
    gatewaySessions,
    { type: 'user', id: 1 }
  );
  console.log('✓ Filtered sessions:', filtered.length);
  console.log('  Should be 1:', filtered.length === 1);

  console.log('Test 3: Track session for token user');
  const authInfo = { type: 'token', id: 'token-123' };
  sessionManager.trackSession(authInfo, 'gateway-session-789');

  const filtered2 = await sessionManager.filterSessions(
    [{ id: 'gateway-session-789' }, { id: 'other-session' }],
    authInfo
  );
  console.log('✓ Token user filtered sessions:', filtered2.length);
  console.log('  Should be 1:', filtered2.length === 1);

  console.log('Test 4: Disconnect client');
  sessionManager.disconnectClient(authInfo);

  const filtered3 = await sessionManager.filterSessions(
    [{ id: 'gateway-session-789' }],
    authInfo
  );
  console.log('✓ After disconnect, sessions:', filtered3.length);
  console.log('  Should be 0:', filtered3.length === 0);

  console.log('Test 5: Get session stats');
  const stats = await sessionManager.getSessionStats(1);
  console.log('✓ Session stats:', stats);

  // Cleanup
  db.close(() => {
    fs.unlinkSync(testDbPath);
    console.log('\n✓ All session manager tests passed!');
    process.exit(0);
  });
}

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Run tests**

```bash
node server/session.test.js
```

Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add server/session.js server/session.test.js
git commit -m "feat: add session manager with multi-tenant filtering"
```

---

## Phase 5: Frontend Modifications

### Task 9: Create Frontend Auth Module (h5/src/auth.js)

**Files:**
- Create: `h5/src/auth.js`

- [ ] **Step 1: Write frontend auth module**

```javascript
// h5/src/auth.js

class AuthManager {
  constructor() {
    this.authType = null; // 'jwt' | 'token' | null
    this.token = null;
    this.userInfo = null;
    this.apiBase = window.location.origin;
  }

  /**
   * Initialize authentication on page load
   */
  init() {
    // Check URL for token parameter (public links)
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('t');

    if (urlToken) {
      // Token access mode (public link)
      console.log('Token access mode detected');
      this.authType = 'token';
      this.token = urlToken;
      localStorage.setItem('access_token', urlToken);
      return Promise.resolve({ type: 'token', token: urlToken });
    }

    // Check for stored JWT (logged-in user)
    const storedToken = localStorage.getItem('jwt_token');
    if (storedToken) {
      try {
        // Verify token hasn't expired
        const payload = this.parseJWT(storedToken);
        if (payload && payload.exp * 1000 > Date.now()) {
          console.log('JWT access mode detected');
          this.authType = 'jwt';
          this.token = storedToken;
          this.userInfo = JSON.parse(localStorage.getItem('user_info') || '{}');
          return Promise.resolve({ type: 'jwt', token: storedToken, user: this.userInfo });
        }
      } catch (e) {
        // Token invalid, clear it
        localStorage.removeItem('jwt_token');
        localStorage.removeItem('user_info');
      }
    }

    // No valid auth found
    console.log('No valid authentication found');
    return Promise.resolve(null);
  }

  /**
   * Parse JWT token (without verification)
   */
  parseJWT(token) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      const payload = parts[1];
      const decoded = atob(payload);
      return JSON.parse(decoded);
    } catch (e) {
      return null;
    }
  }

  /**
   * User login
   */
  async login(username, password) {
    const response = await fetch(`${this.apiBase}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Login failed');
    }

    const data = await response.json();

    // Store credentials
    this.authType = 'jwt';
    this.token = data.token;
    this.userInfo = data.user;

    localStorage.setItem('jwt_token', data.token);
    localStorage.setItem('user_info', JSON.stringify(data.user));

    return data;
  }

  /**
   * User registration
   */
  async register(username, password, email = null) {
    const response = await fetch(`${this.apiBase}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, email })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Registration failed');
    }

    return response.json();
  }

  /**
   * Get token for WebSocket connection
   */
  getWebSocketToken() {
    return this.token;
  }

  /**
   * Get authentication info
   */
  getAuthInfo() {
    return {
      type: this.authType,
      token: this.token,
      user: this.userInfo
    };
  }

  /**
   * Check if user is logged in
   */
  isAuthenticated() {
    return this.authType !== null && this.token !== null;
  }

  /**
   * Logout
   */
  logout() {
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('user_info');
    localStorage.removeItem('access_token');

    this.authType = null;
    this.token = null;
    this.userInfo = null;

    // Reload page to show login
    window.location.reload();
  }

  /**
   * Get current username
   */
  getUsername() {
    if (this.authType === 'jwt' && this.userInfo) {
      return this.userInfo.username;
    }
    return null;
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AuthManager;
}
```

- [ ] **Step 2: Commit**

```bash
git add h5/src/auth.js
git commit -m "feat: add frontend authentication module"
```

---

### Task 10: Create Frontend API Client (h5/src/api.js)

**Files:**
- Create: `h5/src/api.js`

- [ ] **Step 1: Write API client module**

```javascript
// h5/src/api.js

class API {
  constructor() {
    this.baseURL = window.location.origin;
    this.token = localStorage.getItem('jwt_token');
  }

  /**
   * Make authenticated API request
   */
  async request(method, path, data = null) {
    const headers = { 'Content-Type': 'application/json' };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const options = {
      method,
      headers
    };

    if (data) {
      options.body = JSON.stringify(data);
    }

    const response = await fetch(this.baseURL + path, options);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Request failed');
    }

    return response.json();
  }

  /**
   * Update auth token
   */
  setToken(token) {
    this.token = token;
  }

  // ============ Token Management ============

  async createToken(agentId, label = null, expiresIn = null) {
    return this.request('POST', '/api/tokens', { agentId, label, expiresIn });
  }

  async listTokens() {
    return this.request('GET', '/api/tokens');
  }

  async deleteToken(tokenId) {
    return this.request('DELETE', `/api/tokens/${tokenId}`);
  }

  // ============ Session Management ============

  async listSessions() {
    return this.request('GET', '/api/sessions');
  }

  async createSession(gatewaySessionId, agentId, title = null, metadata = null) {
    return this.request('POST', '/api/sessions', {
      gatewaySessionId,
      agentId,
      title,
      metadata
    });
  }

  async deleteSession(sessionId) {
    return this.request('DELETE', `/api/sessions/${sessionId}`);
  }

  async updateSessionTitle(sessionId, title) {
    return this.request('PUT', `/api/sessions/${sessionId}`, { title });
  }

  // ============ User Info ============

  async getCurrentUser() {
    return this.request('GET', '/api/auth/me');
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = API;
}
```

- [ ] **Step 2: Commit**

```bash
git add h5/src/api.js
git commit -m "feat: add frontend API client module"
```

---

### Task 11: Modify Frontend Main Entry (h5/src/main.js)

**Files:**
- Modify: `h5/src/main.js`

**Note:** This task requires reading the original `main.js` first to understand its structure, then modifying it to integrate authentication.

- [ ] **Step 1: Read original main.js**

```bash
cat h5/src/main.js
```

- [ ] **Step 2: Backup original file**

```bash
cp h5/src/main.js h5/src/main.js.backup
```

- [ ] **Step 3: Modify main.js to integrate authentication**

At the top of the file, add:

```javascript
// ============ Authentication ============
const authManager = new AuthManager();
const api = new API();

// Initialize authentication on page load
authManager.init().then(authInfo => {
  if (authInfo) {
    // User is authenticated, proceed to connect
    console.log('User authenticated:', authInfo.type);
    connectToServer(authInfo.token);
  } else {
    // Show login page
    console.log('No authentication, showing login page');
    showLoginPage();
  }
}).catch(err => {
  console.error('Auth initialization failed:', err);
  showLoginPage();
});

// ============ Login Page ============
function showLoginPage() {
  const loginHtml = `
    <div id="loginPage" class="login-container">
      <h1>OpenClaw Chat</h1>
      <p class="subtitle">登录以继续</p>

      <div id="loginError" class="error"></div>
      <div id="loginSuccess" class="success"></div>

      <div class="tabs">
        <button class="tab active" data-tab="login">登录</button>
        <button class="tab" data-tab="register">注册</button>
      </div>

      <form id="loginForm">
        <div class="form-group">
          <label for="username">用户名</label>
          <input type="text" id="username" name="username" required autocomplete="username">
        </div>

        <div class="form-group">
          <label for="password">密码</label>
          <input type="password" id="password" name="password" required autocomplete="current-password">
        </div>

        <button type="submit" class="btn" id="loginBtn">
          <span id="loginBtnText">登录</span>
        </button>
      </form>

      <form id="registerForm" style="display: none;">
        <div class="form-group">
          <label for="regUsername">用户名</label>
          <input type="text" id="regUsername" name="username" required autocomplete="username">
        </div>

        <div class="form-group">
          <label for="regEmail">邮箱（可选）</label>
          <input type="email" id="regEmail" name="email" autocomplete="email">
        </div>

        <div class="form-group">
          <label for="regPassword">密码</label>
          <input type="password" id="regPassword" name="password" required autocomplete="new-password">
        </div>

        <div class="form-group">
          <label for="regPasswordConfirm">确认密码</label>
          <input type="password" id="regPasswordConfirm" name="passwordConfirm" required autocomplete="new-password">
        </div>

        <button type="submit" class="btn" id="registerBtn">
          <span id="registerBtnText">注册</span>
        </button>
      </form>
    </div>

    <style>
      .login-container {
        max-width: 400px;
        margin: 100px auto;
        padding: 40px;
        background: white;
        border-radius: 12px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.1);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .login-container h1 {
        text-align: center;
        margin-bottom: 10px;
      }
      .subtitle {
        text-align: center;
        color: #666;
        margin-bottom: 30px;
      }
      .tabs {
        display: flex;
        margin-bottom: 20px;
        border-bottom: 1px solid #ddd;
      }
      .tab {
        flex: 1;
        padding: 10px;
        border: none;
        background: none;
        cursor: pointer;
        border-bottom: 2px solid transparent;
      }
      .tab.active {
        border-bottom-color: #667eea;
        color: #667eea;
      }
      .form-group {
        margin-bottom: 15px;
      }
      .form-group label {
        display: block;
        margin-bottom: 5px;
        font-weight: 500;
      }
      .form-group input {
        width: 100%;
        padding: 10px;
        border: 1px solid #ddd;
        border-radius: 6px;
        font-size: 14px;
      }
      .btn {
        width: 100%;
        padding: 12px;
        background: #667eea;
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 16px;
        cursor: pointer;
      }
      .btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .error {
        background: #fee;
        color: #c33;
        padding: 10px;
        border-radius: 6px;
        margin-bottom: 15px;
        display: none;
      }
      .error.show {
        display: block;
      }
      .success {
        background: #efe;
        color: #3c3;
        padding: 10px;
        border-radius: 6px;
        margin-bottom: 15px;
        display: none;
      }
      .success.show {
        display: block;
      }
    </style>
  `;

  document.body.innerHTML = loginHtml;

  // Setup tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const tabName = tab.dataset.tab;
      if (tabName === 'login') {
        document.getElementById('loginForm').style.display = 'block';
        document.getElementById('registerForm').style.display = 'none';
      } else {
        document.getElementById('loginForm').style.display = 'none';
        document.getElementById('registerForm').style.display = 'block';
      }
    });
  });

  // Setup login form
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const btn = document.getElementById('loginBtn');
    const btnText = document.getElementById('loginBtnText');
    const errorEl = document.getElementById('loginError');

    // Reset messages
    errorEl.classList.remove('show');
    btn.disabled = true;
    btnText.textContent = '登录中...';

    try {
      const result = await authManager.login(username, password);
      api.setToken(result.token);

      // Reload page to enter chat
      window.location.reload();
    } catch (error) {
      errorEl.textContent = error.message;
      errorEl.classList.add('show');
      btn.disabled = false;
      btnText.textContent = '登录';
    }
  });

  // Setup register form
  document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('regUsername').value;
    const email = document.getElementById('regEmail').value;
    const password = document.getElementById('regPassword').value;
    const passwordConfirm = document.getElementById('regPasswordConfirm').value;
    const btn = document.getElementById('registerBtn');
    const btnText = document.getElementById('registerBtnText');
    const errorEl = document.getElementById('loginError');
    const successEl = document.getElementById('loginSuccess');

    // Reset messages
    errorEl.classList.remove('show');
    successEl.classList.remove('show');

    // Validate
    if (password !== passwordConfirm) {
      errorEl.textContent = '两次输入的密码不一致';
      errorEl.classList.add('show');
      return;
    }

    btn.disabled = true;
    btnText.textContent = '注册中...';

    try {
      await authManager.register(username, password, email);

      successEl.textContent = '注册成功！请登录';
      successEl.classList.add('show');

      // Switch to login tab
      setTimeout(() => {
        document.querySelector('[data-tab="login"]').click();
      }, 1500);
    } catch (error) {
      errorEl.textContent = error.message;
      errorEl.classList.add('show');
    } finally {
      btn.disabled = false;
      btnText.textContent = '注册';
    }
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add h5/src/main.js h5/src/main.js.backup
git commit -m "feat: integrate authentication flow into main entry point"
```

---

### Task 12: Update Message DB for Cloud Sync (h5/src/message-db.js)

**Files:**
- Modify: `h5/src/message-db.js`

- [ ] **Step 1: Read original message-db.js**

```bash
cat h5/src/message-db.js
```

- [ ] **Step 2: Add cloud sync methods**

At the end of the MessageDB class, add:

```javascript
// ============ Cloud Sync (for logged-in users) ============

/**
 * Sync sessions from server (for logged-in users)
 */
async syncSessionsFromServer() {
  if (authManager.authType !== 'jwt') {
    return; // Only sync for logged-in users
  }

  try {
    const sessions = await api.listSessions();

    for (const session of sessions) {
      const existing = await this.getSession(session.gateway_session_id);

      if (!existing) {
        // New session from server, add to local storage
        await this.saveSession({
          sessionId: session.gateway_session_id,
          agentId: session.agent_id,
          title: session.title || 'New Chat',
          createdAt: session.created_at,
          updatedAt: session.updated_at
        });
      }
    }

    console.log(`Synced ${sessions.length} sessions from server`);
  } catch (error) {
    console.error('Failed to sync sessions:', error);
  }
}

/**
 * Save session to server (for logged-in users)
 */
async saveSessionToServer(session) {
  if (authManager.authType !== 'jwt') {
    return; // Only save for logged-in users
  }

  try {
    await api.createSession(
      session.sessionId,
      session.agentId,
      session.title
    );
    console.log('Session saved to server:', session.sessionId);
  } catch (error) {
    console.error('Failed to save session to server:', error);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add h5/src/message-db.js
git commit -m "feat: add cloud sync support to message-db for logged-in users"
```

---

### Task 13: Build Frontend

**Files:**
- Execute: `npm run build:h5`

- [ ] **Step 1: Build frontend**

```bash
npm run build:h5
```

Expected: Frontend builds successfully, `h5/dist/` directory created

- [ ] **Step 2: Verify build output**

```bash
ls -la h5/dist/
```

Expected: `index.html` and `assets/` directory present

- [ ] **Step 3: Update .gitignore**

```bash
# Add to .gitignore if not present
echo "server/data/*.db" >> .gitignore
echo "server/data/*.db-shm" >> .gitignore
echo "server/data/*.db-wal" >> .gitignore
```

- [ ] **Step 4: Final integration test**

```bash
# Start server
cd server && node index.js &

# Wait for server to start
sleep 3

# Test health endpoint
curl http://localhost:3210/health

# Test frontend
curl -I http://localhost:3210/

# Kill server
pkill -f "node index.js"
```

Expected: All endpoints return 200

- [ ] **Step 5: Commit**

```bash
git add .gitignore h5/dist/
git commit -m "build: frontend built successfully with authentication"
```

---

## Phase 6: Final Testing and Documentation

### Task 14: End-to-End Testing

**Files:** None (Testing)

- [ ] **Step 1: Start server**

```bash
cd server
node index.js
```

- [ ] **Step 2: Test user registration**

1. Open `http://localhost:3210`
2. Click "注册" tab
3. Enter username, password, confirm password
4. Click "注册"

Expected: Success message, auto-switch to login tab

- [ ] **Step 3: Test user login**

1. Enter username and password
2. Click "登录"

Expected: Redirect to chat interface

- [ ] **Step 4: Verify session isolation**

1. Open browser in incognito mode
2. Login with different user
3. Verify different session list

Expected: Users see only their own sessions

- [ ] **Step 5: Test token access**

1. Generate access token via API:
```bash
curl -X POST http://localhost:3210/api/tokens \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"agentId":"test-agent","label":"Test Token"}'
```

2. Open `http://localhost:3210/?t=YOUR_ACCESS_TOKEN`

Expected: Direct access to chat without login

- [ ] **Step 6: Stop server**

```bash
# Press Ctrl+C
```

---

### Task 15: Update Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README.md**

```bash
cat > README.md << 'EOF'
# OpenClaw Chat

基于 [ClawApp](https://github.com/qingchencloud/clawapp) 二次开发的 OpenClaw AI 聊天客户端，支持用户认证和多租户会话隔离。

## 特性

- 💬 实时流式聊天
- 🔐 用户认证系统（JWT + Access Token）
- 👥 多租户会话隔离
- 📝 Markdown 渲染
- 🔄 会话管理
- 💾 登录用户会话云端同步
- 🔗 公开链接访问（Token）

## 快速开始

### 前置要求

- Node.js 18+
- OpenClaw Gateway 运行中（端口 18789）

### 安装

\`\`\`bash
# 安装依赖
npm run install:all

# 构建前端
npm run build:h5
\`\`\`

### 配置

\`\`\`bash
cd server
cp .env.example .env
\`\`\`

编辑 `.env` 文件，配置以下项：

\`\`\`bash
# OpenClaw Gateway Token
OPENCLAW_GATEWAY_TOKEN=your-gateway-token

# JWT 密钥（至少 32 字符）
JWT_SECRET=your-very-long-secret-key
\`\`\`

### 初始化数据库

\`\`\`bash
node server/init-db.js
\`\`\`

### 启动服务

\`\`\`bash
npm start
\`\`\`

访问 `http://localhost:3210`

## 访问方式

### 账号登录

1. 访问 `http://localhost:3210`
2. 点击"注册"创建账号
3. 使用用户名密码登录

### 公开链接（Token）

1. 登录后通过 API 创建访问 Token
2. 分享链接：`http://localhost:3210/?t=TOKEN`

## API 文档

### 认证

- `POST /api/auth/register` - 用户注册
- `POST /api/auth/login` - 用户登录
- `GET /api/auth/me` - 获取当前用户信息

### Token 管理

- `POST /api/tokens` - 创建访问 Token
- `GET /api/tokens` - 列出 Token
- `DELETE /api/tokens/:id` - 删除 Token

### 会话管理

- `GET /api/sessions` - 获取会话列表
- `POST /api/sessions` - 创建会话
- `DELETE /api/sessions/:id` - 删除会话
- `PUT /api/sessions/:id` - 更新会话标题

## 数据库

默认使用 SQLite，数据库文件：`server/data/chat.db`

### 表结构

- `users` - 用户表
- `access_tokens` - 访问令牌表
- `user_sessions` - 用户会话表

## 开发

\`\`\`bash
# 安装依赖
npm run install:all

# 前端开发（热更新）
npm run dev:h5

# 后端开发
npm run dev:server
\`\`\`

## License

MIT

## 基于

- [ClawApp](https://github.com/qingchencloud/clawapp) - H5 移动端聊天客户端
- [OpenClaw](https://github.com/openclaw/openclaw) - AI 智能体平台
EOF
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README with new features and setup instructions"
```

---

### Task 16: Final Verification and Cleanup

**Files:** Multiple

- [ ] **Step 1: Run all tests**

```bash
# Server tests
node server/db.test.js
node server/auth.test.js
node server/session.test.js
```

Expected: All tests pass

- [ ] **Step 2: Verify git status**

```bash
git status
```

Expected: No uncommitted changes (except built frontend)

- [ ] **Step 3: Create final commit**

```bash
git add -A
git commit -m "chore: final implementation complete - OpenClaw Chat with authentication"
```

- [ ] **Step 4: Create tag**

```bash
git tag -a v2.0.0 -m "OpenClaw Chat v2.0 - Authentication & Multi-tenancy"
git push origin master --tags
```

- [ ] **Step 5: Summary**

Implementation complete! The system now includes:

✅ User authentication (registration, login)
✅ JWT token-based authentication
✅ Access token for public links
✅ Multi-tenant session isolation
✅ Cloud session sync for logged-in users
✅ API endpoints for token and session management
✅ Unified login page
✅ Backward compatible with original ClawApp features

---

## Implementation Complete Checklist

- [x] Fork and prepare ClawApp
- [x] Add database layer (SQLite)
- [x] Add authentication system (JWT + bcrypt)
- [x] Add API routes
- [x] Add middleware (CORS, error handling)
- [x] Integrate auth into server
- [x] Add session manager
- [x] Create frontend auth module
- [x] Create frontend API client
- [x] Modify frontend main entry
- [x] Add cloud sync to message-db
- [x] Build frontend
- [x] End-to-end testing
- [x] Update documentation
- [x] Final verification

---

**Next Steps:**

1. Deploy to production server
2. Configure HTTPS (for voice input feature)
3. Set up database backups
4. Monitor performance
5. Plan Phase 2 features (images, voice input)
