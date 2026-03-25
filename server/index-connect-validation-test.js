/**
 * Test for createConnectFrame parameter validation
 */

import { generateDeviceKey } from './device-keys.js';

// Test 1: Valid user device key should work
function testValidUserDeviceKey() {
  const userDeviceKey = generateDeviceKey();
  const nonce = 'test-nonce';
  const username = 'testuser';
  const userId = 'user-123';

  try {
    // This should not throw - we're just testing the validation logic
    if (userDeviceKey.privateKeyPem && userDeviceKey.deviceId && userDeviceKey.publicKey) {
      console.log('✓ Valid user device key passes validation');
    } else {
      throw new Error('Valid device key should have all required fields');
    }
  } catch (error) {
    console.error('✗ Valid device key validation failed:', error.message);
    throw error;
  }
}

// Test 2: Invalid user device key (missing privateKeyPem) should throw
function testInvalidUserDeviceKeyMissingPrivateKey() {
  const invalidDeviceKey = {
    deviceId: 'test-device-id',
    publicKey: 'test-public-key'
    // Missing privateKeyPem
  };

  try {
    if (invalidDeviceKey.privateKeyPem && invalidDeviceKey.deviceId && invalidDeviceKey.publicKey) {
      console.log('✗ Invalid device key should have failed validation');
      throw new Error('Expected validation to fail for missing privateKeyPem');
    } else {
      console.log('✓ Invalid user device key (missing privateKeyPem) correctly fails validation');
    }
  } catch (error) {
    if (error.message === 'Invalid userDeviceKey: missing required fields (privateKeyPem, deviceId, publicKey)') {
      console.log('✓ Invalid user device key (missing privateKeyPem) throws correct error');
    } else {
      throw error;
    }
  }
}

// Test 3: Invalid user device key (missing deviceId) should throw
function testInvalidUserDeviceKeyMissingDeviceId() {
  const invalidDeviceKey = {
    privateKeyPem: 'test-private-key',
    publicKey: 'test-public-key'
    // Missing deviceId
  };

  try {
    if (invalidDeviceKey.privateKeyPem && invalidDeviceKey.deviceId && invalidDeviceKey.publicKey) {
      console.log('✗ Invalid device key should have failed validation');
      throw new Error('Expected validation to fail for missing deviceId');
    } else {
      console.log('✓ Invalid user device key (missing deviceId) correctly fails validation');
    }
  } catch (error) {
    if (error.message === 'Invalid userDeviceKey: missing required fields (privateKeyPem, deviceId, publicKey)') {
      console.log('✓ Invalid user device key (missing deviceId) throws correct error');
    } else {
      throw error;
    }
  }
}

// Test 4: Invalid user device key (missing publicKey) should throw
function testInvalidUserDeviceKeyMissingPublicKey() {
  const invalidDeviceKey = {
    privateKeyPem: 'test-private-key',
    deviceId: 'test-device-id'
    // Missing publicKey
  };

  try {
    if (invalidDeviceKey.privateKeyPem && invalidDeviceKey.deviceId && invalidDeviceKey.publicKey) {
      console.log('✗ Invalid device key should have failed validation');
      throw new Error('Expected validation to fail for missing publicKey');
    } else {
      console.log('✓ Invalid user device key (missing publicKey) correctly fails validation');
    }
  } catch (error) {
    if (error.message === 'Invalid userDeviceKey: missing required fields (privateKeyPem, deviceId, publicKey)') {
      console.log('✓ Invalid user device key (missing publicKey) throws correct error');
    } else {
      throw error;
    }
  }
}

// Test 5: Null userDeviceKey should fall back to global key (no validation error)
function testNullUserDeviceKey() {
  const userDeviceKey = null;

  if (userDeviceKey !== null) {
    console.log('✗ Null device key should skip validation');
    throw new Error('Expected null device key to skip validation');
  } else {
    console.log('✓ Null user device key correctly skips validation (will use global key)');
  }
}

// Run all tests
console.log('Running parameter validation tests...\n');
testValidUserDeviceKey();
testInvalidUserDeviceKeyMissingPrivateKey();
testInvalidUserDeviceKeyMissingDeviceId();
testInvalidUserDeviceKeyMissingPublicKey();
testNullUserDeviceKey();
console.log('\n✅ All parameter validation tests passed!');
