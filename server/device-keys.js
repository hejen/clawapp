import { generateKeyPairSync, createHash } from 'crypto';

/**
 * 生成 Ed25519 设备密钥对
 * @returns {{deviceId: string, publicKey: string, privateKeyPem: string}}
 */
export function generateDeviceKey() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubRaw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);

  return {
    deviceId: createHash('sha256').update(pubRaw).digest('hex'),
    publicKey: pubRaw.toString('base64url'),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}
