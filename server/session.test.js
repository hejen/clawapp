import Database from './db.js';
import SessionManager from './session.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';

async function test() {
  const testDbPath = path.join(os.tmpdir(), `test-session-${Date.now()}.db`);
  const db = new Database(testDbPath);
  await db.init();

  const sessionManager = new SessionManager(db);

  console.log('Test 1: Save user session');
  const sessionId = await sessionManager.saveUserSession(
    1,
    'gateway-session-123',
    'agent-1',
    'Test Session'
  );
  assert.ok(sessionId, 'Session ID should be returned');
  console.log('✓ Session saved with ID:', sessionId);

  console.log('Test 2: Filter sessions for user');
  const gatewaySessions = [
    { id: 'gateway-session-123', agentId: 'agent-1' },
    { id: 'gateway-session-456', agentId: 'agent-2' }
  ];

  const filtered = await sessionManager.filterSessions(
    gatewaySessions,
    { type: 'user', id: 1 }
  );
  assert.strictEqual(filtered.length, 1, 'Should filter to 1 session');
  assert.strictEqual(filtered[0].id, 'gateway-session-123', 'Should return the correct session');
  console.log('✓ Filtered sessions:', filtered.length);

  console.log('Test 3: Track session for token user');
  const authInfo = { type: 'token', id: 'token-123' };
  sessionManager.trackSession(authInfo, 'gateway-session-789');

  const filtered2 = await sessionManager.filterSessions(
    [{ id: 'gateway-session-789' }, { id: 'other-session' }],
    authInfo
  );
  assert.strictEqual(filtered2.length, 1, 'Should filter to 1 session for token user');
  assert.strictEqual(filtered2[0].id, 'gateway-session-789', 'Should return the tracked session');
  console.log('✓ Token user filtered sessions:', filtered2.length);

  console.log('Test 4: Disconnect client');
  sessionManager.disconnectClient(authInfo);

  const filtered3 = await sessionManager.filterSessions(
    [{ id: 'gateway-session-789' }],
    authInfo
  );
  assert.strictEqual(filtered3.length, 0, 'Should have 0 sessions after disconnect');
  console.log('✓ After disconnect, sessions:', filtered3.length);

  console.log('Test 5: Get session stats');
  const stats = await sessionManager.getSessionStats(1);
  assert.strictEqual(stats.total, 1, 'Should have 1 total session');
  assert.ok(stats.byAgent['agent-1'], 'Should have stats for agent-1');
  assert.strictEqual(stats.byAgent['agent-1'], 1, 'Should have 1 session for agent-1');
  console.log('✓ Session stats:', stats);

  console.log('Test 6: Validation errors');
  // Test missing authInfo
  try {
    await sessionManager.filterSessions(gatewaySessions, null);
    assert.fail('Should throw error for null authInfo');
  } catch (err) {
    assert.ok(err.message.includes('Invalid authInfo'), 'Should validate authInfo exists');
    console.log('✓ Correctly throws error for null authInfo');
  }

  // Test missing authInfo.type
  try {
    await sessionManager.filterSessions(gatewaySessions, { id: 1 });
    assert.fail('Should throw error for missing authInfo.type');
  } catch (err) {
    assert.ok(err.message.includes('Invalid authInfo'), 'Should validate authInfo.type exists');
    console.log('✓ Correctly throws error for missing authInfo.type');
  }

  // Test missing required parameters in saveUserSession
  try {
    await sessionManager.saveUserSession(1, null, 'agent-1');
    assert.fail('Should throw error for missing gatewaySessionId');
  } catch (err) {
    assert.ok(err.message.includes('gatewaySessionId and agentId are required'), 'Should validate required parameters');
    console.log('✓ Correctly throws error for missing gatewaySessionId');
  }

  try {
    await sessionManager.saveUserSession(1, 'session-123', null);
    assert.fail('Should throw error for missing agentId');
  } catch (err) {
    assert.ok(err.message.includes('gatewaySessionId and agentId are required'), 'Should validate required parameters');
    console.log('✓ Correctly throws error for missing agentId');
  }

  // Test sessions without IDs are filtered out
  const filteredWithoutId = await sessionManager.filterSessions(
    [{ agentId: 'agent-1' }, { id: 'gateway-session-123' }],
    { type: 'user', id: 1 }
  );
  assert.strictEqual(filteredWithoutId.length, 1, 'Should skip sessions without ID');
  console.log('✓ Correctly filters out sessions without ID');

  // Cleanup
  await db.close();
  fs.unlinkSync(testDbPath);
  console.log('\n✓ All session manager tests passed!');
  process.exit(0);
}

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
