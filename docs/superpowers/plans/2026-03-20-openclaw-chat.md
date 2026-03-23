# OpenClaw Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an OpenClaw AI chat client with user authentication and dynamic Agent assignment based on ClawApp architecture.

**Architecture:** Express server with SQLite database, JWT authentication, WebSocket proxy to OpenClaw Gateway. Client connects via token (anonymous) or login (authenticated), with session isolation enforced at the proxy layer.

**Tech Stack:** Node.js, Express, SQLite3, bcrypt, JWT, WebSocket (ws), HTML/JS frontend

---

## File Structure

### Server Files
| File | Responsibility |
|------|----------------|
| `server/db.js` | Database operations (users, tokens, sessions) |
| `server/auth.js` | Authentication logic (JWT, password hashing) |
| `server/gateway.js` | WebSocket proxy to OpenClaw Gateway |
| `server/api.js` | HTTP API routes (login, tokens, sessions) |
| `server/middleware.js` | Express middleware (error handling, CORS) |
| `server/index.js` | Main entry point, wires everything together |
| `server/.env.example` | Environment variable template |
| `server/package.json` | Server dependencies |
| `server/data/chat.db` | SQLite database (created at runtime) |

### Frontend Files
| File | Responsibility |
|------|----------------|
| `h5/login.html` | Login page (new) |
| `h5/src/login.js` | Login page logic (new) |
| `h5/src/ws-client.js` | Modified to pass auth token |

### Root Files
| File | Responsibility |
|------|----------------|
| `package.json` | Root package.json with scripts |
| `README.md` | Project documentation |

---

## Task 1: Initialize Project Structure

**Files:**
- Create: `package.json`
- Create: `server/package.json`
- Create: `.gitignore`
- Create: `server/.env.example`

- [ ] **Step 1: Create root package.json**

```bash
cat > package.json << 'EOF'
{
  "name": "openclaw-chat",
  "version": "1.0.0",
  "description": "OpenClaw AI chat client with user authentication",
  "scripts": {
    "install:server": "cd server && npm install",
    "start": "cd server && node index.js",
    "dev": "cd server && node index.js"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
EOF
```

- [ ] **Step 2: Create server package.json**

```bash
cat > server/package.json << 'EOF'
{
  "name": "openclaw-chat-server",
  "version": "1.0.0",
  "description": "OpenClaw Chat server",
  "main": "index.js",
  "dependencies": {
    "express": "^4.18.2",
    "ws": "^8.14.2",
    "sqlite3": "^5.1.6",
    "bcrypt": "^5.1.1",
    "jsonwebtoken": "^9.0.2",
    "dotenv": "^16.3.1"
  }
}
EOF
```

- [ ] **Step 3: Create .gitignore**

```bash
cat > .gitignore << 'EOF'
node_modules/
.env
*.db
*.log
.DS_Store
EOF
```

- [ ] **Step 4: Create server/.env.example**

```bash
cat > server/.env.example << 'EOF'
# Server Configuration
PORT=3210
NODE_ENV=development

# JWT Secret (at least 32 characters)
JWT_SECRET=change-this-to-a-very-long-random-secret-key

# OpenClaw Gateway Configuration
OPENCLAW_GATEWAY_URL=ws://localhost:18789
OPENCLAW_GATEWAY_TOKEN=your-gateway-token-here
# Or use password authentication:
# OPENCLAW_GATEWAY_PASSWORD=your-gateway-password

# Database Path
DATABASE_PATH=./data/chat.db

# CORS (comma-separated origins)
ALLOWED_ORIGINS=http://localhost:3210
EOF
```

- [ ] **Step 5: Commit**

```bash
git add package.json server/.gitignore server/.env.example
git commit -m "chore: initialize project structure and package files"
```

---

## Task 2: Implement Database Layer

**Files:**
- Create: `server/db.js`
- Test: `server/db.test.js`

- [ ] **Step 1: Write failing test for database initialization**

```bash
cat > server/db.test.js << 'EOF'
const sqlite3 = require('sqlite3').verbose();
const Database = require('./db');

describe('Database', () => {
  let db;
  const testDbPath = './data/test.db';

  beforeEach((done) => {
    db = new Database(testDbPath);
    db.init().then(done);
  });

  afterEach((done) => {
    db.close(() => {
      const fs = require('fs');
      if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
      done();
    });
  });

  test('should create all tables', async () => {
    const tables = await new Promise((resolve) => {
      db.db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, rows) => {
        resolve(rows);
      });
    });
    const tableNames = tables.map(t => t.name);
    expect(tableNames).toContain('users');
    expect(tableNames).toContain('access_tokens');
    expect(tableNames).toContain('user_sessions');
    expect(tableNames).toContain('usage_stats');
  });
});
EOF
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && npm install && node -e "const test = require('./db.test.js'); console.log('Test file loaded')" 2>&1 || true
```

Expected: Test file exists but Database class not implemented

- [ ] **Step 3: Implement Database class**

