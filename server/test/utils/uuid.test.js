import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateUUID, generateSessionKey } from '../../utils/uuid.js';

describe('UUID Generator', () => {
  it('generateUUID should return valid UUID v4 format', () => {
    const uuid = generateUUID();
    assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('generateUUID should generate unique values', () => {
    const uuids = new Set();
    for (let i = 0; i < 1000; i++) {
      uuids.add(generateUUID());
    }
    assert.strictEqual(uuids.size, 1000);
  });

  it('generateSessionKey should retry on conflict', async () => {
    let attemptCount = 0;
    const mockCheckExists = async (key) => {
      attemptCount++;
      if (attemptCount < 2) return true; // 前1次模拟冲突
      return false;
    };

    const result = await generateSessionKey('test-agent', mockCheckExists, 3);
    assert.match(result, /^agent:test-agent:/);
    assert.strictEqual(attemptCount, 2);
  });

  it('generateSessionKey should throw after max retries', async () => {
    const mockCheckExists = async () => true; // 总是返回冲突

    await assert.rejects(
      async () => generateSessionKey('test-agent', mockCheckExists, 3),
      { message: /Failed to generate unique sessionKey/ }
    );
  });
});
