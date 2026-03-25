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