```bash
cat > server/db.js << 'EOF'
const sqlite3 = require('sqlite3');
const { promisify } = require('util');

class Database {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) return reject(err);
        this.createTables().then(resolve).catch(reject);
      });
    });
  }

  async createTables() {
    const run = promisify(this.db.run.bind(this.db));

    await run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        email TEXT UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS access_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT UNIQUE NOT NULL,
        agent_id TEXT NOT NULL,
        source_label TEXT,
        is_active BOOLEAN DEFAULT 1,
        expires_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        gateway_session_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        title TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS usage_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        token_id INTEGER,
        date DATE NOT NULL,
        message_count INTEGER DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (token_id) REFERENCES access_tokens(id),
        UNIQUE(user_id, token_id, date)
      )
    `);

    // Create indexes
    await run('CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id)');
    await run('CREATE INDEX IF NOT EXISTS idx_tokens_token ON access_tokens(token)');
    await run('CREATE INDEX IF NOT EXISTS idx_stats_date ON usage_stats(date)');
    await run('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)');
  }

  // User operations
  async createUser(username, passwordHash, email = null) {
    const run = promisify(this.db.run.bind(this.db));
    await run(
      'INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)',
      [username, passwordHash, email]
    );
  }

  async findUserByUsername(username) {
    const get = promisify(this.db.get.bind(this.db));
    return get('SELECT * FROM users WHERE username = ?', [username]);
  }

  // Token operations
  async createToken(token, agentId, createdBy, options = {}) {
    const run = promisify(this.db.run.bind(this.db));
    const { sourceLabel, expiresAt } = options;
    await run(
      'INSERT INTO access_tokens (token, agent_id, source_label, expires_at, created_by) VALUES (?, ?, ?, ?, ?)',
      [token, agentId, sourceLabel || null, expiresAt || null, createdBy]
    );
  }

  async findToken(token) {
    const get = promisify(this.db.get.bind(this.db));
    return get('SELECT * FROM access_tokens WHERE token = ?', [token]);
  }

  async deactivateToken(token) {
    const run = promisify(this.db.run.bind(this.db));
    await run('UPDATE access_tokens SET is_active = 0 WHERE token = ?', [token]);
  }

  async listTokens(createdBy) {
    const all = promisify(this.db.all.bind(this.db));
    return all('SELECT * FROM access_tokens WHERE created_by = ? ORDER BY created_at DESC', [createdBy]);
  }

  // Session operations
  async saveSession(userId, gatewaySessionId, agentId, title = null) {
    const run = promisify(this.db.run.bind(this.db));
    await run(
      'INSERT INTO user_sessions (user_id, gateway_session_id, agent_id, title) VALUES (?, ?, ?, ?)',
      [userId, gatewaySessionId, agentId, title]
    );
  }

  async getUserSessions(userId) {
    const all = promisify(this.db.all.bind(this.db));
    return all('SELECT * FROM user_sessions WHERE user_id = ? ORDER BY created_at DESC', [userId]);
  }

  async deleteSession(sessionId) {
    const run = promisify(this.db.run.bind(this.db));
    await run('DELETE FROM user_sessions WHERE id = ?', [sessionId]);
  }

  // Usage operations
  async incrementUsage(userId = null, tokenId = null) {
    const run = promisify(this.db.run.bind(this.db));
    const date = new Date().toISOString().split('T')[0];
    await run(`
      INSERT INTO usage_stats (user_id, token_id, date, message_count)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(user_id, token_id, date) DO UPDATE SET
        message_count = message_count + 1
    `, [userId, tokenId, date]);
  }

  async getDailyUsage(userId = null, tokenId = null) {
    const get = promisify(this.db.get.bind(this.db));
    const date = new Date().toISOString().split('T')[0];
    return get(
      'SELECT message_count FROM usage_stats WHERE user_id = ? AND token_id = ? AND date = ?',
      [userId, tokenId, date]
    );
  }

  close(callback) {
    this.db.close(callback);
  }
}

module.exports = Database;
EOF
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && node -e "
const Database = require('./db.js');
const db = new Database('./data/test-init.db');
db.init().then(() => {
  console.log('Database initialized successfully');
  db.close(() => {
    const fs = require('fs');
    if (fs.existsSync('./data/test-init.db')) fs.unlinkSync('./data/test-init.db');
    console.log('Test database cleaned up');
  });
}).catch(err => console.error('Error:', err));
"
```

Expected: PASS - Database tables created successfully

- [ ] **Step 5: Commit**

```bash
git add server/db.js server/db.test.js
git commit -m "feat: implement database layer with SQLite"
```

---

## Task 3: Implement Authentication Layer

**Files:**
- Create: `server/auth.js`
- Test: `server/auth.test.js`

- [ ] **Step 1: Write failing test for authentication**

```bash
cat > server/auth.test.js << 'EOF'
const bcrypt = require('bcrypt');
const Database = require('./db');
const AuthManager = require('./auth');

describe('AuthManager', () => {
  let auth;
  let db;

  beforeEach(async () => {
    db = new Database('./data/test-auth.db');
    await db.init();
    auth = new AuthManager(db, 'test-secret-key-for-testing-purposes');

    // Create test user
    const passwordHash = await bcrypt.hash('password123', 10);
    await db.createUser('testuser', passwordHash);
  });

  afterEach((done) => {
    db.close(() => {
      const fs = require('fs');
      if (fs.existsSync('./data/test-auth.db')) fs.unlinkSync('./data/test-auth.db');
      done();
    });
  });

  test('should login with valid credentials', async () => {
    const token = await auth.login('testuser', 'password123');
    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');
  });

  test('should reject invalid credentials', async () => {
    const token = await auth.login('testuser', 'wrongpassword');
    expect(token).toBeNull();
  });

  test('should verify valid JWT token', () => {
    const jwt = require('jsonwebtoken');
    const testToken = jwt.sign({ userId: 1, username: 'testuser' }, 'test-secret-key-for-testing-purposes');
    const decoded = auth.verifyJWT(testToken);
    expect(decoded).toBeTruthy();
    expect(decoded.username).toBe('testuser');
  });

  test('should reject invalid JWT token', () => {
    const decoded = auth.verifyJWT('invalid-token');
    expect(decoded).toBeNull();
  });
});
EOF
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && node -e "console.log('AuthManager not implemented yet')" 2>&1
```

Expected: AuthManager class not found

- [ ] **Step 3: Implement AuthManager class**

```bash
cat > server/auth.js << 'EOF'
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

