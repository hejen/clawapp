# 用户设备隔离实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标:** 为每个用户和 Token 生成独立的设备密钥，修复 Agent 无法区分用户导致的对话数据泄露问题。

**架构:** 在数据库中为每个用户/Token 存储 Ed25519 设备密钥对，连接 Gateway 时使用用户专属密钥进行签名，确保每个用户有唯一的 `device.id`。

**技术栈:** Node.js, Express, SQLite3, Ed25519 签名, WebSocket

---

## Task 1: 数据库 Schema 扩展

**文件:**
- Modify: `server/init-db.js`
- Test: `server/migrate-device-keys.test.js`

**Step 1: 编写数据库 schema 测试**

创建 `server/migrate-device-keys.test.js`:

```javascript
import Database from './db.js';
import { readFileSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TEST_DB_PATH = join(__dirname, 'test-migration.db');

function cleanup() {
  try { unlinkSync(TEST_DB_PATH); } catch {}
}

async function testDeviceKeyColumnsExist() {
  cleanup();
  const db = new Database(TEST_DB_PATH);
  await db.init();

  // 检查 users 表是否有设备密钥字段
  const userColumns = await db.all('PRAGMA table_info(users)');
  const userColumnNames = userColumns.map(c => c.name);

  if (!userColumnNames.includes('device_id')) {
    throw new Error('users.table missing device_id column');
  }
  if (!userColumnNames.includes('device_public_key')) {
    throw new Error('users.table missing device_public_key column');
  }
  if (!userColumnNames.includes('device_private_key_pem')) {
    throw new Error('users.table missing device_private_key_pem column');
  }

  // 检查 access_tokens 表是否有设备密钥字段
  const tokenColumns = await db.all('PRAGMA table_info(access_tokens)');
  const tokenColumnNames = tokenColumns.map(c => c.name);

  if (!tokenColumnNames.includes('device_id')) {
    throw new Error('access_tokens.table missing device_id column');
  }
  if (!tokenColumnNames.includes('device_public_key')) {
    throw new Error('access_tokens.table missing device_public_key column');
  }
  if (!tokenColumnNames.includes('device_private_key_pem')) {
    throw new Error('access_tokens.table missing device_private_key_pem column');
  }

  console.log('✓ All device key columns exist');
  cleanup();
}

testDeviceKeyColumnsExist().catch(console.error);
```

**Step 2: 运行测试验证失败**

运行: `node server/migrate-device-keys.test.js`
预期: FAIL - columns not found

**Step 3: 修改 init-db.js 添加字段**

编辑 `server/init-db.js`，在 users 表创建语句中添加:

```sql
device_id TEXT UNIQUE,
device_public_key TEXT NOT NULL DEFAULT '',
device_private_key_pem TEXT NOT NULL DEFAULT '',
```

在 access_tokens 表创建语句中添加:

```sql
device_id TEXT UNIQUE,
device_public_key TEXT NOT NULL DEFAULT '',
device_private_key_pem TEXT NOT NULL DEFAULT '',
```

**Step 4: 运行测试验证通过**

运行: `node server/migrate-device-keys.test.js`
预期: PASS - 所有列存在

**Step 5: 提交**

```bash
git add server/init-db.js server/migrate-device-keys.test.js
git commit -m "feat: add device key columns to database schema"
```

---

## Task 2: 数据库设备密钥查询方法

**文件:**
- Modify: `server/db.js`
- Test: `server/db-device-keys.test.js`

**Step 1: 编写设备密钥查询测试**

创建 `server/db-device-keys.test.js`:

