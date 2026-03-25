import sqlite3 from 'sqlite3';

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
      )`
    ];

    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_tokens_token ON access_tokens(token)',
      'CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)'
    ];

    try {
      for (const tableSQL of tables) {
        await this.run(tableSQL);
      }
      for (const indexSQL of indexes) {
        await this.run(indexSQL);
      }
    } catch (error) {
      throw new Error(`Failed to create tables: ${error.message}`);
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

  // ==================== User Operations ====================

  /**
   * Create a new user
   * @param {string} username - Username
   * @param {string} passwordHash - Hashed password
   * @param {string} email - User email (optional)
   */
  async createUser(username, passwordHash, email) {
    const sql = `
      INSERT INTO users (username, password_hash, email)
      VALUES (?, ?, ?)
    `;
    const result = await this.run(sql, [username, passwordHash, email]);
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
    const sql = `
      INSERT INTO access_tokens (token, agent_id, source_label, expires_at, created_by)
      VALUES (?, ?, ?, ?, ?)
    `;
    const result = await this.run(sql, [token, agentId, sourceLabel, expiresAt, createdBy]);
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
