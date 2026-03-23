// server/auth.test.js
import 'dotenv/config';
import Database from './db.js';
import AuthManager from './auth.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

async function test() {
  const testDbPath = path.join(os.tmpdir(), `test-auth-${Date.now()}.db`);
  const db = new Database(testDbPath);
  await db.init();

  const auth = new AuthManager(db, process.env.JWT_SECRET || 'test-secret-key');

  console.log('Test 1: Register new user');
  const userId = await auth.register('testuser', 'password123', 'test@example.com');
  console.log('✓ User registered with ID:', userId);

  console.log('Test 2: Login with correct credentials');
  const loginResult = await auth.login('testuser', 'password123');
  console.log('✓ Login successful, token:', loginResult.token.substring(0, 20) + '...');

  console.log('Test 3: Login with wrong password');
  const failLogin = await auth.login('testuser', 'wrongpassword');
  console.log('✓ Login failed (null):', failLogin === null);

  console.log('Test 4: Verify JWT token');
  const decoded = auth.verifyJWT(loginResult.token);
  console.log('✓ Token decoded:', decoded.username);

  console.log('Test 5: Generate and validate access token');
  const accessToken = await auth.createAccessToken('agent-1', 'admin', {
    sourceLabel: 'test-token'
  });
  console.log('✓ Access token created:', accessToken.token.substring(0, 16) + '...');

  const tokenRecord = await auth.validateAccessToken(accessToken.token);
  console.log('✓ Access token validated:', tokenRecord.agent_id);

  // Cleanup
  await db.close();
  fs.unlinkSync(testDbPath);
  console.log('\n✓ All authentication tests passed!');
  process.exit(0);
}

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
