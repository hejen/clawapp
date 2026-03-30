/**
 * REST API Client - 对接 OpenClaw Chat 认证系统
 *
 * 架构：前端 ← REST API → 后端 API 服务
 * - 提供认证、令牌管理、会话管理等 REST API 调用
 * - 与 api-client.js 的 WsClient 互补（WsClient 负责 SSE/WS 通信）
 */

import { getApiBase } from './config.js';

export class API {
  constructor() {
    this.baseURL = getApiBase();
    // Token is synchronized via localStorage with authManager
    // Both read/write the same 'jwt_token' key to stay in sync
    this.token = localStorage.getItem('jwt_token');
  }

  /**
   * Refresh baseURL (call this after config changes)
   */
  refreshBaseURL() {
    this.baseURL = getApiBase();
  }

  /**
   * Make authenticated API request
   */
  async request(method, path, data = null, timeout = 30000) {
    // Dynamically get API base URL on each request to handle config changes
    const apiBase = getApiBase();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const headers = { 'Content-Type': 'application/json' };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const options = {
      method,
      headers,
      signal: controller.signal
    };

    if (data) {
      options.body = JSON.stringify(data);
    }

    try {
      const response = await fetch(apiBase + path, options);
      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: `Request failed (HTTP ${response.status})` }));
        throw new Error(error.error || 'Request failed');
      }

      return response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw error;
    }
  }

  /**
   * Update auth token
   */
  setToken(token) {
    this.token = token;
    localStorage.setItem('jwt_token', token);
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
    // 如果没有提供 gatewaySessionId，生成一个
    let finalSessionKey = gatewaySessionId;
    if (!finalSessionKey && agentId) {
      const uuid = crypto.randomUUID();
      finalSessionKey = `agent:${agentId}:${uuid}`;
    }

    return this.request('POST', '/api/sessions', {
      gatewaySessionId: finalSessionKey,
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
