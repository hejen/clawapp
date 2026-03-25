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

  // 创建测试用户 - 使用 username 而不是 user_id
  const username = 'testuser-123';
  await db.run(
    'INSERT INTO users (username, password_hash) VALUES (?, ?)',
    [username, 'hash']
  );

  // 获取用户 ID
  const user = await db.findUserByUsername(username);
  const userId = user.id;

  // 测试获取不存在的设备密钥
  let key = await db.getUserDeviceKey(userId);
  if (key !== null) {
    throw new Error('Expected null for user without device key');
  }

  // 手动插入设备密钥
  await db.run(
    'UPDATE users SET device_id = ?, device_public_key = ?, device_private_key_pem = ? WHERE id = ?',
    ['device-123', 'pub-key', 'priv-key', userId]
  );

  // 测试获取存在的设备密钥
  key = await db.getUserDeviceKey(userId);
  if (!key || key.deviceId !== 'device-123') {
    throw new Error('Failed to get user device key');
  }

  console.log('✓ getUserDeviceKey works correctly');
  await db.close();
  cleanup();
}

async function testGetTokenDeviceKey() {
  cleanup();
  const db = new Database(TEST_DB_PATH);
  await db.init();

  // 创建测试 token
  const token = 'test-token-abc';
  await db.run(
    'INSERT INTO access_tokens (token, agent_id, created_by) VALUES (?, ?, ?)',
    [token, 'agent-1', 'test-creator']
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
  await db.close();
  cleanup();
}

Promise.all([
  testGetUserDeviceKey(),
  testGetTokenDeviceKey()
]).catch(console.error);
