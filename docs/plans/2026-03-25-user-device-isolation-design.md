# 用户设备隔离设计文档

**日期:** 2026-03-25
**状态:** 已批准
**作者:** Claude

## 问题背景

当前 OpenClaw Chat 代理服务器在连接 Gateway 时，所有用户会话共享同一个 `device.id`。这导致 Agent 无法区分不同用户，可能出现用户 A 的对话内容泄露给用户 B 的严重安全问题。

**根本原因：**
- 所有会话使用全局的 `deviceKey.deviceId`
- 虽然在 `userAgent` 字段中设置了用户信息，但 Agent 优先使用 `device.id` 进行用户识别

## 设计目标

1. **用户隔离:** 每个 JWT 用户和每个 Token 都有独立的 `device.id`
2. **稳定性:** 同一用户/Token 的多次连接使用相同的 `device.id`
3. **协议兼容:** 符合 OpenClaw Gateway 协议的设备身份设计
4. **单设备模式:** 每个用户/Token 只有一个固定的设备身份

## 解决方案

### 1. 数据库 Schema

**users 表扩展：**
```sql
ALTER TABLE users ADD COLUMN device_id TEXT UNIQUE;
ALTER TABLE users ADD COLUMN device_public_key TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN device_private_key_pem TEXT NOT NULL DEFAULT '';
```

**access_tokens 表扩展：**
```sql
ALTER TABLE access_tokens ADD COLUMN device_id TEXT UNIQUE;
ALTER TABLE access_tokens ADD COLUMN device_public_key TEXT NOT NULL DEFAULT '';
ALTER TABLE access_tokens ADD COLUMN device_private_key_pem TEXT NOT NULL DEFAULT '';
```

### 2. 设备密钥生成时机

**JWT 用户：**
- 在用户**注册时**自动生成设备密钥对
- 数据库迁移脚本为现有用户生成密钥

**Token 用户：**
- 在 Token **创建时**自动生成设备密钥对
- 数据库迁移脚本为现有 Token 生成密钥

**密钥生成函数：**
```javascript
function generateDeviceKey() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubRaw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  return {
    deviceId: createHash('sha256').update(pubRaw).digest('hex'),
    publicKey: pubRaw.toString('base64url'),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}
```

### 3. 连接时的密钥使用

**修改 `createConnectFrame` 函数签名：**
```javascript
// 修改前
function createConnectFrame(nonce, username = null, userId = null)

// 修改后
function createConnectFrame(nonce, deviceKey, username = null, userId = null)
```

**不同场景的密钥使用：**

| 场景 | 使用的密钥 | 说明 |
|------|-----------|------|
| JWT 用户会话 | `users.device_private_key_pem` | 从数据库获取用户的设备密钥 |
| Token 用户会话 | `access_tokens.device_private_key_pem` | 从数据库获取 Token 的设备密钥 |
| 后台 operator 连接 | 全局 `deviceKey` | 系统级连接，无用户上下文 |
| Node 连接 | 全局 `nodeDeviceKey` | 系统级连接，用于 system.notify |

**数据库接口：**
```javascript
// server/db.js

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

### 4. 数据迁移策略

由于是新系统且无生产数据，迁移策略简单直接：

**迁移脚本 `server/migrate-device-keys.js`：**
- 为所有现有用户生成设备密钥
- 为所有现有 Token 生成设备密钥
- 记录迁移日志

**启动检查：**
- 服务器启动时检查是否有用户/Token 缺少设备密钥
- 如发现缺失，自动生成并记录警告

## 需要修改的文件

| 文件 | 修改内容 |
|------|----------|
| `server/db.js` | 添加 `getUserDeviceKey()`, `getTokenDeviceKey()` 方法 |
| `server/index.js` | 修改 `createConnectFrame()` 函数签名和实现 |
| `server/index.js` | 修改 `/api/connect` 路由，使用用户的设备密钥 |
| `server/auth.js` | 在注册/创建 Token 时调用 `generateDeviceKey()` |
| `server/migrate-device-keys.js` | 新建迁移脚本 |
| `server/init-db.js` | 更新数据库 schema 定义，添加新字段 |

## 测试验证

### 验证步骤

1. **创建测试用户：**
   - 注册两个不同的用户（user1, user2）
   - 创建两个不同的 Token（token1, token2）

2. **验证设备 ID 不同：**
   - 分别连接两个用户
   - 在 Agent 中执行 `system-presence` 命令
   - 确认显示不同的 `device_id`

3. **验证会话隔离：**
   - user1 发送消息："这是用户 A 的秘密"
   - user2 发送消息："用户 B 能看到吗？"
   - 确认 user2 的对话历史中看不到 user1 的消息

4. **验证重连稳定性：**
   - 断开 user1 连接后重新连接
   - 确认 `device.id` 保持不变

### Agent 验证命令

```javascript
// 在 Agent 中检查当前会话的设备信息
system-presence

// 预期输出示例：
// {
//   "device1": {
//     "deviceId": "abc123...",
//     "roles": ["operator"],
//     "userAgent": "OpenClaw-Mobile-Proxy/1.0.0 [user1(user1_id)]"
//   },
//   "device2": {
//     "deviceId": "def456...",
//     "roles": ["operator"],
//     "userAgent": "OpenClaw-Mobile-Proxy/1.0.0 [user2(user2_id)]"
//   }
// }
```

## 实现计划

下一步：创建详细的实现计划，包括：
1. 数据库迁移脚本的实现
2. 各文件的具体代码修改
3. 测试用例编写

## 参考资料

- [OpenClaw Gateway 协议文档](https://docs.openclaw.ai/zh-CN/gateway/protocol)
- 当前服务器实现：`server/index.js`
- 认证模块：`server/auth.js`
- 数据库模块：`server/db.js`
