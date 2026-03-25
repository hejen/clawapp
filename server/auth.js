// server/auth.js
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { generateDeviceKey } from './device-keys.js';

class AuthManager {
  constructor(db, jwtSecret) {
    this.db = db;
    this.jwtSecret = jwtSecret;
  }

  // ============ User Authentication ============

  async login(username, password) {
    const user = await this.db.findUserByUsername(username);
    if (!user) {
      return null;
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return null;
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      this.jwtSecret,
      { expiresIn: '24h', issuer: 'openclaw-chat' }
    );

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    };
  }

  async register(username, password, email = null) {
    // Check if user exists
    const existing = await this.db.findUserByUsername(username);
    if (existing) {
      throw new Error('Username already exists');
    }

    // Check if email already exists
    if (email) {
      const existingEmail = await this.db.findUserByEmail(email);
      if (existingEmail) {
        throw new Error('Email already exists');
      }
    }

    // Validate password
    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters');
    }

    // Hash password
    const passwordHash = await this.hashPassword(password);

    // Generate device keys
    const deviceKey = generateDeviceKey();

    // Create user with device keys
    const user = await this.db.createUser(
      username,
      passwordHash,
      email,
      deviceKey.deviceId,
      deviceKey.publicKey,
      deviceKey.privateKeyPem
    );

    return user.id;
  }

  // ============ JWT Operations ============

  verifyJWT(token) {
    try {
      return jwt.verify(token, this.jwtSecret, {
        issuer: 'openclaw-chat'
      });
    } catch (e) {
      return null;
    }
  }

  // ============ Access Token Operations ============

  async validateAccessToken(token) {
    const tokenRecord = await this.db.findActiveToken(token);
    if (!tokenRecord) {
      return null;
    }

    // Check expiration
    if (tokenRecord.expires_at) {
      const expiresAt = new Date(tokenRecord.expires_at);
      if (expiresAt < new Date()) {
        return null;
      }
    }

    return tokenRecord;
  }

  generateAccessToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  async createAccessToken(agentId, createdBy, options = {}) {
    const token = this.generateAccessToken();
    const tokenId = await this.db.createToken(token, agentId, createdBy, options);
    return { token, id: tokenId };
  }

  // ============ Password Utilities ============

  async hashPassword(password) {
    return bcrypt.hash(password, 10);
  }

  // ============ WebSocket Authentication ============

  async authenticateWebSocket(req) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      return null;
    }

    // Try JWT first (login users)
    if (token.startsWith('eyJ')) {
      const decoded = this.verifyJWT(token);
      if (decoded) {
        return {
          type: 'user',
          id: decoded.userId,
          username: decoded.username
        };
      }
    }

    // Try access token (public links)
    const tokenRecord = await this.validateAccessToken(token);
    if (tokenRecord) {
      return {
        type: 'token',
        id: tokenRecord.id,
        agentId: tokenRecord.agent_id
      };
    }

    return null;
  }
}

export default AuthManager;
