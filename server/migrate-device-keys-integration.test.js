import Database from './db.js';
import { migrateDeviceKeys } from './migrate-device-keys.js';
import { unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEST_DB_PATH = join(__dirname, 'test-migration-integration.db');

function cleanup() {
  try { unlinkSync(TEST_DB_PATH); } catch {}
}

async function testMigration() {
  cleanup();
  const db = new Database(TEST_DB_PATH);
  await db.init();

  // 创建没有设备密钥的用户
  await db.run(
    'INSERT INTO users (username, password_hash) VALUES (?, ?)',
    ['testuser', 'hash']
  );

  // 创建没有设备密钥的 token
  await db.run(
    'INSERT INTO access_tokens (token, agent_id, created_by) VALUES (?, ?, ?)',
    ['test-token', 'agent-1', 'test-creator']
  );

  // 运行迁移
  await migrateDeviceKeys(db);

  // 验证用户有设备密钥
  const user = await db.get('SELECT * FROM users WHERE username = ?', ['testuser']);
  if (!user.device_id) {
    throw new Error('User device ID not generated');
  }

  // 验证 token 有设备密钥
  const token = await db.get('SELECT * FROM access_tokens WHERE token = ?', ['test-token']);
  if (!token.device_id) {
    throw new Error('Token device ID not generated');
  }

  // 验证可以获取密钥
  const userKey = await db.getUserDeviceKey(user.id);
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

testMigration().catch(err => {
  console.error('✗ Test failed:', err.message);
  cleanup();
  process.exit(1);
});
