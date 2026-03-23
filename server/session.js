/**
 * SessionManager class for OpenClaw Chat
 * Manages multi-tenant session filtering and tracking
 */
class SessionManager {
  constructor(db) {
    this.db = db;
    // Track sessions per connection (for token users)
    this.connectionSessions = new Map(); // connectionId -> Set of sessionIds
  }

  /**
   * Filter gateway sessions based on user authentication
   * @param {Array} gatewaySessions - Sessions from OpenClaw Gateway
   * @param {Object} authInfo - Authentication info from authenticateWebSocket
   * @returns {Array} - Filtered sessions
   */
  async filterSessions(gatewaySessions, authInfo) {
    if (authInfo.type === 'user') {
      // Logged-in user: fetch from database
      const userSessions = await this.db.getUserSessions(authInfo.id);
      const sessionIds = new Set(userSessions.map(s => s.gateway_session_id));

      return gatewaySessions.filter(session => {
        const sessionId = session.id || session.sessionId;
        return sessionIds.has(sessionId);
      });
    } else {
      // Token user: only return sessions for this connection
      const connectionSessionIds = this.connectionSessions.get(authInfo.id) || new Set();

      return gatewaySessions.filter(session => {
        const sessionId = session.id || session.sessionId;
        return connectionSessionIds.has(sessionId);
      });
    }
  }

  /**
   * Track a session created by a connection
   * @param {Object} authInfo - Authentication info
   * @param {String} sessionId - Gateway session ID
   */
  trackSession(authInfo, sessionId) {
    if (authInfo.type === 'token') {
      if (!this.connectionSessions.has(authInfo.id)) {
        this.connectionSessions.set(authInfo.id, new Set());
      }
      this.connectionSessions.get(authInfo.id).add(sessionId);
    }
  }

  /**
   * Save a user session to database
   * @param {Number} userId - User ID (can be null for token users)
   * @param {String} gatewaySessionId - Gateway session ID
   * @param {String} agentId - Agent ID
   * @param {String} title - Session title
   * @param {Object} metadata - Additional metadata
   */
  async saveUserSession(userId, gatewaySessionId, agentId, title = null, metadata = null) {
    return await this.db.saveSession(userId, gatewaySessionId, agentId, title, metadata);
  }

  /**
   * Clean up when a client disconnects
   * @param {Object} authInfo - Authentication info
   */
  disconnectClient(authInfo) {
    if (authInfo.type === 'token') {
      this.connectionSessions.delete(authInfo.id);
    }
  }

  /**
   * Get session statistics
   * @param {Number} userId - User ID
   * @returns {Object} - Session statistics
   */
  async getSessionStats(userId) {
    const sessions = await this.db.getUserSessions(userId);
    return {
      total: sessions.length,
      byAgent: sessions.reduce((acc, s) => {
        acc[s.agent_id] = (acc[s.agent_id] || 0) + 1;
        return acc;
      }, {})
    };
  }
}

export default SessionManager;
