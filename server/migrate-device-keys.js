import { generateDeviceKey } from './device-keys.js';

/**
 * 为现有用户和 Token 生成设备密钥
 * @param {Database} db - 数据库实例
 */
export async function migrateDeviceKeys(db) {
  console.log('[Migration] Starting device key migration...');

  // 为没有设备密钥的用户生成
  const usersWithoutKeys = await db.all(
    'SELECT id FROM users WHERE device_id IS NULL OR device_id = ""'
  );

  console.log(`[Migration] Found ${usersWithoutKeys.length} users without device keys`);

  for (const user of usersWithoutKeys) {
    const key = generateDeviceKey();
    await db.run(
      'UPDATE users SET device_id = ?, device_public_key = ?, device_private_key_pem = ? WHERE id = ?',
      [key.deviceId, key.publicKey, key.privateKeyPem, user.id]
    );
    console.log(`[Migration] Generated device key for user ${user.id}`);
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
    import('path').then(({ join, dirname }) => {
      const dbPath = process.env.DB_PATH || join(dirname(process.argv[1]), 'data', 'chat.db');
      const db = new Database(dbPath);
      db.init().then(() => migrateDeviceKeys(db)).then(() => {
        console.log('Migration completed successfully');
        process.exit(0);
      }).catch(err => {
        console.error('Migration failed:', err);
        process.exit(1);
      });
    });
  });
}