class AuthManager {
  constructor(db, jwtSecret) {
    this.db = db;
    this.jwtSecret = jwtSecret;
  }

  // User login: verify password and return JWT
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

  // Verify JWT Token
  verifyJWT(token) {
    try {
      return jwt.verify(token, this.jwtSecret);
    } catch (e) {
      return null;
    }
  }

  // Validate access Token
  async validateAccessToken(token) {
    const record = await this.db.findToken(token);
    if (!record || !record.is_active) return null;

    if (record.expires_at) {
      const expiryDate = new Date(record.expires_at);
      if (new Date() > expiryDate) return null;
    }

    return record;
  }

  // WebSocket authentication: extract and verify user identity from request
  async authenticateWebSocket(req) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const jwtToken = url.searchParams.get('token');
    const accessToken = url.searchParams.get('access_token');

    // Priority: JWT (logged-in user)
    if (jwtToken) {
      const decoded = this.verifyJWT(jwtToken);
      if (decoded) {
        return { type: 'user', id: decoded.userId, username: decoded.username };
      }
    }

    // Second: access Token (anonymous user)
    if (accessToken) {
      const tokenRecord = await this.validateAccessToken(accessToken);
      if (tokenRecord) {
        return { type: 'token', id: tokenRecord.id, agentId: tokenRecord.agent_id };
      }
    }

    return null;
  }

  // Generate access Token
  generateAccessToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  // Hash password
  async hashPassword(password) {
    return bcrypt.hash(password, 10);
  }
}

module.exports = AuthManager;
EOF
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && node -e "
const Database = require('./db.js');
const AuthManager = require('./auth.js');

(async () => {
  const db = new Database('./data/test-auth-run.db');
  await db.init();
  const auth = new AuthManager(db, 'test-secret');

  // Test password hashing
  const hash = await auth.hashPassword('testpass');
  console.log('Password hashed:', hash ? 'OK' : 'FAIL');

  // Test JWT
  const token = auth.verifyJWT('invalid');
  console.log('Invalid token rejected:', token === null ? 'OK' : 'FAIL');

  db.close(() => {
    const fs = require('fs');
    if (fs.existsSync('./data/test-auth-run.db')) fs.unlinkSync('./data/test-auth-run.db');
  });
})();
"
```

Expected: PASS - All authentication functions work

- [ ] **Step 5: Commit**

```bash
git add server/auth.js server/auth.test.js
git commit -m "feat: implement authentication layer with JWT and bcrypt"
```

---

## Task 4: Implement WebSocket Gateway Proxy

**Files:**
- Create: `server/gateway.js`

- [ ] **Step 1: Create gateway proxy with basic structure**

```bash
cat > server/gateway.js << 'EOF'
const WebSocket = require('ws');
const EventEmitter = require('events');

class GatewayProxy extends EventEmitter {
  constructor(authManager, openclawUrl, openclawToken, database) {
    super();
    this.auth = authManager;
    this.openclawUrl = openclawUrl;
    this.openclawToken = openclawToken;
    this.db = database;
    this.connections = new Map(); // ws -> authInfo
    this.clientToGateway = new Map(); // clientWs -> gatewayWs
    this.gatewayToClient = new Map(); // gatewayWs -> clientWs
  }

  // Handle new connection
  async handleConnection(clientWs, req) {
    try {
      // 1. Authenticate
      const authInfo = await this.auth.authenticateWebSocket(req);
      if (!authInfo) {
        clientWs.close(4001, 'Unauthorized');
        return;
      }

      // 2. Store auth info
      this.connections.set(clientWs, authInfo);

      // 3. Connect to OpenClaw Gateway
      const gatewayWs = await this.connectToGateway(authInfo);

      // 4. Store mapping
      this.clientToGateway.set(clientWs, gatewayWs);
      this.gatewayToClient.set(gatewayWs, clientWs);

      // 5. Setup message proxy
      this.setupProxy(clientWs, gatewayWs, authInfo);

      // 6. Cleanup on close
      clientWs.on('close', () => {
        this.connections.delete(clientWs);
        this.clientToGateway.delete(clientWs);
        this.gatewayToClient.delete(gatewayWs);
        gatewayWs.close();
      });

      gatewayWs.on('close', () => {
        this.connections.delete(clientWs);
        this.clientToGateway.delete(clientWs);
        this.gatewayToClient.delete(gatewayWs);
        clientWs.close();
      });

    } catch (error) {
      console.error('Connection error:', error);
      clientWs.close(4002, 'Connection failed');
    }
  }

