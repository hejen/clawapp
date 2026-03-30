// server/api.js
import express from 'express';

const router = express.Router();

// ============ Auth Routes ============

// POST /api/auth/register - User registration
router.post('/auth/register', async (req, res) => {
  try {
    const { username, password, email } = req.body;

    // Validation
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    if (username.length < 3) {
      return res.status(400).json({ error: '用户名至少 3 个字符' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: '密码至少 6 个字符' });
    }

    const userId = await req.authManager.register(username, password, email);

    res.status(201).json({
      success: true,
      message: '注册成功',
      userId
    });
  } catch (error) {
    if (error.message === 'Username already exists') {
      return res.status(409).json({ error: '用户名已存在' });
    }
    if (error.message === 'Email already exists') {
      return res.status(409).json({ error: '邮箱已被使用' });
    }
    res.status(500).json({ error: error.message });
  }
});

// POST /api/auth/login - User login
router.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    const authResult = await req.authManager.login(username, password);

    if (!authResult) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    res.json({
      token: authResult.token,
      user: authResult.user
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/auth/me - Get current user
router.get('/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ============ Token Routes ============

// POST /api/tokens - Create access token
router.post('/tokens', requireAuth, async (req, res) => {
  try {
    const { agentId, label, expiresIn } = req.body;

    if (!agentId) {
      return res.status(400).json({ error: 'agent_id 不能为空' });
    }

    const options = {
      sourceLabel: label || null,
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null
    };

    const result = await req.authManager.createAccessToken(
      agentId,
      req.user.username,
      options
    );

    res.json({
      token: result.token,
      agentId,
      label: options.sourceLabel,
      expiresAt: options.expiresAt
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/tokens - List tokens
router.get('/tokens', requireAuth, async (req, res) => {
  try {
    const tokens = await req.db.listTokens(req.user.username);
    res.json(tokens);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/tokens/:token - Delete token
router.delete('/tokens/:token', requireAuth, async (req, res) => {
  try {
    await req.db.deactivateToken(req.params.token);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ Session Routes ============

// GET /api/sessions - Get user sessions
router.get('/sessions', requireAuth, async (req, res) => {
  try {
    const dbSessions = await req.db.getUserSessions(req.user.id);

    // Transform to match Gateway sessions.list format
    // Use gateway_session_id for proper session isolation
    const sessions = dbSessions.map(s => ({
      id: s.id,
      sessionKey: s.gateway_session_id,
      key: s.gateway_session_id,
      agentId: s.agent_id,
      title: s.title,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
      lastActivity: s.updated_at
    }));

    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sessions - Create session
router.post('/sessions', requireAuth, async (req, res) => {
  try {
    const { agentId, title, metadata } = req.body;

    if (!agentId) {
      return res.status(400).json({ error: 'agent_id 不能为空' });
    }

    let finalGatewaySessionId = req.body.gatewaySessionId;

    // 如果没有提供 gatewaySessionId，生成一个
    if (!finalGatewaySessionId) {
      // 导入 UUID 工具函数
      const { generateSessionKey } = await import('./utils/uuid.js');

      // 检查 sessionKey 是否已存在的函数
      const checkExists = async (sessionKey) => {
        const existing = await req.db.findSessionByGatewayId(sessionKey);
        return !!existing;
      };

      // 生成唯一的 sessionKey（带重试机制）
      finalGatewaySessionId = await generateSessionKey(agentId, req.user.id, checkExists);
    }

    const sessionId = await req.db.saveSession(
      req.user.id,
      finalGatewaySessionId,
      agentId,
      title || 'New Chat',
      metadata
    );

    const session = await req.db.findSessionById(sessionId);
    res.status(201).json(session);
  } catch (error) {
    console.error('[API] createSession error:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/sessions/:id - Delete session
router.delete('/sessions/:id', requireAuth, async (req, res) => {
  try {
    const sessionId = req.params.id;

    // Check if :id is a number (database ID) or sessionKey string
    if (/^\d+$/.test(sessionId)) {
      // Delete by database ID
      await req.db.deleteSession(sessionId);
    } else {
      // Delete by sessionKey (format: agent:xxx:main)
      // First find the session by user_id and agent_id
      const agentId = sessionId.split(':')[1];
      await req.db.deleteSessionByUserAndAgent(req.user.id, agentId);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/sessions/:id - Update session title
router.put('/sessions/:id', requireAuth, async (req, res) => {
  try {
    const { title } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'title 不能为空' });
    }

    await req.db.updateSessionTitle(req.params.id, title);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/agents - Get available agents for current user
router.get('/agents', requireAuth, async (req, res) => {
  try {
    const roleId = req.user.roleId;

    if (!roleId) {
      return res.status(400).json({
        ok: false,
        error: '用户未分配角色'
      });
    }

    const agents = await req.db.getAgentsByRole(roleId);

    res.json({
      ok: true,
      agents: agents.map(a => ({
        name: a.name,
        display_name: a.display_name
      }))
    });
  } catch (error) {
    console.error('[/api/agents] Error:', error);
    res.status(500).json({
      ok: false,
      error: error.message || 'Failed to fetch agents'
    });
  }
});

// ============ Middleware ============

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未认证' });
  }

  const token = authHeader.substring(7);
  const decoded = req.authManager.verifyJWT(token);

  if (!decoded) {
    return res.status(401).json({ error: 'Token 无效' });
  }

  // Normalize user object - JWT payload has userId, but we also want id for consistency
  req.user = {
    ...decoded,
    id: decoded.userId  // Add id field for consistency in API endpoints
  };
  next();
}

export { router, requireAuth };
