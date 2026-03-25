import Database from './db.js';
import { generateDeviceKey } from './device-keys.js';

async function testDeviceIsolation() {
  const db = new Database('./openclaw-chat.db');
  await db.init();

  // 创建两个用户
  const key1 = generateDeviceKey();
  const key2 = generateDeviceKey();

  await db.run(
    'INSERT INTO users (username, password_hash, device_id, device_public_key, device_private_key_pem) VALUES (?, ?, ?, ?, ?)',
    ['alice', 'hash', key1.deviceId, key1.publicKey, key1.privateKeyPem]
  );

  await db.run(
    'INSERT INTO users (username, password_hash, device_id, device_public_key, device_private_key_pem) VALUES (?, ?, ?, ?, ?)',
    ['bob', 'hash', key2.deviceId, key2.publicKey, key2.privateKeyPem]
  );

  // 获取两个用户的 ID
  const alice = await db.findUserByUsername('alice');
  const bob = await db.findUserByUsername('bob');

  // 获取两个用户的设备密钥
  const deviceKey1 = await db.getUserDeviceKey(alice.id);
  const deviceKey2 = await db.getUserDeviceKey(bob.id);

  // 验证设备 ID 不同
  if (deviceKey1.deviceId === deviceKey2.deviceId) {
    throw new Error('Device IDs should be different for different users!');
  }

  console.log('✓ Device isolation test passed');
  console.log(`  Alice device ID: ${deviceKey1.deviceId}`);
  console.log(`  Bob device ID:   ${deviceKey2.deviceId}`);

  // 清理测试数据
  await db.run('DELETE FROM users WHERE username IN (?, ?)', ['alice', 'bob']);

  await db.close();
  process.exit(0);
}

testDeviceIsolation().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
