import Database from './db.js';
import AuthManager from './auth.js';
import { unlinkSync } from 'fs';
import { join } from 'path';

const TEST_DB_PATH = 'test-auth-device.db';

function cleanup() {
  try { unlinkSync(TEST_DB_PATH); } catch {}
}

async function testRegisterGeneratesDeviceKey() {
  cleanup();
  const db = new Database(TEST_DB_PATH);
  await db.init();
  const auth = new AuthManager(db, 'test-jwt-secret');

  // 注册用户
  const userId = await auth.register('testuser', 'password123');

  // 获取用户信息，验证设备密钥已生成
  const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);

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

testRegisterGeneratesDeviceKey().catch(err => {
  console.error('✗ Test failed:', err.message);
  cleanup();
  process.exit(1);
});