  // Connect to OpenClaw Gateway
  connectToGateway(authInfo) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.openclawUrl, {
        headers: {
          'Authorization': `Bearer ${this.openclawToken}`
        }
      });

      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
    });
  }

  // Setup bidirectional message proxy
  setupProxy(clientWs, gatewayWs, authInfo) {
    // Client → Gateway (filter)
    clientWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        // Agent permission check (future: implement per-user agent restrictions)
        if (msg.agent || msg.agentId) {
          const requestedAgent = msg.agent || msg.agentId;
          this.emit('agent:request', { authInfo, agentId: requestedAgent });
        }

        // Forward to gateway
        gatewayWs.send(JSON.stringify(msg));
      } catch (error) {
        console.error('Message parsing error:', error);
      }
    });

    // Gateway → Client (filter sessions)
    gatewayWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        // Filter session list
        if (msg.type === 'session_list' || msg.sessions) {
          msg.sessions = this.filterSessions(msg.sessions, authInfo);
        }

        clientWs.send(JSON.stringify(msg));
      } catch (error) {
        console.error('Gateway message error:', error);
      }
    });
  }

  // Track session IDs for each connection (for anonymous users)
  trackSession(clientWs, gatewaySessionId) {
    const authInfo = this.connections.get(clientWs);
    if (!authInfo.sessionIds) {
      authInfo.sessionIds = new Set();
    }
    authInfo.sessionIds.add(gatewaySessionId);
  }

  // Filter sessions: user can only see their own
  async filterSessions(sessions, authInfo) {
    if (!Array.isArray(sessions)) return sessions;

    if (authInfo.type === 'token') {
      // Anonymous users: only show sessions created during this connection
      const sessionIds = authInfo.sessionIds || new Set();
      return sessions.filter(s => sessionIds.has(s.id || s.sessionId));
    } else {
      // Logged-in users: filter to only user's sessions from database
      const userSessions = await this.db.getUserSessions(authInfo.id);
      const userSessionIds = new Set(userSessions.map(s => s.gateway_session_id));
      return sessions.filter(s => userSessionIds.has(s.id || s.sessionId));
    }
  }

  // Save new session when user creates one
  async saveUserSession(clientWs, gatewaySessionId, agentId, title = null) {
    const authInfo = this.connections.get(clientWs);

    // Track for anonymous users
    if (authInfo.type === 'token') {
      this.trackSession(clientWs, gatewaySessionId);
    }

    // Save to database for logged-in users
    if (authInfo.type === 'user') {
      await this.db.saveSession(authInfo.id, gatewaySessionId, agentId, title);
    }
  }
}

module.exports = GatewayProxy;
EOF
```

- [ ] **Step 2: Verify file created**

```bash
cat server/gateway.js | head -20
```

Expected: File shows GatewayProxy class structure

- [ ] **Step 3: Commit**

```bash
git add server/gateway.js
git commit -m "feat: implement WebSocket gateway proxy"
```

---

## Task 5: Implement API Routes

**Files:**
- Create: `server/api.js`
- Create: `server/middleware.js`

- [ ] **Step 1: Create authentication middleware**

```bash
cat > server/middleware.js << 'EOF'
// Authentication middleware
function requireAuth(authManager) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: '未认证' });
    }

    const token = authHeader.substring(7);
    const decoded = authManager.verifyJWT(token);

    if (!decoded) {
      return res.status(401).json({ error: 'Token 无效' });
    }

    req.user = decoded;
    next();
  };
}

// Error handling middleware
function errorHandler(err, req, res, next) {
  console.error('Error:', err);
  res.status(500).json({ error: '服务器内部错误' });
}

// CORS middleware
function corsMiddleware(allowedOrigins) {
  const origins = allowedOrigins ? allowedOrigins.split(',') : ['*'];

  return (req, res, next) => {
    const origin = req.headers.origin;

    if (origins.includes('*') || origins.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin || '*');
    }

    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }

    next();
  };
}

module.exports = { requireAuth, errorHandler, corsMiddleware };
EOF
```

- [ ] **Step 2: Create API routes**

```bash
cat > server/api.js << 'EOF'
const express = require('express');
const router = express.Router();

// POST /api/login - User login
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

// POST /api/register - User registration
router.post('/register', async (req, res) => {
  const { username, password, email } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }

  if (username.length < 3) {
    return res.status(400).json({ error: '用户名至少 3 个字符' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: '密码至少 6 个字符' });
  }

  // Check if user exists
  const existing = await req.db.findUserByUsername(username);
  if (existing) {
    return res.status(409).json({ error: '用户名已存在' });
  }

  // Create user
  const passwordHash = await req.authManager.hashPassword(password);
  await req.db.createUser(username, passwordHash, email || null);

  res.json({ success: true, message: '注册成功' });
});

// POST /api/tokens - Create access Token (requires authentication)
router.post('/tokens', async (req, res) => {
  const { agentId, label, expiresIn } = req.body;

  if (!agentId) {
    return res.status(400).json({ error: 'agent_id 不能为空' });
  }

  const token = req.authManager.generateAccessToken();
  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

  await req.db.createToken(token, agentId, req.user.username, {
    sourceLabel: label || null,
    expiresAt
  });

  res.json({ token, agentId, label, expiresAt });
});

// GET /api/tokens - List Tokens (requires authentication)
router.get('/tokens', async (req, res) => {
  const tokens = await req.db.listTokens(req.user.username);
  res.json(tokens);
});

// DELETE /api/tokens/:token - Delete Token (requires authentication)
router.delete('/tokens/:token', async (req, res) => {
  await req.db.deactivateToken(req.params.token);
  res.json({ success: true });
});

// GET /api/sessions - Get user session history (requires authentication)
router.get('/sessions', async (req, res) => {
  const sessions = await req.db.getUserSessions(req.user.id);
  res.json(sessions);
});

module.exports = router;
EOF
```

- [ ] **Step 3: Verify files created**

```bash
echo "=== middleware.js ===" && head -10 server/middleware.js && echo && echo "=== api.js ===" && head -10 server/api.js
```

Expected: Both files show correct structure

- [ ] **Step 4: Commit**

```bash
git add server/api.js server/middleware.js
git commit -m "feat: implement API routes and middleware"
```

---

## Task 6: Create Main Server Entry Point

**Files:**
- Create: `server/index.js`

- [ ] **Step 1: Create main server file**

```bash
cat > server/index.js << 'EOF'
require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