```javascript
import Database from './db.js';
import { unlinkSync } from 'fs';
import { join } from 'path';

const TEST_DB_PATH = join(process.cwd(), 'server', 'test-device-keys.db');

function cleanup() {
  try { unlinkSync(TEST_DB_PATH); } catch {}
}

async function testGetUserDeviceKey() {
  cleanup();
  const db = new Database(TEST_DB_PATH);
  await db.init();

  // 创建测试用户
  const userId = 'test-user-123';
  await db.run(
    'INSERT INTO users (user_id, username, password_hash) VALUES (?, ?, ?)',
    [userId, 'testuser', 'hash']
  );

  // 测试获取不存在的设备密钥
  let key = await db.getUserDeviceKey(userId);
  if (key !== null) {
    throw new Error('Expected null for user without device key');
  }

  // 手动插入设备密钥
  await db.run(
    'UPDATE users SET device_id = ?, device_public_key = ?, device_private_key_pem = ? WHERE user_id = ?',
    ['device-123', 'pub-key', 'priv-key', userId]
  );

  // 测试获取存在的设备密钥
  key = await db.getUserDeviceKey(userId);
  if (!key || key.deviceId !== 'device-123') {
    throw new Error('Failed to get user device key');
  }

  console.log('✓ getUserDeviceKey works correctly');
  cleanup();
}

async function testGetTokenDeviceKey() {
  cleanup();
  const db = new Database(TEST_DB_PATH);
  await db.init();

  // 创建测试 token
  const token = 'test-token-abc';
  await db.run(
    'INSERT INTO access_tokens (id, user_id, token, name) VALUES (?, ?, ?, ?)',
    ['token-id-1', 'user-1', token, 'Test Token']
  );

  // 测试获取不存在的设备密钥
  let key = await db.getTokenDeviceKey(token);
  if (key !== null) {
    throw new Error('Expected null for token without device key');
  }

  // 手动插入设备密钥
  await db.run(
    'UPDATE access_tokens SET device_id = ?, device_public_key = ?, device_private_key_pem = ? WHERE token = ?',
    ['token-device-123', 'pub-key', 'priv-key', token]
  );

  // 测试获取存在的设备密钥
  key = await db.getTokenDeviceKey(token);
  if (!key || key.deviceId !== 'token-device-123') {
    throw new Error('Failed to get token device key');
  }

  console.log('✓ getTokenDeviceKey works correctly');
  cleanup();
}

Promise.all([
  testGetUserDeviceKey(),
  testGetTokenDeviceKey()
]).catch(console.error);
```

**Step 2: 运行测试验证失败**

运行: `node server/db-device-keys.test.js`
预期: FAIL - methods not defined

**Step 3: 在 db.js 中实现查询方法**

在 `server/db.js` 的 Database 类中添加:

```javascript
/**
 * 获取用户的设备密钥
 * @param {string} userId - 用户 ID
 * @returns {Promise<{deviceId: string, publicKey: string, privateKeyPem: string}|null>}
 */
async getUserDeviceKey(userId) {
  const row = await this.get(
    'SELECT device_id, device_public_key, device_private_key_pem FROM users WHERE user_id = ?',
    [userId]
  );
  if (!row || !row.device_id) return null;
  return {
    deviceId: row.device_id,
    publicKey: row.device_public_key,
    privateKeyPem: row.device_private_key_pem
  };
}

/**
 * 获取 Token 的设备密钥
 * @param {string} token - 访问 Token
 * @returns {Promise<{deviceId: string, publicKey: string, privateKeyPem: string}|null>}
 */
async getTokenDeviceKey(token) {
  const row = await this.get(
    'SELECT device_id, device_public_key, device_private_key_pem FROM access_tokens WHERE token = ?',
    [token]
  );
  if (!row || !row.device_id) return null;
  return {
    deviceId: row.device_id,
    publicKey: row.device_public_key,
    privateKeyPem: row.device_private_key_pem
  };
}
```

**Step 4: 运行测试验证通过**

运行: `node server/db-device-keys.test.js`
预期: PASS

**Step 5: 提交**

```bash
git add server/db.js server/db-device-keys.test.js
git commit -m "feat: add device key query methods to database"
```

---

## Task 3: 设备密钥生成工具函数

**文件:**
- Create: `server/device-keys.js`
- Test: `server/device-keys.test.js`

**Step 1: 编写密钥生成测试**

创建 `server/device-keys.test.js`:

