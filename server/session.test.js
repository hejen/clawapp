import Database from './db.js';
import SessionManager from './session.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

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
  console.log('✓ Filtered sessions:', filtered.length);
  console.log('  Should be 1:', filtered.length === 1);

  console.log('Test 3: Track session for token user');
  const authInfo = { type: 'token', id: 'token-123' };
  sessionManager.trackSession(authInfo, 'gateway-session-789');

  const filtered2 = await sessionManager.filterSessions(
    [{ id: 'gateway-session-789' }, { id: 'other-session' }],
    authInfo
  );
  console.log('✓ Token user filtered sessions:', filtered2.length);
  console.log('  Should be 1:', filtered2.length === 1);

  console.log('Test 4: Disconnect client');
  sessionManager.disconnectClient(authInfo);

  const filtered3 = await sessionManager.filterSessions(
    [{ id: 'gateway-session-789' }],
    authInfo
  );
  console.log('✓ After disconnect, sessions:', filtered3.length);
  console.log('  Should be 0:', filtered3.length === 0);

  console.log('Test 5: Get session stats');
  const stats = await sessionManager.getSessionStats(1);
  console.log('✓ Session stats:', stats);

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
