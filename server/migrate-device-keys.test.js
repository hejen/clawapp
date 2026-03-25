import Database from './db.js';
import { unlinkSync } from 'fs';
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
