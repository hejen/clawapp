/**
 * REST API Client - 对接 OpenClaw Chat 认证系统
 *
 * 架构：前端 ← REST API → 后端 API 服务
 * - 提供认证、令牌管理、会话管理等 REST API 调用
 * - 与 api-client.js 的 WsClient 互补（WsClient 负责 SSE/WS 通信）
 */

export class API {
  constructor() {
    this.baseURL = window.location.origin;
    this.token = localStorage.getItem('jwt_token');
  }

  /**
   * Make authenticated API request
   */
  async request(method, path, data = null) {
    const headers = { 'Content-Type': 'application/json' };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const options = {
      method,
      headers
    };

    if (data) {
      options.body = JSON.stringify(data);
    }

    const response = await fetch(this.baseURL + path, options);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Request failed');
    }

    return response.json();
  }

  /**
   * Update auth token
   */
  setToken(token) {
    this.token = token;
  }

  // ============ Token Management ============

  async createToken(agentId, label = null, expiresIn = null) {
    return this.request('POST', '/api/tokens', { agentId, label, expiresIn });
  }

  async listTokens() {
    return this.request('GET', '/api/tokens');
  }

  async deleteToken(tokenId) {
    return this.request('DELETE', `/api/tokens/${tokenId}`);
  }

  // ============ Session Management ============

  async listSessions() {
    return this.request('GET', '/api/sessions');
  }

  async createSession(gatewaySessionId, agentId, title = null, metadata = null) {
    return this.request('POST', '/api/sessions', {
      gatewaySessionId,
      agentId,
      title,
      metadata
    });
  }

  async deleteSession(sessionId) {
    return this.request('DELETE', `/api/sessions/${sessionId}`);
  }

  async updateSessionTitle(sessionId, title) {
    return this.request('PUT', `/api/sessions/${sessionId}`, { title });
  }

  // ============ User Info ============

  async getCurrentUser() {
    return this.request('GET', '/api/auth/me');
  }
}

// Export singleton instance for convenience
export const api = new API();
