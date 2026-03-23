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
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        display_name TEXT,
        avatar_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Access tokens table
      `CREATE TABLE IF NOT EXISTS access_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT UNIQUE NOT NULL,
        user_id INTEGER NOT NULL,
        is_active BOOLEAN DEFAULT 1,
        expires_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,

      // User sessions table
      `CREATE TABLE IF NOT EXISTS user_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        gateway_id TEXT NOT NULL,
        title TEXT,
        model_id TEXT DEFAULT 'gpt-4o-mini',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(user_id, gateway_id)
      )`
    ];

    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)',
      'CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)',
      'CREATE INDEX IF NOT EXISTS idx_access_tokens_token ON access_tokens(token)',
      'CREATE INDEX IF NOT EXISTS idx_access_tokens_user_id ON access_tokens(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_access_tokens_is_active ON access_tokens(is_active)',
      'CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_user_sessions_gateway_id ON user_sessions(gateway_id)'
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
   */
  async createUser(userData) {
    const { username, email, passwordHash, displayName, avatarUrl } = userData;
    const sql = `
      INSERT INTO users (username, email, password_hash, display_name, avatar_url)
      VALUES (?, ?, ?, ?, ?)
    `;
    const result = await this.run(sql, [username, email, passwordHash, displayName, avatarUrl]);
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
   * Find user by ID
   */
  async findUserById(id) {
    const sql = 'SELECT * FROM users WHERE id = ?';
    return await this.get(sql, [id]);
  }

  /**
   * Update user information
   */
  async updateUser(id, updates) {
    const fields = [];
    const values = [];

    if (updates.displayName !== undefined) {
      fields.push('display_name = ?');
      values.push(updates.displayName);
    }
    if (updates.avatarUrl !== undefined) {
      fields.push('avatar_url = ?');
      values.push(updates.avatarUrl);
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
   */
  async createToken(tokenData) {
    const { token, userId, expiresAt } = tokenData;
    const sql = `
      INSERT INTO access_tokens (token, user_id, expires_at)
      VALUES (?, ?, ?)
    `;
    const result = await this.run(sql, [token, userId, expiresAt]);
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
   * List all tokens for a user
   */
  async listTokens(userId) {
    const sql = `
      SELECT * FROM access_tokens
      WHERE user_id = ?
      ORDER BY created_at DESC
    `;
    return await this.all(sql, [userId]);
  }

  // ==================== Session Operations ====================

  /**
   * Save or update a user session
   */
  async saveSession(sessionData) {
    const { userId, gatewayId, title, modelId } = sessionData;
    const sql = `
      INSERT INTO user_sessions (user_id, gateway_id, title, model_id)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, gateway_id) DO UPDATE SET
        title = excluded.title,
        model_id = excluded.model_id,
        updated_at = CURRENT_TIMESTAMP
    `;
    await this.run(sql, [userId, gatewayId, title, modelId]);
    return this.findSessionByGatewayId(gatewayId);
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
   * Find session by gateway ID
   */
  async findSessionByGatewayId(gatewayId) {
    const sql = 'SELECT * FROM user_sessions WHERE gateway_id = ?';
    return await this.get(sql, [gatewayId]);
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
