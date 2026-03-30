import sqlite3 from 'sqlite3';
import { generateDeviceKey } from './device-keys.js';

/**
 * Database class for OpenClaw Chat
 * Manages SQLite3 database operations for users, access tokens, and sessions
 */
export class Database {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
  }

  /**
   * Initialize database connection and create tables
   */
  async init() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          reject(err);
        } else {
          this.createTables()
            .then(() => resolve())
            .catch(reject);
        }
      });
    });
  }

  /**
   * Create database tables and indexes
   */
  async createTables() {
    const tables = [
      // Users table
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        email TEXT UNIQUE,
        device_id TEXT UNIQUE,
        device_public_key TEXT NOT NULL DEFAULT '',
        device_private_key_pem TEXT NOT NULL DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Access tokens table
      `CREATE TABLE IF NOT EXISTS access_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT UNIQUE NOT NULL,
        agent_id TEXT NOT NULL,
        source_label TEXT,
        is_active BOOLEAN DEFAULT 1,
        expires_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT,
        device_id TEXT UNIQUE,
        device_public_key TEXT NOT NULL DEFAULT '',
        device_private_key_pem TEXT NOT NULL DEFAULT ''
      )`,

      // User sessions table
      `CREATE TABLE IF NOT EXISTS user_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        gateway_session_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        title TEXT,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,

      // Roles table
      `CREATE TABLE IF NOT EXISTS roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Agents table
      `CREATE TABLE IF NOT EXISTS agents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT,
        enabled BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Agent-Role many-to-many relationship
      `CREATE TABLE IF NOT EXISTS agent_roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id INTEGER NOT NULL,
        role_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
        FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
        UNIQUE(agent_id, role_id)
      )`
    ];

    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_tokens_token ON access_tokens(token)',
      'CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)',
      'CREATE INDEX IF NOT EXISTS idx_agent_roles_agent ON agent_roles(agent_id)',
      'CREATE INDEX IF NOT EXISTS idx_agent_roles_role ON agent_roles(role_id)'
    ];

    try {
      for (const tableSQL of tables) {
        await this.run(tableSQL);
      }
      for (const indexSQL of indexes) {
        await this.run(indexSQL);
      }

      // Migrate existing tables to add device key columns
      await this.migrateSchema();
    } catch (error) {
      throw new Error(`Failed to create tables: ${error.message}`);
    }
  }

  /**
   * Migrate existing database schema to add device key columns
   */
  async migrateSchema() {
    try {
      // Check if users table needs migration
      const usersTableInfo = await this.all("PRAGMA table_info(users)");
      const hasUsersDeviceId = usersTableInfo.some(col => col.name === 'device_id');

      if (!hasUsersDeviceId) {
        console.log('[DB Migration] Adding device key columns to users table...');
        await this.run('ALTER TABLE users ADD COLUMN device_id TEXT');
        await this.run('ALTER TABLE users ADD COLUMN device_public_key TEXT NOT NULL DEFAULT ""');
        await this.run('ALTER TABLE users ADD COLUMN device_private_key_pem TEXT NOT NULL DEFAULT ""');
        console.log('[DB Migration] Users table migrated successfully');
      }

      // Check if access_tokens table needs migration
      const tokensTableInfo = await this.all("PRAGMA table_info(access_tokens)");
      const hasTokensDeviceId = tokensTableInfo.some(col => col.name === 'device_id');

      if (!hasTokensDeviceId) {
        console.log('[DB Migration] Adding device key columns to access_tokens table...');
        await this.run('ALTER TABLE access_tokens ADD COLUMN device_id TEXT');
        await this.run('ALTER TABLE access_tokens ADD COLUMN device_public_key TEXT NOT NULL DEFAULT ""');
        await this.run('ALTER TABLE access_tokens ADD COLUMN device_private_key_pem TEXT NOT NULL DEFAULT ""');
        console.log('[DB Migration] Access tokens table migrated successfully');
      }

      // Add role_id to users table
      const hasUsersRoleId = usersTableInfo.some(col => col.name === 'role_id');

      if (!hasUsersRoleId) {
        console.log('[DB Migration] Adding role_id to users table...');
        await this.run('ALTER TABLE users ADD COLUMN role_id INTEGER');
        console.log('[DB Migration] Users role_id column added');
      }
    } catch (error) {
      // If column already exists, SQLite will throw an error, which we can ignore
      if (!error.message.includes('duplicate column name')) {
        console.error('[DB Migration] Schema migration error:', error.message);
        throw new Error(`Failed to migrate schema: ${error.message}`);
      }
    }
  }

  /**
   * Initialize RBAC seed data
   */
  async initializeRBACData() {
    try {
      // Check if already initialized
      const roleCount = await this.get('SELECT COUNT(*) as count FROM roles');
      if (roleCount.count > 0) {
        console.log('[DB] RBAC data already initialized, skipping...');
        return;
      }

      console.log('[DB] Initializing RBAC seed data...');

      await this.exec('BEGIN TRANSACTION');

      // Insert default roles
      await this.run(`
        INSERT INTO roles (name, display_name, description) VALUES
          ('regular_user', '普通用户', '默认用户角色，可访问基础智能体'),
          ('admin', '管理员', '管理员角色，可访问所有智能体')
      `);

      // Insert default agents
      await this.run(`
        INSERT INTO agents (name, display_name, description) VALUES
          ('counselor-bot', '心理咨询师', '专业的心理咨询智能体'),
          ('main', '主智能体', '系统主智能体（保留使用）')
      `);

      // Assign counselor-bot to regular_user role
      await this.run(`
        INSERT INTO agent_roles (agent_id, role_id)
        SELECT a.id, r.id FROM agents a, roles r
        WHERE a.name = 'counselor-bot' AND r.name = 'regular_user'
      `);

      // Assign all agents to admin role
      await this.run(`
        INSERT INTO agent_roles (agent_id, role_id)
        SELECT a.id, r.id FROM agents a, roles r
        WHERE r.name = 'admin'
      `);

      // Set existing users to regular_user role
      await this.run(`
        UPDATE users SET role_id = (SELECT id FROM roles WHERE name = 'regular_user')
        WHERE role_id IS NULL
      `);

      await this.exec('COMMIT');
      console.log('[DB] RBAC seed data initialized successfully');
    } catch (error) {
      await this.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * Helper method for running SQL statements
   */
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ id: this.lastID, changes: this.changes });
        }
      });
    });
  }

  /**
   * Helper method for getting a single row
   */
  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  /**
   * Helper method for getting all rows
   */
  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  /**
   * Helper method for executing SQL without parameters
   */
  exec(sql) {
    return new Promise((resolve, reject) => {
      this.db.exec(sql, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  // ==================== User Operations ====================

  /**
   * Create a new user
   * @param {string} username - Username
   * @param {string} passwordHash - Hashed password
   * @param {string} email - User email (optional)
   * @param {string} deviceId - Device ID (optional)
   * @param {string} devicePublicKey - Device public key (optional)
   * @param {string} devicePrivateKeyPem - Device private key in PEM format (optional)
   */
  async createUser(username, passwordHash, email, deviceId = null, devicePublicKey = null, devicePrivateKeyPem = null) {
    const sql = `
      INSERT INTO users (username, password_hash, email, device_id, device_public_key, device_private_key_pem)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    const result = await this.run(sql, [username, passwordHash, email, deviceId, devicePublicKey, devicePrivateKeyPem]);
    return this.findUserById(result.id);
  }

  /**
   * Find user by username
   */
  async findUserByUsername(username) {
    const sql = 'SELECT * FROM users WHERE username = ?';
    return await this.get(sql, [username]);
  }

  /**
   * Find user by email
   */
  async findUserByEmail(email) {
    if (!email) return null;
    const sql = 'SELECT * FROM users WHERE email = ?';
    return await this.get(sql, [email]);
  }

  /**
   * Find user by ID
   */
  async findUserById(id) {
    const sql = 'SELECT * FROM users WHERE id = ?';
    return await this.get(sql, [id]);
  }

  /**
   * Update user information
   * @param {number} id - User ID
   * @param {object} updates - Fields to update (email, password_hash)
   */
  async updateUser(id, updates) {
    const fields = [];
    const values = [];

    if (updates.email !== undefined) {
      fields.push('email = ?');
      values.push(updates.email);
    }
    if (updates.password_hash !== undefined) {
      fields.push('password_hash = ?');
      values.push(updates.password_hash);
    }

    if (fields.length === 0) {
      return this.findUserById(id);
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const sql = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;
    await this.run(sql, values);
    return this.findUserById(id);
  }

  // ==================== RBAC Operations ====================

  /**
   * Get user's role information
   */
  async getUserRole(userId) {
    const sql = `
      SELECT r.* FROM roles r
      INNER JOIN users u ON u.role_id = r.id
      WHERE u.id = ?
    `;
    return await this.get(sql, [userId]);
  }

  /**
   * Get agents available to a user based on their role
   */
  async getAgentsByRole(roleId) {
    const sql = `
      SELECT a.name, a.display_name, a.description
      FROM agents a
      INNER JOIN agent_roles ar ON ar.agent_id = a.id
      WHERE ar.role_id = ? AND a.enabled = 1
      ORDER BY a.id
    `;
    return await this.all(sql, [roleId]);
  }

  // ==================== Token Operations ====================

  /**
   * Create an access token
   * @param {string} token - Token string
   * @param {string} agentId - Agent ID
   * @param {string} createdBy - Creator identifier
   * @param {object} options - Optional parameters (source_label, expires_at)
   */
  async createToken(token, agentId, createdBy, options = {}) {
    const { sourceLabel, expiresAt } = options;

    // Generate device keys for token
    const deviceKey = generateDeviceKey();

    const sql = `
      INSERT INTO access_tokens (token, agent_id, source_label, expires_at, created_by, device_id, device_public_key, device_private_key_pem)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const result = await this.run(sql, [token, agentId, sourceLabel, expiresAt, createdBy, deviceKey.deviceId, deviceKey.publicKey, deviceKey.privateKeyPem]);
    return this.findToken(result.id);
  }

  /**
   * Find token by ID
   */
  async findToken(id) {
    const sql = 'SELECT * FROM access_tokens WHERE id = ?';
    return await this.get(sql, [id]);
  }

  /**
   * Find active token by token string
   */
  async findActiveToken(token) {
    const sql = `
      SELECT * FROM access_tokens
      WHERE token = ? AND is_active = 1
    `;
    return await this.get(sql, [token]);
  }

  /**
   * Deactivate a token
   */
  async deactivateToken(tokenId) {
    const sql = 'UPDATE access_tokens SET is_active = 0 WHERE id = ?';
    await this.run(sql, [tokenId]);
    return this.findToken(tokenId);
  }

  /**
   * List all tokens for an agent
   * @param {string} agentId - Agent ID
   */
  async listTokens(agentId) {
    const sql = `
      SELECT * FROM access_tokens
      WHERE agent_id = ?
      ORDER BY created_at DESC
    `;
    return await this.all(sql, [agentId]);
  }

  // ==================== Session Operations ====================

  /**
   * Save or update a user session
   * @param {number} userId - User ID
   * @param {string} gatewaySessionId - Gateway session ID
   * @param {string} agentId - Agent ID
   * @param {string} title - Session title
   * @param {object} metadata - Additional metadata (optional)
   */
  async saveSession(userId, gatewaySessionId, agentId, title, metadata = null) {
    const metadataJson = metadata ? JSON.stringify(metadata) : null;
    const sql = `
      INSERT INTO user_sessions (user_id, gateway_session_id, agent_id, title, metadata)
      VALUES (?, ?, ?, ?, ?)
    `;
    const result = await this.run(sql, [userId, gatewaySessionId, agentId, title, metadataJson]);
    return result.id;
  }

  /**
   * Get all sessions for a user
   */
  async getUserSessions(userId) {
    const sql = `
      SELECT * FROM user_sessions
      WHERE user_id = ?
      ORDER BY updated_at DESC
    `;
    return await this.all(sql, [userId]);
  }

  /**
   * Find session by gateway session ID
   * @param {string} gatewaySessionId - Gateway session ID
   */
  async findSessionByGatewayId(gatewaySessionId) {
    const sql = 'SELECT * FROM user_sessions WHERE gateway_session_id = ?';
    return await this.get(sql, [gatewaySessionId]);
  }

  /**
   * Find session by ID
   * @param {number} id - Session ID
   */
  async findSessionById(id) {
    const sql = 'SELECT * FROM user_sessions WHERE id = ?';
    return await this.get(sql, [id]);
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId) {
    const sql = 'DELETE FROM user_sessions WHERE id = ?';
    return await this.run(sql, [sessionId]);
  }

  /**
   * Update session title
   */
  async updateSessionTitle(sessionId, title) {
    const sql = `
      UPDATE user_sessions
      SET title = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;
    await this.run(sql, [title, sessionId]);
    return this.get('SELECT * FROM user_sessions WHERE id = ?', [sessionId]);
  }

  /**
   * Delete session by user ID and agent ID
   */
  async deleteSessionByUserAndAgent(userId, agentId) {
    const sql = 'DELETE FROM user_sessions WHERE user_id = ? AND agent_id = ?';
    return await this.run(sql, [userId, agentId]);
  }

  /**
   * Get or create a user's default session
   * Returns the most recent session or creates a new one for the user
   * @param {number} userId - User ID
   * @param {string} agentId - Agent ID (default: 'main')
   */
  async getOrCreateUserSession(userId, agentId = 'main') {
    // First, try to get the most recent session for this user
    const sessions = await this.getUserSessions(userId);
    if (sessions && sessions.length > 0) {
      // Return the most recent session
      return sessions[0];
    }

    // No session exists, create a new one
    const title = 'My Session';
    const gatewaySessionId = `agent:${agentId}:${userId}`;
    return await this.saveSession(userId, gatewaySessionId, agentId, title);
  }

  /**
   * Get a user's session without creating a new one
   * Returns the most recent session or null if none exists
   * @param {number} userId - User ID
   * @param {string} agentId - Agent ID (default: 'main')
   */
  async getUserSession(userId, agentId = 'main') {
    const sessions = await this.getUserSessions(userId);
    if (sessions && sessions.length > 0) {
      // Return the most recent session
      return sessions[0];
    }
    // No session exists, return null
    return null;
  }

  // ==================== Device Key Operations ====================

  /**
   * Get device key for a user
   * @param {number} userId - User ID
   * @returns {object|null} Device key object or null if not set
   */
  async getUserDeviceKey(userId) {
    const row = await this.get(
      'SELECT device_id, device_public_key, device_private_key_pem FROM users WHERE id = ?',
      [userId]
    );
    if (!row || !row.device_id) return null;
    return {
      deviceId: row.device_id,
      publicKey: row.device_public_key,
      privateKeyPem: row.device_private_key_pem
    };
  }

  /**
   * Get device key for an access token
   * @param {string} token - Token string
   * @returns {object|null} Device key object or null if not set
   */
  async getTokenDeviceKey(token) {
    const row = await this.get(
      'SELECT device_id, device_public_key, device_private_key_pem FROM access_tokens WHERE token = ?',
      [token]
    );
    if (!row || !row.device_id) return null;
    return {
      deviceId: row.device_id,
      publicKey: row.device_public_key,
      privateKeyPem: row.device_private_key_pem
    };
  }

  /**
   * Save device key for a user (auto-generate for memory isolation)
   * @param {number} userId - User ID
   * @param {object} deviceKey - Device key object with deviceId, publicKey, privateKeyPem
   * @returns {boolean} True if saved successfully
   */
  async saveUserDeviceKey(userId, deviceKey) {
    try {
      const result = await this.run(
        'UPDATE users SET device_id = ?, device_public_key = ?, device_private_key_pem = ? WHERE id = ?',
        [deviceKey.deviceId, deviceKey.publicKey, deviceKey.privateKeyPem, userId]
      );
      console.log(`[saveUserDeviceKey] Updated user ${userId}, changes: ${result.changes}`);
      return result.changes > 0;
    } catch (error) {
      console.error(`[saveUserDeviceKey] Error saving device key for user ${userId}:`, error.message);
      throw error;
    }
  }

  /**
   * Close database connection
   */
  async close() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }
}

export default Database;