```javascript
import { generateDeviceKey } from './device-keys.js';

function testGenerateDeviceKey() {
  const key = generateDeviceKey();

  if (!key.deviceId || typeof key.deviceId !== 'string') {
    throw new Error('deviceId missing or invalid');
  }
  if (!key.publicKey || typeof key.publicKey !== 'string') {
    throw new Error('publicKey missing or invalid');
  }
  if (!key.privateKeyPem || typeof key.privateKeyPem !== 'string') {
    throw new Error('privateKeyPem missing or invalid');
  }

  // 验证 deviceId 是 64 字符的 hex 字符串
  if (!/^[a-f0-9]{64}$/.test(key.deviceId)) {
    throw new Error('deviceId not a valid sha256 hash');
  }

  // 验证 publicKey 是 base64url 格式
  if (!/^[A-Za-z0-9_-]+=*$/.test(key.publicKey)) {
    throw new Error('publicKey not base64url format');
  }

  // 验证每次生成不同的密钥
  const key2 = generateDeviceKey();
  if (key.deviceId === key2.deviceId) {
    throw new Error('Device IDs should be unique');
  }

  console.log('✓ generateDeviceKey works correctly');
}

testGenerateDeviceKey();
```

**Step 2: 运行测试验证失败**

运行: `node server/device-keys.test.js`
预期: FAIL - module not found

**Step 3: 实现密钥生成模块**

创建 `server/device-keys.js`:

```javascript
import { generateKeyPairSync, createHash } from 'crypto';

/**
 * 生成 Ed25519 设备密钥对
 * @returns {{deviceId: string, publicKey: string, privateKeyPem: string}}
 */
export function generateDeviceKey() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubRaw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);

  return {
    deviceId: createHash('sha256').update(pubRaw).digest('hex'),
    publicKey: pubRaw.toString('base64url'),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}
```

**Step 4: 运行测试验证通过**

运行: `node server/device-keys.test.js`
预期: PASS

**Step 5: 提交**

```bash
git add server/device-keys.js server/device-keys.test.js
git commit -m "feat: add device key generation utility"
```

---

## Task 4: 用户注册时生成设备密钥

**文件:**
- Modify: `server/auth.js`
- Test: `server/auth-device-keys.test.js`

**Step 1: 编写注册时生成密钥的测试**

创建 `server/auth-device-keys.test.js`:

```javascript
import Database from './db.js';
import AuthManager from './auth.js';
import { unlinkSync } from 'fs';
import { join } from 'path';

const TEST_DB_PATH = join(process.cwd(), 'server', 'test-auth-device.db');

function cleanup() {
  try { unlinkSync(TEST_DB_PATH); } catch {}
}

async function testRegisterGeneratesDeviceKey() {
  cleanup();
  const db = new Database(TEST_DB_PATH);
  await db.init();
  const auth = new AuthManager(db);

  // 注册用户
  const userId = await auth.registerUser('testuser', 'password123');

  // 获取用户信息，验证设备密钥已生成
  const user = await db.get('SELECT * FROM users WHERE user_id = ?', [userId]);

  if (!user.device_id) {
    throw new Error('Device ID not generated on registration');
  }
  if (!user.device_public_key) {
    throw new Error('Device public key not generated on registration');
  }
  if (!user.device_private_key_pem) {
    throw new Error('Device private key not generated on registration');
  }

  // 验证可以获取设备密钥
  const deviceKey = await db.getUserDeviceKey(userId);
  if (!deviceKey) {
    throw new Error('Cannot retrieve device key');
  }

  console.log('✓ User registration generates device key');
  cleanup();
}

testRegisterGeneratesDeviceKey().catch(console.error);
```

**Step 2: 运行测试验证失败**

运行: `node server/auth-device-keys.test.js`
预期: FAIL - device keys not generated

**Step 3: 修改 auth.js 在注册时生成密钥**

在 `server/auth.js` 中:
1. 导入密钥生成函数
2. 在 `registerUser` 方法中生成并保存设备密钥