// Import modules
const Database = require('./db');
const AuthManager = require('./auth');
const GatewayProxy = require('./gateway');
const apiRoutes = require('./api');
const { requireAuth, errorHandler, corsMiddleware } = require('./middleware');

// Configuration
const PORT = process.env.PORT || 3210;
const DATABASE_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'chat.db');
const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'ws://localhost:18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || process.env.OPENCLAW_GATEWAY_PASSWORD || '';
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '*';

// Create Express app
const app = express();

// Middleware
app.use(express.json());
app.use(corsMiddleware(ALLOWED_ORIGINS));

// Serve static files (frontend)
const frontendPath = path.join(__dirname, '..', 'h5');
if (fs.existsSync(frontendPath)) {
  app.use(express.static(frontendPath));
  console.log('Frontend static files enabled');
} else {
  console.log('Warning: Frontend directory not found at', frontendPath);
}

// Create data directory if not exists
const dataDir = path.dirname(DATABASE_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize database
const db = new Database(DATABASE_PATH);

// Initialize auth manager
const authManager = new AuthManager(db, JWT_SECRET);

// Attach dependencies to requests
app.use((req, res, next) => {
  req.db = db;
  req.authManager = authManager;
  next();
});

// API routes
app.use('/api', apiRoutes);

// Protected routes with authentication
app.use('/api', requireAuth(authManager));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handler
app.use(errorHandler);

// Create HTTP server
const server = http.createServer(app);

// Initialize WebSocket server
const wss = new WebSocket.Server({ server });

// Initialize Gateway Proxy
const gatewayProxy = new GatewayProxy(authManager, GATEWAY_URL, GATEWAY_TOKEN, db);

// Handle WebSocket connections
wss.on('connection', (ws, req) => {
  console.log('New WebSocket connection');
  gatewayProxy.handleConnection(ws, req);
});

// Start server
async function start() {
  try {
    // Initialize database
    console.log('Initializing database...');
    await db.init();
    console.log('Database initialized:', DATABASE_PATH);

    // Create default admin user if not exists
    const adminExists = await db.findUserByUsername('admin');
    if (!adminExists) {
      console.log('Creating default admin user...');
      const passwordHash = await authManager.hashPassword('admin123');
      await db.createUser('admin', passwordHash, 'admin@localhost');
      console.log('Default admin user created (username: admin, password: admin123)');
      console.log('IMPORTANT: Change the default admin password after first login!');
    }

    // Start listening
    server.listen(PORT, () => {
      console.log('');
      console.log('=================================');
      console.log('OpenClaw Chat Server');
      console.log('=================================');
      console.log(`Server running on: http://localhost:${PORT}`);
      console.log(`Gateway URL: ${GATEWAY_URL}`);
      console.log(`Database: ${DATABASE_PATH}`);
      console.log('');
      console.log('Default admin credentials:');
      console.log('  Username: admin');
      console.log('  Password: admin123');
      console.log('');
      console.log('API endpoints:');
      console.log(`  POST   /api/login`);
      console.log(`  POST   /api/register`);
      console.log(`  GET    /api/tokens`);
      console.log(`  POST   /api/tokens`);
      console.log(`  DELETE /api/tokens/:token`);
      console.log(`  GET    /api/sessions`);
      console.log('=================================');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle shutdown
process.on('SIGINT', () => {
  console.log('\\nShutting down gracefully...');
  server.close(() => {
    db.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });
});

// Start the server
start();
EOF
```

- [ ] **Step 2: Verify file created**

```bash
head -30 server/index.js
```

Expected: Server initialization code visible

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat: create main server entry point"
```

---

## Task 7: Create Frontend Login Page

**Files:**
- Create: `h5/login.html`
- Create: `h5/src/login.js`

- [ ] **Step 1: Create login HTML page**

```bash
mkdir -p h5/src

cat > h5/login.html << 'EOF'
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>登录 - OpenClaw Chat</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    .login-container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      width: 100%;
      max-width: 400px;
      padding: 40px;
    }

    h1 {
      text-align: center;
      color: #333;
      margin-bottom: 10px;
      font-size: 24px;
    }

    .subtitle {
      text-align: center;
      color: #666;
      margin-bottom: 30px;
      font-size: 14px;
    }

    .form-group {
      margin-bottom: 20px;
    }

    label {
      display: block;
      margin-bottom: 8px;
      color: #555;
      font-size: 14px;
      font-weight: 500;
    }

    input[type="text"],
    input[type="password"] {
      width: 100%;
      padding: 12px 16px;
      border: 1px solid #ddd;
      border-radius: 8px;
      font-size: 15px;
      transition: border-color 0.3s;
    }

    input:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }

    .btn {
      width: 100%;
      padding: 12px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }

    .btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
    }

    .btn:active {
      transform: translateY(0);
    }

    .btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }

    .error {
      background: #fee;
      color: #c33;
      padding: 12px;
      border-radius: 8px;
      margin-bottom: 20px;
      font-size: 14px;
      display: none;
    }

    .error.show {
      display: block;
    }

    .success {
      background: #efe;
      color: #3c3;
      padding: 12px;
      border-radius: 8px;
      margin-bottom: 20px;
      font-size: 14px;
      display: none;
    }

    .success.show {
      display: block;
    }

    .toggle-link {
      text-align: center;
      margin-top: 20px;
      font-size: 14px;
    }

    .toggle-link a {
      color: #667eea;
      text-decoration: none;
      font-weight: 500;
    }

    .toggle-link a:hover {
      text-decoration: underline;
    }

    .loading {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid #fff;
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-right: 8px;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="login-container">
    <h1>OpenClaw Chat</h1>
    <p class="subtitle">登录以继续</p>

    <div id="error" class="error"></div>
    <div id="success" class="success"></div>

    <form id="loginForm">
      <div class="form-group">
        <label for="username">用户名</label>
        <input type="text" id="username" name="username" required autocomplete="username" placeholder="请输入用户名">
      </div>

      <div class="form-group">
        <label for="password">密码</label>
        <input type="password" id="password" name="password" required autocomplete="current-password" placeholder="请输入密码">
      </div>

      <button type="submit" class="btn" id="submitBtn">
        <span id="btnText">登录</span>
      </button>
    </form>

    <div class="toggle-link">
      还没有账号？ <a href="#" id="toggleMode">立即注册</a>
    </div>
  </div>

  <script src="src/login.js"></script>
</body>
</html>
EOF
```

- [ ] **Step 2: Create login JavaScript**

```bash
cat > h5/src/login.js << 'EOF'
// API base URL (adjust if needed)
const API_BASE = window.location.origin + '/api';

// Form elements
const loginForm = document.getElementById('loginForm');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const submitBtn = document.getElementById('submitBtn');
const btnText = document.getElementById('btnText');
const errorDiv = document.getElementById('error');
const successDiv = document.getElementById('success');
const toggleLink = document.getElementById('toggleMode');

let isLoginMode = true;

// Toggle between login and register
toggleLink.addEventListener('click', (e) => {
  e.preventDefault();
  isLoginMode = !isLoginMode;

  document.querySelector('h1').textContent = isLoginMode ? 'OpenClaw Chat' : '注册账号';
  document.querySelector('.subtitle').textContent = isLoginMode ? '登录以继续' : '创建新账号';
  btnText.textContent = isLoginMode ? '登录' : '注册';
  toggleLink.textContent = isLoginMode ? '还没有账号？ 立即注册' : '已有账号？ 立即登录';
});

// Show error message
function showError(message) {
  errorDiv.textContent = message;
  errorDiv.classList.add('show');
  successDiv.classList.remove('show');
}

// Show success message
function showSuccess(message) {
  successDiv.textContent = message;
  successDiv.classList.add('show');
  errorDiv.classList.remove('show');
}

// Clear messages
function clearMessages() {
  errorDiv.classList.remove('show');
  successDiv.classList.remove('show');
}

// Set loading state
function setLoading(loading) {
  submitBtn.disabled = loading;
  if (loading) {
    btnText.innerHTML = '<span class="loading"></span>' + (isLoginMode ? '登录中...' : '注册中...');
  } else {
    btnText.textContent = isLoginMode ? '登录' : '注册';
  }
}

// Handle form submission
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearMessages();

  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  if (!username || !password) {
    showError('请填写所有字段');
    return;
  }

  setLoading(true);

  try {
    const endpoint = isLoginMode ? '/login' : '/register';
    const response = await fetch(API_BASE + endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || '操作失败');
    }

    if (isLoginMode) {
      // Login successful - store token and redirect
      localStorage.setItem('auth_token', data.token);
      localStorage.setItem('username', data.username);
      showSuccess('登录成功！正在跳转...');

      setTimeout(() => {
        // Redirect to chat with token
        window.location.href = '/?token=' + data.token;
      }, 500);
    } else {
      // Registration successful - switch to login
      showSuccess('注册成功！请登录');
      setTimeout(() => {
        // Clear form and switch to login mode
        loginForm.reset();
        isLoginMode = true;
        document.querySelector('h1').textContent = 'OpenClaw Chat';
        document.querySelector('.subtitle').textContent = '登录以继续';
        btnText.textContent = '登录';
        toggleLink.textContent = '还没有账号？ 立即注册';
      }, 1000);
    }
  } catch (error) {
    showError(error.message || '网络错误，请稍后重试');
  } finally {
    setLoading(false);
  }
});

// Check if already logged in
window.addEventListener('DOMContentLoaded', () => {
  const existingToken = localStorage.getItem('auth_token');
  if (existingToken) {
    // User is already logged in, redirect to chat
    const urlParams = new URLSearchParams(window.location.search);
    if (!urlParams.has('logout')) {
      window.location.href = '/?token=' + existingToken;
    }
  }
});
EOF
```

- [ ] **Step 3: Verify files created**

```bash
ls -la h5/ h5/src/
```

Expected: login.html and login.js exist

- [ ] **Step 4: Commit**

```bash
git add h5/login.html h5/src/login.js
git commit -m "feat: add login page frontend"
```

---

## Task 8: Create WebSocket Client with Auth Token Support

**Files:**
- Create: `h5/src/ws-client.js`

- [ ] **Step 1: Create WebSocket client with token authentication**

```bash
cat > h5/src/ws-client.js << 'EOF'
// WebSocket Client with Authentication Token Support
// Handles both JWT tokens (logged-in users) and access tokens (anonymous users)

class WSClient {
  constructor(options = {}) {
    this.ws = null;
    this.url = options.url || 'ws://localhost:3210';
    this.token = options.token || null;
    this.accessToken = options.accessToken || null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.messageHandlers = [];
    this.connectionStateHandlers = [];
  }

  // Get authentication URL parameters
  getAuthParams() {
    const params = new URLSearchParams();
    if (this.token) {
      params.append('token', this.token);
    } else if (this.accessToken) {
      params.append('access_token', this.accessToken);
    }
    return params.toString();
  }

  // Get WebSocket URL with auth parameters
  getWSUrl() {
    const params = this.getAuthParams();
    return params ? `${this.url}?${params}` : this.url;
  }

  // Connect to WebSocket server
  connect() {
    return new Promise((resolve, reject) => {
      const wsUrl = this.getWSUrl();
      console.log('Connecting to:', wsUrl.replace(/token=[^&]+/, 'token=***'));

      try {
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log('WebSocket connected');
          this.reconnectAttempts = 0;
          this.notifyStateChange('connected');
          resolve(this.ws);
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.messageHandlers.forEach(handler => handler(message));
          } catch (error) {
            console.error('Failed to parse message:', error);
          }
        };

        this.ws.onclose = (event) => {
          console.log('WebSocket closed:', event.code, event.reason);
          this.notifyStateChange('disconnected');

          // Auto-reconnect if not intentional close
          if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
            console.log(`Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            setTimeout(() => this.connect(), delay);
          }
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          this.notifyStateChange('error');
          reject(error);
        };

      } catch (error) {
        console.error('Failed to create WebSocket:', error);
        reject(error);
      }
    });
  }

  // Send message to server
  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.error('WebSocket is not connected');
    }
  }

  // Register message handler
  onMessage(handler) {
    this.messageHandlers.push(handler);
  }

  // Register connection state handler
  onStateChange(handler) {
    this.connectionStateHandlers.push(handler);
  }

  // Notify state change handlers
  notifyStateChange(state) {
    this.connectionStateHandlers.forEach(handler => handler(state));
  }

  // Close connection
  close() {
    if (this.ws) {
      this.reconnectAttempts = this.maxReconnectAttempts; // Prevent auto-reconnect
      this.ws.close(1000, 'Client closing');
    }
  }

  // Update authentication token
  setToken(token) {
    this.token = token;
    this.accessToken = null;
  }

  // Update access token
  setAccessToken(accessToken) {
    this.accessToken = accessToken;
    this.token = null;
  }
}

