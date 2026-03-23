#!/usr/bin/env node
/**
 * Database module tests for OpenClaw Chat
 * Tests all CRUD operations for users, tokens, and sessions
 */

import { Database } from './db.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test database path
const testDbPath = path.join(__dirname, 'data', 'chat-test.db');

// Clean up test database before running tests
if (fs.existsSync(testDbPath)) {
  fs.unlinkSync(testDbPath);
}

const db = new Database(testDbPath);

let testUserId = null;
let testTokenId = null;
let testSessionId = null;

// Test counter
let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  testsRun++;
  try {
    fn();
    console.log(`✓ ${name}`);
    testsPassed++;
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(`  ${error.message}`);
    testsFailed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

async function runTests() {
  console.log('Running database tests...\n');

  try {
    // Test 1: Database initialization
    await db.init();
    test('Test 1: Database initialization', () => {
      assert(fs.existsSync(testDbPath), 'Database file should exist');
    });

    // Test 2: Create user
    const user = await db.createUser('testuser', 'hash123', 'test@example.com');
    testUserId = user.id;
    test('Test 2: Create user', () => {
      assert(user, 'User should be created');
      assert(user.username === 'testuser', 'Username should match');
      assert(user.email === 'test@example.com', 'Email should match');
    });

    // Test 3: Find user by username
    const foundUser = await db.findUserByUsername('testuser');
    test('Test 3: Find user by username', () => {
      assert(foundUser, 'User should be found');
      assert(foundUser.id === testUserId, 'User ID should match');
    });

    // Test 4: Create and find token
    const token = await db.createToken('test-token-123', 'agent-001', 'system', {
      sourceLabel: 'test',
      expiresAt: null
    });
    testTokenId = token.id;
    test('Test 4: Create token', () => {
      assert(token, 'Token should be created');
      assert(token.token === 'test-token-123', 'Token should match');
      assert(token.agent_id === 'agent-001', 'Agent ID should match');
    });

    const activeToken = await db.findActiveToken('test-token-123');
    test('Test 4b: Find active token', () => {
      assert(activeToken, 'Active token should be found');
      assert(activeToken.id === testTokenId, 'Token ID should match');
      assert(activeToken.is_active === 1, 'Token should be active');
    });

    // Test 5: List tokens
    const tokens = await db.listTokens('agent-001');
    test('Test 5: List tokens', () => {
      assert(Array.isArray(tokens), 'Tokens should be an array');
      assert(tokens.length === 1, 'Should have one token');
      assert(tokens[0].id === testTokenId, 'Token ID should match');
    });

    // Test 6: Save and retrieve session
    const session = await db.saveSession(
      testUserId,
      'gateway-session-123',
      'agent-001',
      'Test Session',
      { model: 'gpt-4o-mini' }
    );
    testSessionId = session.id;
    test('Test 6: Save session', () => {
      assert(session, 'Session should be created');
      assert(session.gateway_session_id === 'gateway-session-123', 'Gateway session ID should match');
      assert(session.agent_id === 'agent-001', 'Agent ID should match');
      assert(session.title === 'Test Session', 'Title should match');
    });

    const userSessions = await db.getUserSessions(testUserId);
    test('Test 6b: Get user sessions', () => {
      assert(Array.isArray(userSessions), 'Sessions should be an array');
      assert(userSessions.length === 1, 'Should have one session');
    });

    // Test 7: Update session title
    const updatedSession = await db.updateSessionTitle(testSessionId, 'Updated Title');
    test('Test 7: Update session title', () => {
      assert(updatedSession, 'Session should be updated');
      assert(updatedSession.title === 'Updated Title', 'Title should be updated');
    });

    // Cleanup
    await db.close();

    // Remove test database
    fs.unlinkSync(testDbPath);

    console.log('\n' + '='.repeat(50));
    console.log(`Tests run: ${testsRun}`);
    console.log(`Tests passed: ${testsPassed}`);
    console.log(`Tests failed: ${testsFailed}`);
    console.log('='.repeat(50));

    if (testsFailed > 0) {
      process.exit(1);
    } else {
      console.log('\n✓ All tests passed!');
      process.exit(0);
    }
  } catch (error) {
    console.error('\n✗ Test suite failed:', error);
    await db.close();
    process.exit(1);
  }
}

runTests();