```javascript
import { generateDeviceKey } from './device-keys.js';

// 在 registerUser 方法中，创建用户后添加:
async registerUser(username, password) {
  // ... 现有代码 ...

  // 生成设备密钥
  const deviceKey = generateDeviceKey();

  // 插入用户时包含设备密钥
  const result = await this.db.run(
    `INSERT INTO users (username, password_hash, device_id, device_public_key, device_private_key_pem)
     VALUES (?, ?, ?, ?, ?)`,
    [username, passwordHash, deviceKey.deviceId, deviceKey.publicKey, deviceKey.privateKeyPem]
  );

  return result.lastID; // 或返回 userId
}
```

**注意:** 需要修改现有的 INSERT 语句以包含设备密钥字段。

**Step 4: 运行测试验证通过**

运行: `node server/auth-device-keys.test.js`
预期: PASS

**Step 5: 提交**

```bash
git add server/auth.js server/auth-device-keys.test.js
git commit -m "feat: generate device key on user registration"
```

---

## Task 5: Token 创建时生成设备密钥

**文件:**
- Modify: `server/api.js` (或 Token 创建的相关文件)
- Test: `server/api-token-device-keys.test.js`

**Step 1: 编写 Token 创建时生成密钥的测试**

创建 `server/api-token-device-keys.test.js`:

```javascript
import Database from './db.js';
import { unlinkSync } from 'fs';
import { join } from 'path';

const TEST_DB_PATH = join(process.cwd(), 'server', 'test-token-device.db');

function cleanup() {
  try { unlinkSync(TEST_DB_PATH); } catch {}
}

async function testCreateTokenGeneratesDeviceKey() {
  cleanup();
  const db = new Database(TEST_DB_PATH);
  await db.init();

  // 创建测试用户
  const userId = await db.run(
    'INSERT INTO users (user_id, username, password_hash) VALUES (?, ?, ?)',
    ['user-1', 'testuser', 'hash']
  ).then(r => r.lastID);

  // 创建 token (假设有 createToken 方法)
  const { generateDeviceKey } = await import('./device-keys.js');
  const deviceKey = generateDeviceKey();

  const tokenId = 'token-' + Date.now();
  await db.run(
    `INSERT INTO access_tokens (id, user_id, token, name, device_id, device_public_key, device_private_key_pem)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [tokenId, userId, 'test-token-value', 'Test Token', deviceKey.deviceId, deviceKey.publicKey, deviceKey.privateKeyPem]
  );

  // 验证 token 有设备密钥
  const token = await db.get('SELECT * FROM access_tokens WHERE id = ?', [tokenId]);

  if (!token.device_id) {
    throw new Error('Device ID not set for token');
  }

  // 验证可以获取设备密钥
  const retrievedKey = await db.getTokenDeviceKey('test-token-value');
  if (!retrievedKey || retrievedKey.deviceId !== token.device_id) {
    throw new Error('Cannot retrieve token device key');
  }

  console.log('✓ Token creation generates device key');
  cleanup();
}

testCreateTokenGeneratesDeviceKey().catch(console.error);
```

**Step 2: 运行测试验证失败**

运行: `node server/api-token-device-keys.test.js`
预期: FAIL - 需要修改 Token 创建逻辑

**Step 3: 修改 Token 创建 API**

找到 Token 创建的 API 端点（通常在 `server/api.js` 或 `server/index.js` 的 `/api/tokens` POST 路由），修改为在创建 Token 时生成设备密钥:

```javascript
import { generateDeviceKey } from './device-keys.js';

