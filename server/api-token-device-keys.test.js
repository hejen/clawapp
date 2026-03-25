// server/api-token-device-keys.test.js
import Database from './db.js';
import { unlinkSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEST_DB_PATH = join(__dirname, 'test-token-device.db');

function cleanup() {
  try { unlinkSync(TEST_DB_PATH); } catch {}
}

async function testCreateTokenGeneratesDeviceKey() {
  cleanup();
  const db = new Database(TEST_DB_PATH);
  await db.init();

  // 创建测试用户
  const userId = await db.run(
    'INSERT INTO users (username, password_hash) VALUES (?, ?)',
    ['testuser', 'hash']
  ).then(r => r.lastID);

  // 创建 token - 应该自动生成设备密钥
  const token = 'test-token-' + Date.now();

  try {
    var tokenRecord = await db.createToken(token, 'agent-001', 'testuser', {});
  } catch (error) {
    console.error('Error creating token:', error);
    throw error;
  }

  // 验证 token 有设备密钥
  if (!tokenRecord.device_id) {
    throw new Error('Device ID not set for token');
  }

  if (!tokenRecord.device_public_key) {
    throw new Error('Device public key not set for token');
  }

  if (!tokenRecord.device_private_key_pem) {
    throw new Error('Device private key not set for token');
  }

  // 验证可以获取设备密钥
  const retrievedKey = await db.getTokenDeviceKey(token);
  if (!retrievedKey || retrievedKey.deviceId !== tokenRecord.device_id) {
    throw new Error('Cannot retrieve token device key');
  }

  console.log('✓ Token creation generates device key');
  cleanup();
}

testCreateTokenGeneratesDeviceKey().catch(error => {
  console.error('✗ Test failed:', error.message);
  cleanup();
  process.exit(1);
});