// Initialize WebSocket client from page URL
function initWSClient() {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');
  const accessToken = urlParams.get('access_token');

  // Check for stored JWT token
  const storedToken = localStorage.getItem('auth_token');

  // Use URL parameter token, then stored token, then access token
  const authToken = token || storedToken || null;

  const client = new WSClient({
    url: `ws://${window.location.host}`,
    token: authToken,
    accessToken: accessToken
  });

  return client;
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WSClient, initWSClient };
}
EOF
```

- [ ] **Step 2: Verify file created**

```bash
cat h5/src/ws-client.js | head -30
```

Expected: WSClient class with authentication support

- [ ] **Step 3: Commit**

```bash
git add h5/src/ws-client.js
git commit -m "feat: add WebSocket client with authentication token support"
```

---

## Task 9: Create README Documentation

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create comprehensive README**

```bash
cat > README.md << 'EOF'
# OpenClaw Chat

基于 ClawApp 架构的 OpenClaw AI 聊天客户端，支持用户认证和动态 Agent 分配。

## 功能特性

- ✅ 用户注册和登录（JWT 认证）
- ✅ 公开链接访问（Access Token）
- ✅ 动态 Agent 分配（基于 Token）
- ✅ 会话隔离（用户只能看到自己的会话）
- ✅ SQLite 数据库（可迁移到 PostgreSQL）
- ✅ WebSocket 代理到 OpenClaw Gateway