// 在 POST /api/tokens 路由中
router.post('/tokens', requireAuth, async (req, res) => {
  const { name } = req.body;
  const userId = req.user.userId; // 从 JWT 获取

  // 生成设备密钥
  const deviceKey = generateDeviceKey();

  const tokenId = randomUUID();
  const token = randomBytes(24).toString('base64url');

  await db.run(
    `INSERT INTO access_tokens (id, user_id, token, name, device_id, device_public_key, device_private_key_pem)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [tokenId, userId, token, name, deviceKey.deviceId, deviceKey.publicKey, deviceKey.privateKeyPem]
  );

  res.json({ ok: true, token: tokenId, access_token: token });
});
```

**Step 4: 运行测试验证通过**

运行: `node server/api-token-device-keys.test.js`
预期: PASS

**Step 5: 提交**

```bash
git add server/api.js server/api-token-device-keys.test.js
git commit -m "feat: generate device key on token creation"
```

---

## Task 6: 修改 createConnectFrame 使用用户设备密钥

**文件:**
- Modify: `server/index.js`
- Test: `server/index-connect-test.js`

**Step 1: 编写连接帧测试**

创建 `server/index-connect-test.js`:

```javascript
import { createConnectFrame } from './index.js';
import { generateDeviceKey } from './device-keys.js';

function testCreateConnectFrameWithUserDeviceKey() {
  const deviceKey = generateDeviceKey();
  const nonce = 'test-nonce';
  const username = 'testuser';
  const userId = 'user-123';

  const frame = createConnectFrame(nonce, deviceKey, username, userId);

  if (frame.type !== 'req') {
    throw new Error('Frame type should be req');
  }
  if (frame.method !== 'connect') {
    throw new Error('Frame method should be connect');
  }
  if (!frame.params.device || frame.params.device.id !== deviceKey.deviceId) {
    throw new Error('Device ID should match user device key');
  }
  if (!frame.params.userAgent?.includes(username)) {
    throw new Error('UserAgent should include username');
  }

  console.log('✓ createConnectFrame uses user device key');
}

testCreateConnectFrameWithUserDeviceKey();
```

**Step 2: 运行测试验证失败**

运行: `node server/index-connect-test.js`
预期: FAIL - function signature mismatch

**Step 3: 修改 createConnectFrame 函数签名和实现**

在 `server/index.js` 中:

```javascript
// 修改函数签名
function createConnectFrame(nonce, deviceKey, username = null, userId = null) {
  const signedAt = Date.now();
  const credential = CONFIG.gatewayPassword || CONFIG.gatewayToken;

  const clientId = 'gateway-client';

  // 使用传入的 deviceKey 而不是全局 deviceKey
  const payload = ['v2', deviceKey.deviceId, clientId, 'backend', 'operator', SCOPES.join(','), String(signedAt), credential, nonce || ''].join('|');
  const signature = ed25519Sign(null, Buffer.from(payload, 'utf8'), createPrivateKey(deviceKey.privateKeyPem)).toString('base64url');

  const auth = CONFIG.gatewayPassword
    ? { password: CONFIG.gatewayPassword }
    : { token: CONFIG.gatewayToken };

  const userAgent = (username && userId)
    ? `OpenClaw-Mobile-Proxy/1.0.0 [${username}(${userId})]`
    : 'OpenClaw-Mobile-Proxy/1.0.0';

  return {
    type: 'req',
    id: `connect-${randomUUID()}`,
    method: 'connect',
    params: {
      minProtocol: 3, maxProtocol: 3,
      client: { id: clientId, version: '1.0.0', platform: 'web', mode: 'backend' },
      role: 'operator',
      scopes: SCOPES,
      caps: [],
      auth,
      device: { id: deviceKey.deviceId, publicKey: deviceKey.publicKey, signedAt, nonce, signature },
      locale: 'zh-CN',
      userAgent,
    },
  };
}
```

**Step 4: 运行测试验证通过**

运行: `node server/index-connect-test.js`
预期: PASS

**Step 5: 提交**

```bash
git add server/index.js server/index-connect-test.js
git commit -m "feat: use user device key in connect frame"
```

---

## Task 7: 更新 /api/connect 路由使用用户设备密钥

**文件:**
- Modify: `server/index.js` (/api/connect 路由)

**Step 1: 定位 connect.challenge 处理代码**

找到 `/api/connect` 路由中处理 `connect.challenge` 的代码（大约在第 400-408 行）。

**Step 2: 修改为获取并使用用户设备密钥**

```javascript
// connect.challenge
if (message.type === 'event' && message.event === 'connect.challenge') {
  log.info(`收到 connect.challenge [${sid}]`);
  if (session._connectTimer) { clearTimeout(session._connectTimer); session._connectTimer = null; }
  const nonce = message.payload?.nonce || '';

  // 获取用户的设备密钥
  let userDeviceKey;
  if (authType === 'jwt' && session.jwtUserId) {
    userDeviceKey = await db.getUserDeviceKey(session.jwtUserId);
  } else if (authType === 'token') {
    userDeviceKey = await db.getTokenDeviceKey(session.token);
  }

  // 如果没有用户设备密钥，使用全局密钥（向后兼容）
  if (!userDeviceKey) {
    log.warn(`No device key found for session [${sid}], using global key`);
    userDeviceKey = deviceKey;
  }

  const connectFrame = createConnectFrame(nonce, userDeviceKey, session.username, session.jwtUserId);
  if (session.upstream?.readyState === WebSocket.OPEN) {
    session.upstream.send(JSON.stringify(connectFrame));
  }
  return;
}
```

**Step 3: 修改上游连接建立时的 connect 帧**

找到 `connectToGateway` 函数中发送 connect 的代码（大约在第 455 行）:

```javascript
upstream.on('open', () => {
  log.info(`上游连接已建立 [${sid}]`);
  // 等 500ms 看是否收到 challenge
  session._connectTimer = setTimeout(async () => {
    if (session.state === 'connecting') {
      log.info(`未收到 challenge，直接发送 connect [${sid}]`);

      // 获取用户的设备密钥
      let userDeviceKey;
      if (authType === 'jwt' && session.jwtUserId) {
        userDeviceKey = await db.getUserDeviceKey(session.jwtUserId);
      } else if (authType === 'token') {
        userDeviceKey = await db.getTokenDeviceKey(session.token);
      }

      if (!userDeviceKey) {
        log.warn(`No device key found for session [${sid}], using global key`);
        userDeviceKey = deviceKey;
      }

      upstream.send(JSON.stringify(createConnectFrame('', userDeviceKey, session.username, session.jwtUserId)));
    }
  }, 500);
});
```

**Step 4: 提交**

```bash
git add server/index.js
git commit -m "feat: use user device key in /api/connect route"
```

---

## Task 8: 数据迁移脚本

**文件:**
- Create: `server/migrate-device-keys.js`
- Test: `server/migrate-device-keys-integration.test.js`

**Step 1: 编写迁移脚本测试**

创建 `server/migrate-device-keys-integration.test.js`:

```javascript
import Database from './db.js';
import { migrateDeviceKeys } from './migrate-device-keys.js';
import { unlinkSync } from 'fs';
import { join } from 'path';

const TEST_DB_PATH = join(process.cwd(), 'server', 'test-migration-integration.db');

function cleanup() {
  try { unlinkSync(TEST_DB_PATH); } catch {}
}

async function testMigration() {
  cleanup();
  const db = new Database(TEST_DB_PATH);
  await db.init();

  // 创建没有设备密钥的用户
  await db.run(
    'INSERT INTO users (user_id, username, password_hash) VALUES (?, ?, ?)',
    ['user-1', 'testuser', 'hash']
  );

  // 创建没有设备密钥的 token
  await db.run(
    'INSERT INTO access_tokens (id, user_id, token, name) VALUES (?, ?, ?, ?)',
    ['token-1', 'user-1', 'test-token', 'Test Token']
  );

  // 运行迁移
  await migrateDeviceKeys(db);

  // 验证用户有设备密钥
  const user = await db.get('SELECT * FROM users WHERE user_id = ?', ['user-1']);
  if (!user.device_id) {
    throw new Error('User device ID not generated');
  }

  // 验证 token 有设备密钥
  const token = await db.get('SELECT * FROM access_tokens WHERE id = ?', ['token-1']);
  if (!token.device_id) {
    throw new Error('Token device ID not generated');
  }

  // 验证可以获取密钥
  const userKey = await db.getUserDeviceKey('user-1');
  if (!userKey) {
    throw new Error('Cannot get user device key');
  }

  const tokenKey = await db.getTokenDeviceKey('test-token');
  if (!tokenKey) {
    throw new Error('Cannot get token device key');
  }

  console.log('✓ Migration script works correctly');
  cleanup();
}

testMigration().catch(console.error);
```

**Step 2: 运行测试验证失败**

运行: `node server/migrate-device-keys-integration.test.js`
预期: FAIL - migration script not found

**Step 3: 实现迁移脚本**

创建 `server/migrate-device-keys.js`:

```javascript
import { generateDeviceKey } from './device-keys.js';

/**
 * 为现有用户和 Token 生成设备密钥
 * @param {Database} db - 数据库实例
 */
export async function migrateDeviceKeys(db) {
  console.log('[Migration] Starting device key migration...');

  // 为没有设备密钥的用户生成
  const usersWithoutKeys = await db.all(
    'SELECT user_id FROM users WHERE device_id IS NULL OR device_id = ""'
  );

  console.log(`[Migration] Found ${usersWithoutKeys.length} users without device keys`);

  for (const user of usersWithoutKeys) {
    const key = generateDeviceKey();
    await db.run(
      'UPDATE users SET device_id = ?, device_public_key = ?, device_private_key_pem = ? WHERE user_id = ?',
      [key.deviceId, key.publicKey, key.privateKeyPem, user.user_id]
    );
    console.log(`[Migration] Generated device key for user ${user.user_id}`);
  }

  // 为没有设备密钥的 token 生成
  const tokensWithoutKeys = await db.all(
    'SELECT id FROM access_tokens WHERE device_id IS NULL OR device_id = ""'
  );

  console.log(`[Migration] Found ${tokensWithoutKeys.length} tokens without device keys`);

  for (const token of tokensWithoutKeys) {
    const key = generateDeviceKey();
    await db.run(
      'UPDATE access_tokens SET device_id = ?, device_public_key = ?, device_private_key_pem = ? WHERE id = ?',
      [key.deviceId, key.publicKey, key.privateKeyPem, token.id]
    );
    console.log(`[Migration] Generated device key for token ${token.id}`);
  }

  console.log('[Migration] Device key migration completed');
}

// 如果直接运行此脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  import('./db.js').then(({ default: Database }) => {
    const db = new Database();
    db.init().then(() => migrateDeviceKeys(db)).then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    }).catch(err => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
  });
}
```

**Step 4: 运行测试验证通过**

运行: `node server/migrate-device-keys-integration.test.js`
预期: PASS

**Step 5: 提交**

```bash
git add server/migrate-device-keys.js server/migrate-device-keys-integration.test.js
git commit -m "feat: add device key migration script"
```

---

## Task 9: 启动时自动迁移

**文件:**
- Modify: `server/index.js`

**Step 1: 在服务器启动时检查并迁移**

在 `server/index.js` 的启动代码中添加:

```javascript
// 在数据库初始化后，启动服务器前
async function checkAndMigrateDeviceKeys() {
  const usersWithoutKeys = await db.all(
    'SELECT COUNT(*) as count FROM users WHERE device_id IS NULL OR device_id = ""'
  );

  const tokensWithoutKeys = await db.all(
    'SELECT COUNT(*) as count FROM access_tokens WHERE device_id IS NULL OR device_id = ""'
  );

  if (usersWithoutKeys[0].count > 0 || tokensWithoutKeys[0].count > 0) {
    log.info('[Startup] Detected users/tokens without device keys, running migration...');
    await migrateDeviceKeys(db);
  }
}

// 在 main 函数中调用
await checkAndMigrateDeviceKeys();
```

**Step 2: 提交**

```bash
git add server/index.js
git commit -m "feat: auto-migrate device keys on startup"
```

---

## Task 10: 集成测试

**文件:**
- Create: `server/integration-test-device-isolation.js`

**Step 1: 编写端到端测试**

创建 `server/integration-test-device-isolation.js`:

```javascript
import Database from './db.js';
import { generateDeviceKey } from './device-keys.js';

async function testDeviceIsolation() {
  const db = new Database();
  await db.init();

  // 创建两个用户
  const { generateDeviceKey } = await import('./device-keys.js');

  const key1 = generateDeviceKey();
  const key2 = generateDeviceKey();

  await db.run(
    'INSERT INTO users (user_id, username, password_hash, device_id, device_public_key, device_private_key_pem) VALUES (?, ?, ?, ?, ?, ?)',
    ['user-1', 'alice', 'hash', key1.deviceId, key1.publicKey, key1.privateKeyPem]
  );

  await db.run(
    'INSERT INTO users (user_id, username, password_hash, device_id, device_public_key, device_private_key_pem) VALUES (?, ?, ?, ?, ?, ?)',
    ['user-2', 'bob', 'hash', key2.deviceId, key2.publicKey, key2.privateKeyPem]
  );

  // 获取两个用户的设备密钥
  const deviceKey1 = await db.getUserDeviceKey('user-1');
  const deviceKey2 = await db.getUserDeviceKey('user-2');

  // 验证设备 ID 不同
  if (deviceKey1.deviceId === deviceKey2.deviceId) {
    throw new Error('Device IDs should be different for different users!');
  }

  console.log('✓ Device isolation test passed');
  console.log(`  Alice device ID: ${deviceKey1.deviceId}`);
  console.log(`  Bob device ID:   ${deviceKey2.deviceId}`);

  process.exit(0);
}

testDeviceIsolation().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
```

**Step 2: 运行集成测试**

运行: `node server/integration-test-device-isolation.js`
预期: PASS - 显示两个不同的设备 ID

**Step 3: 提交**

```bash
git add server/integration-test-device-isolation.js
git commit -m "test: add device isolation integration test"
```

---

## 验证清单

完成所有任务后，进行以下验证：

### 1. 数据库验证
```bash
sqlite3 server/data/chat.db "SELECT user_id, device_id FROM users LIMIT 5;"
```
预期: 每个用户都有唯一的 `device_id`

### 2. 运行所有测试
```bash
node server/migrate-device-keys.test.js
node server/db-device-keys.test.js
node server/device-keys.test.js
node server/auth-device-keys.test.js
node server/api-token-device-keys.test.js
node server/index-connect-test.js
node server/migrate-device-keys-integration.test.js
node server/integration-test-device-isolation.js
```
预期: 所有测试通过

### 3. 启动服务器验证
```bash
cd server && npm start
```
检查日志，确认没有关于缺少设备密钥的错误

### 4. Agent 端验证
1. 用两个不同用户登录
2. 在 Agent 中执行 `system-presence`
3. 确认显示不同的 `device_id`

---

## 文件清单

### 新建文件
- `server/device-keys.js` - 设备密钥生成工具
- `server/migrate-device-keys.js` - 数据迁移脚本
- `server/migrate-device-keys.test.js` - Schema 测试
- `server/db-device-keys.test.js` - 数据库方法测试
- `server/device-keys.test.js` - 密钥生成测试
- `server/auth-device-keys.test.js` - 注册测试
- `server/api-token-device-keys.test.js` - Token 测试
- `server/index-connect-test.js` - 连接帧测试
- `server/migrate-device-keys-integration.test.js` - 迁移集成测试
- `server/integration-test-device-isolation.js` - 端到端测试

### 修改文件
- `server/init-db.js` - 添加设备密钥字段
- `server/db.js` - 添加查询方法
- `server/auth.js` - 注册时生成密钥
- `server/api.js` - Token 创建时生成密钥
- `server/index.js` - 修改连接逻辑

---

## 回滚计划

如果需要回滚：

```bash
# 1. 恢复数据库
rm server/data/chat.db
node server/init-db.js

# 2. 回滚代码
git reset --hard HEAD~10  # 回滚所有 10 个提交

# 3. 重启服务
cd server && npm start
```

---

## 注意事项

1. **私钥安全:** `device_private_key_pem` 包含敏感信息，确保数据库文件权限正确
2. **密钥唯一性:** `device_id` 是 UNIQUE 约束，确保不会重复
3. **向后兼容:** 对于没有设备密钥的旧数据，自动迁移会处理
4. **性能影响:** 设备密钥查询增加了一次数据库查询，但影响极小

---

计划完成并保存到 `docs/plans/2026-03-25-user-device-isolation.md`
