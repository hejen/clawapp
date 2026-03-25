import Database from './db.js';
import { unlinkSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const TEST_DB_PATH = join(process.cwd(), 'server', 'test-standalone.db');

function cleanup() {
  try { unlinkSync(TEST_DB_PATH); } catch {}
}

async function testStandaloneExecution() {
  cleanup();

  // 创建测试数据库
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
    ['test-token', 'agent-1', 'creator']
  );

  await db.close();

  // 运行独立迁移脚本
  const { stdout, stderr } = await execAsync('node server/migrate-device-keys.js', {
    env: { ...process.env, DB_PATH: TEST_DB_PATH }
  });

  console.log('Migration output:', stdout);

  // 验证迁移结果
  const db2 = new Database(TEST_DB_PATH);
  await db2.init();

  const user = await db2.get('SELECT * FROM users WHERE username = ?', ['testuser']);
  if (!user.device_id) {
    throw new Error('User device ID not generated');
  }

  const token = await db2.get('SELECT * FROM access_tokens WHERE token = ?', ['test-token']);
  if (!token.device_id) {
    throw new Error('Token device ID not generated');
  }

  await db2.close();

  console.log('✓ Standalone execution works correctly');
  cleanup();
}

testStandaloneExecution().catch(err => {
  console.error('✗ Test failed:', err.message);
  cleanup();
  process.exit(1);
});