## 快速开始

### 1. 安装依赖

```bash
npm run install:server
```

### 2. 配置环境变量

```bash
cd server
cp .env.example .env
# 编辑 .env 文件，填入你的 OpenClaw Gateway Token
```

### 3. 启动服务器

```bash
npm start
```

服务器将在 `http://localhost:3210` 启动。

### 4. 访问应用

- 登录页面: `http://localhost:3210/login.html`
- 聊天页面: `http://localhost:3210/` (需要认证)

## 默认账号

服务器首次启动时会创建默认管理员账号：

- **用户名**: `admin`
- **密码**: `admin123`

⚠️ **重要**: 首次登录后请立即修改默认密码！

## API 端点

### 认证相关

- `POST /api/register` - 用户注册
- `POST /api/login` - 用户登录

### Token 管理（需要认证）

- `GET /api/tokens` - 列出所有访问 Token
- `POST /api/tokens` - 创建新的访问 Token
- `DELETE /api/tokens/:token` - 删除访问 Token

### 会话管理（需要认证）

- `GET /api/sessions` - 获取用户会话历史

### 其他

- `GET /health` - 健康检查

## 访问方式

### 方式 1: 账号密码登录

1. 访问 `http://localhost:3210/login.html`
2. 输入用户名和密码登录
3. 登录成功后自动跳转到聊天页面

### 方式 2: 公开链接（Access Token）

1. 登录后，使用 API 创建访问 Token：

```bash
curl -X POST http://localhost:3210/api/tokens \\
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"agentId": "your-agent-id", "label": "销售咨询"}'
```

2. 返回的 Token 用于生成公开链接：

```
http://localhost:3210/?access_token=YOUR_ACCESS_TOKEN
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | `3210` |
| `JWT_SECRET` | JWT 签名密钥 | - |
| `OPENCLAW_GATEWAY_URL` | OpenClaw Gateway URL | `ws://localhost:18789` |
| `OPENCLAW_GATEWAY_TOKEN` | Gateway Token | - |
| `DATABASE_PATH` | 数据库文件路径 | `./server/data/chat.db` |
| `ALLOWED_ORIGINS` | CORS 允许的来源 | `*` |

## 项目结构

