/**
 * UUID v4 生成器
 * 使用 Node.js crypto.randomUUID()
 */

import crypto from 'crypto';

export function generateUUID() {
  // Node.js 15.6.0+ 支持 crypto.randomUUID()
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // 回退实现（使用 crypto.randomBytes）
  const bytes = crypto.randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // 版本 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // 变体

  const hex = bytes.toString('hex');
  return [
    hex.substr(0, 8),
    hex.substr(8, 4),
    hex.substr(12, 4),
    hex.substr(16, 4),
    hex.substr(20, 12)
  ].join('-');
}

/**
 * 生成带重试机制的会话 Key
 * @param {string} agentName - 智能体名称
 * @param {Function} checkExists - 检查 sessionKey 是否存在的函数
 * @param {number} maxRetries - 最大重试次数，默认 3
 * @returns {Promise<string>} sessionKey
 */
export async function generateSessionKey(agentName, checkExists, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const uuid = generateUUID();
      const sessionKey = `agent:${agentName}:${uuid}`;

      // 检查是否已存在
      const exists = await checkExists(sessionKey);
      if (exists) {
        console.warn(`[UUID] Conflict on attempt ${attempt + 1}, retrying...`);
        continue;
      }

      console.log(`[UUID] Generated sessionKey: ${sessionKey}`);
      return sessionKey;
    } catch (error) {
      console.error(`[UUID] Error on attempt ${attempt + 1}:`, error);
      throw error;
    }
  }

  throw new Error('Failed to generate unique sessionKey after ' + maxRetries + ' attempts');
}
