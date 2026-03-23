/**
 * Authentication Manager
 * Handles JWT and token-based authentication for the frontend
 */

class AuthManager {
  constructor() {
    this.authType = null; // 'jwt' | 'token' | null
    this.token = null;
    this.userInfo = null;
    this.apiBase = window.location.origin;
  }

  /**
   * Initialize authentication on page load
   */
  init() {
    // Check URL for token parameter (public links)
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('t');

    if (urlToken) {
      // Token access mode (public link)
      console.log('Token access mode detected');
      this.authType = 'token';
      this.token = urlToken;
      localStorage.setItem('access_token', urlToken);
      return Promise.resolve({ type: 'token', token: urlToken });
    }

    // Check for stored JWT (logged-in user)
    const storedToken = localStorage.getItem('jwt_token');
    if (storedToken) {
      try {
        // Verify token hasn't expired
        const payload = this.parseJWT(storedToken);
        if (payload && payload.exp * 1000 > Date.now()) {
          console.log('JWT access mode detected');
          this.authType = 'jwt';
          this.token = storedToken;
          this.userInfo = JSON.parse(localStorage.getItem('user_info') || '{}');
          return Promise.resolve({ type: 'jwt', token: storedToken, user: this.userInfo });
        }
      } catch (e) {
        // Token invalid, clear it
        localStorage.removeItem('jwt_token');
        localStorage.removeItem('user_info');
      }
    }

    // No valid auth found
    console.log('No valid authentication found');
    return Promise.resolve(null);
  }

  /**
   * Parse JWT token (without verification)
   */
  parseJWT(token) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      const payload = parts[1];
      const decoded = atob(payload);
      return JSON.parse(decoded);
    } catch (e) {
      return null;
    }
  }

  /**
   * User login
   */
  async login(username, password) {
    const response = await fetch(`${this.apiBase}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Login failed');
    }

    const data = await response.json();

    // Store credentials
    this.authType = 'jwt';
    this.token = data.token;
    this.userInfo = data.user;

    localStorage.setItem('jwt_token', data.token);
    localStorage.setItem('user_info', JSON.stringify(data.user));

    return data;
  }

  /**
   * User registration
   */
  async register(username, password, email = null) {
    const response = await fetch(`${this.apiBase}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, email })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Registration failed');
    }

    return response.json();
  }

  /**
   * Get token for WebSocket connection
   */
  getWebSocketToken() {
    return this.token;
  }

  /**
   * Get authentication info
   */
  getAuthInfo() {
    return {
      type: this.authType,
      token: this.token,
      user: this.userInfo
    };
  }

  /**
   * Check if user is logged in
   */
  isAuthenticated() {
    return this.authType !== null && this.token !== null;
  }

  /**
   * Logout
   */
  logout() {
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('user_info');
    localStorage.removeItem('access_token');

    this.authType = null;
    this.token = null;
    this.userInfo = null;

    // Reload page to show login
    window.location.reload();
  }

  /**
   * Get current username
   */
  getUsername() {
    if (this.authType === 'jwt' && this.userInfo) {
      return this.userInfo.username;
    }
    return null;
  }
}

// Export singleton instance
export const authManager = new AuthManager();