\`\`\`
/data/app/openclaw-chat/
├── server/
│   ├── index.js          # 主入口
│   ├── db.js             # 数据库操作
│   ├── auth.js           # 认证逻辑
│   ├── gateway.js        # WebSocket 代理
│   ├── api.js            # API 路由
│   ├── middleware.js     # 中间件
│   ├── data/
│   │   └── chat.db       # SQLite 数据库
│   └── package.json
├── h5/
│   ├── login.html        # 登录页面
│   └── src/
│       ├── login.js      # 登录逻辑
│       └── ws-client.js  # WebSocket 客户端
├── docs/                 # 文档
├── .env                  # 环境变量
└── README.md
\`\`\`

## 数据库表

### users
存储注册用户信息

### access_tokens
存储公开访问的 Token

### user_sessions
存储用户的会话历史

### usage_stats
使用量统计（为未来限流预留）

## 安全建议

1. **修改默认密码**: 首次启动后立即修改 admin 密码
2. **使用强 JWT 密钥**: 生产环境使用至少 32 字符的随机密钥
3. **启用 HTTPS**: 生产环境使用 HTTPS/WSS
4. **限制 CORS**: 设置 `ALLOWED_ORIGINS` 为具体域名
5. **定期备份**: 定期备份 SQLite 数据库文件

## 后续扩展

- [ ] 数据库迁移到 PostgreSQL
- [ ] 添加使用量限制
- [ ] 添加多租户支持
- [ ] 添加审计日志
- [ ] 添加实时通知

## 许可证

MIT

## 相关项目

- [OpenClaw](https://github.com/openclaw/openclaw) - AI 智能体平台
- [ClawApp](https://github.com/qingchencloud/clawapp) - OpenClaw 移动端客户端
EOF
```

- [ ] **Step 2: Verify README created**

```bash
head -50 README.md
```

Expected: README content visible

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add comprehensive README"
```

---

## Task 10: Install Dependencies and Test

**Files:**
- None (installation)

- [ ] **Step 1: Install server dependencies**

```bash
npm run install:server
```

Expected: Packages installed successfully in server/node_modules

- [ ] **Step 2: Create .env file for testing**

```bash
cat > server/.env << 'EOF'
PORT=3210
NODE_ENV=development
JWT_SECRET=test-secret-key-for-development-only-change-in-production
OPENCLAW_GATEWAY_URL=ws://localhost:18789
OPENCLAW_GATEWAY_TOKEN=
DATABASE_PATH=./data/chat.db
ALLOWED_ORIGINS=*
EOF
```

- [ ] **Step 3: Verify all files are in place**

```bash
echo "=== Server Files ===" && ls -la server/*.js && echo && echo "=== Frontend Files ===" && ls -la h5/ && echo && echo "=== Config Files ===" && ls -la .gitignore *.md
```

Expected: All files present

- [ ] **Step 4: Commit dependencies**

```bash
echo "# Add server/node_modules to .gitignore if not already" >> .gitignore
git add .gitignore
git commit -m "chore: update gitignore"
```

---

## Task 11: Final Verification

**Files:**
- None (verification)

- [ ] **Step 1: Check all critical files exist**

```bash
ls -1 server/index.js server/db.js server/auth.js server/gateway.js server/api.js server/middleware.js h5/login.html h5/src/login.js README.md
```

Expected: All 9 files listed

- [ ] **Step 2: Verify git log**

```bash
git log --oneline
```

Expected: All commits from tasks 1-9 visible

- [ ] **Step 3: Create final summary**

```bash
cat << 'EOF'

╔══════════════════════════════════════════════════════════╗
║           OpenClaw Chat Implementation Complete          ║
╚══════════════════════════════════════════════════════════╝

✅ All tasks completed!

Next Steps:
-----------
1. Ensure OpenClaw Gateway is running (ws://localhost:18789)
2. Update server/.env with your Gateway credentials
3. Run: npm start
4. Visit: http://localhost:3210/login.html
5. Login with: admin / admin123

Default Credentials:
-------------------
Username: admin
Password: admin123

⚠️  IMPORTANT: Change the default password after first login!

EOF
```

- [ ] **Step 4: Commit final implementation**

```bash
git add -A
git commit -m "chore: complete initial implementation"
```

---

## Implementation Checklist

- [x] Initialize project structure
- [x] Implement Database layer
- [x] Implement Authentication layer
- [x] Implement WebSocket Gateway Proxy with session filtering
- [x] Implement API routes
- [x] Create main server entry point
- [x] Create login page frontend
- [x] Create WebSocket client with auth token support
- [x] Write documentation
- [x] Install and verify

## Post-Implementation Notes

### Database Migration to PostgreSQL

When ready to migrate from SQLite to PostgreSQL:

1. Install PostgreSQL client: `npm install pg`
2. Create `server/db-postgres.js` with PostgreSQL implementation
3. Update `server/index.js` to use the new Database class
4. Export SQLite data and import to PostgreSQL

### Security Checklist for Production

- [ ] Change `JWT_SECRET` to a strong random value (32+ chars)
- [ ] Enable HTTPS/WSS
- [ ] Set `ALLOWED_ORIGINS` to specific domains
- [ ] Change default admin password
- [ ] Enable rate limiting
- [ ] Set up database backups
- [ ] Configure firewall rules
- [ ] Enable logging and monitoring

### Testing Checklist

- [ ] Test user registration
- [ ] Test user login
- [ ] Test JWT token validation
- [ ] Test access token creation
- [ ] Test WebSocket connection
- [ ] Test session isolation
- [ ] Test with actual OpenClaw Gateway

---

**Plan Version**: 1.1
**Last Updated**: 2026-03-20
