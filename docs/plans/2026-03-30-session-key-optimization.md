# 会话 Key 优化实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标:** 优化会话标识符生成机制，解决用户修改名称导致的 sessionKey 冲突问题

**架构:** 将 sessionKey 从 `agent:{agent}:{userName}` 改为 `agent:{agent}:{uuid}`，名称仅作为展示属性

**技术栈:** JavaScript (H5), Node.js (后端 API), IndexedDB, UUID v4

---

## 前置准备

### Task 0: 验证开发环境

**Step 1: 检查项目结构**

```bash
cd h5
ls -la src/
```

预期输出：包含 session-picker.js, api.js, message-db.js 等文件

**Step 2: 检查后端服务状态**

```bash
# 检查后端 API 是否运行
curl -X GET http://localhost:8000/api/agents
```

预期输出：返回智能体列表或 401（需要认证）

**Step 3: 安装前端依赖（如需要）**

```bash
cd h5
npm install
```

**Step 4: 启动开发服务器**

```bash
npm run dev
```

预期输出：服务器启动在指定端口

---

## 后端实现

### Task 1: 添加 UUID 生成工具函数

**Files:**
- Create: `backend/src/utils/uuid.js`（路径可能不同，需要根据实际项目结构调整）

**Step 1: 创建 UUID 工具文件**

```javascript
/**
 * UUID v4 生成器
 * 使用 crypto.randomUUID() 或回退到 Math.random()
 */

export function generateUUID() {
  // 优先使用浏览器/Node.js 原生 API
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // 回退实现
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * 生成带重试机制的会话 Key
 * @param {string} agentName - 智能体名称
 * @param {Function} checkExists - 检查 sessionKey 是否存在的函数
 * @param {number} maxRetries - 最大重试次数，默认 3
 * @returns {Promise<string>} sessionKey
 */
export async function generateSessionKey(agentName, checkExists, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const uuid = generateUUID();
      const sessionKey = `agent:${agentName}:${uuid}`;

      // 检查是否已存在
      const exists = await checkExists(sessionKey);
      if (exists) {
        console.warn(`[UUID] Conflict on attempt ${attempt + 1}, retrying...`);
        continue;
      }

      console.log(`[UUID] Generated sessionKey: ${sessionKey}`);
      return sessionKey;
    } catch (error) {
      console.error(`[UUID] Error on attempt ${attempt + 1}:`, error);
      throw error;
    }
  }

  throw new Error('Failed to generate unique sessionKey after ' + maxRetries + ' attempts');
}
```

**Step 2: 编写单元测试**

```javascript
// test/uuid.test.js
import { generateUUID, generateSessionKey } from '../src/utils/uuid.js';

describe('UUID Generator', () => {
  test('generateUUID should return valid UUID v4 format', () => {
    const uuid = generateUUID();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  test('generateUUID should generate unique values', () => {
    const uuids = new Set();
    for (let i = 0; i < 1000; i++) {
      uuids.add(generateUUID());
    }
    expect(uuids.size).toBe(1000);
  });

  test('generateSessionKey should retry on conflict', async () => {
    let attemptCount = 0;
    const mockCheckExists = async (key) => {
      attemptCount++;
      if (attemptCount < 2) return true; // 前2次模拟冲突
      return false;
    };

    const result = await generateSessionKey('test-agent', mockCheckExists, 3);
    expect(result).toMatch(/^agent:test-agent:/);
    expect(attemptCount).toBe(2);
  });

  test('generateSessionKey should throw after max retries', async () => {
    const mockCheckExists = async () => true; // 总是返回冲突

    await expect(
      generateSessionKey('test-agent', mockCheckExists, 3)
    ).rejects.toThrow('Failed to generate unique sessionKey');
  });
});
```

**Step 3: 运行测试验证**

```bash
npm test -- test/uuid.test.js
```

预期输出：测试通过

**Step 4: 提交**

```bash
git add backend/src/utils/uuid.js test/uuid.test.js
git commit -m "feat: add UUID generator with retry mechanism

- 添加 UUID v4 生成器，支持原生 API 和回退实现
- 实现 generateSessionKey 带重试机制（最多3次）
- 添加单元测试覆盖各种场景

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: 修改会话创建 API

**Files:**
- Modify: `backend/src/api/sessions.js`（实际路径可能不同）

**Step 1: 修改创建会话接口**

```javascript
import { generateSessionKey } from '../utils/uuid.js';

// 在现有的创建会话函数中修改
async function createSession(req, res) {
  const { gatewaySessionId, agentId, title, metadata } = req.body;
  const userId = req.user.id; // 假设有用户认证中间件

  try {
    let finalSessionKey;

    if (gatewaySessionId) {
      // 兼容旧逻辑：客户端提供了 sessionKey
      finalSessionKey = gatewaySessionId;
    } else {
      // 新逻辑：服务器生成 sessionKey
      const checkExists = async (key) => {
        const result = await db.query(
          'SELECT id FROM sessions WHERE gateway_session_id = $1',
          [key]
        );
        return result.rows.length > 0;
      };

      finalSessionKey = await generateSessionKey(agentId, checkExists);
    }

    // 插入数据库
    const result = await db.query(
      `INSERT INTO sessions (user_id, gateway_session_id, agent_id, title, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       RETURNING id, gateway_session_id, title, agent_id, created_at, updated_at`,
      [userId, finalSessionKey, agentId, title || 'New Chat', metadata ? JSON.stringify(metadata) : null]
    );

    const session = result.rows[0];

    res.json({
      id: session.id,
      gateway_session_id: session.gateway_session_id,
      title: session.title,
      agent_id: session.agent_id,
      created_at: session.created_at,
      updated_at: session.updated_at
    });
  } catch (error) {
    console.error('[API] createSession error:', error);
    res.status(500).json({ error: error.message });
  }
}
```

**Step 2: 编写集成测试**

```javascript
// test/api/sessions.test.js
import request from 'supertest';
import { app } from '../../src/app.js';

describe('POST /api/sessions', () => {
  let authToken;

  beforeAll(async () => {
    // 登录获取 token
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'test', password: 'test' });
    authToken = loginRes.body.token;
  });

  test('should create session with server-generated UUID', async () => {
    const res = await request(app)
      .post('/api/sessions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        gatewaySessionId: null,  // 让服务器生成
        agentId: 'counselor-bot',
        title: '测试会话'
      });

    expect(res.status).toBe(200);
    expect(res.body.gateway_session_id).toMatch(/^agent:counselor-bot:[0-9a-f-]{36}$/);
    expect(res.body.title).toBe('测试会话');
  });

  test('should handle duplicate UUID with retry', async () => {
    // 这个测试需要模拟数据库冲突场景
    // 实际实现可能需要使用 mock 或测试数据库
    const res1 = await request(app)
      .post('/api/sessions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        gatewaySessionId: null,
        agentId: 'counselor-bot',
        title: '会话1'
      });

    expect(res1.status).toBe(200);
    // 验证可以创建多个会话，UUID不冲突
  });

  test('should validate title is not empty', async () => {
    const res = await request(app)
      .post('/api/sessions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        gatewaySessionId: null,
        agentId: 'counselor-bot',
        title: ''
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('title');
  });
});
```

**Step 3: 运行测试验证**

```bash
npm test -- test/api/sessions.test.js
```

预期输出：测试通过

**Step 4: 提交**

```bash
git add backend/src/api/sessions.js test/api/sessions.test.js
git commit -m "feat: update session creation API to use server-generated UUID

- 修改 POST /api/sessions 支持 gatewaySessionId 为 null 时由服务器生成
- 使用 generateSessionKey 工具函数生成带 UUID 的 sessionKey
- 自动冲突重试机制（最多3次）
- 添加集成测试验证新的创建流程
- 添加 title 验证

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## 前端实现

### Task 3: 修改前端 API 客户端

**Files:**
- Modify: `h5/src/api.js:99-106`

**Step 1: 修改 createSession 方法**

在 `h5/src/api.js` 中，找到 createSession 方法并修改：

```javascript
async createSession(gatewaySessionId, agentId, title = null, metadata = null) {
  return this.request('POST', '/api/sessions', {
    gatewaySessionId,  // 改为可选，传递 null 时由后端生成
    agentId,
    title,
    metadata
  });
}
```

**Step 2: 更新 JSDoc 注释（如果存在）**

```javascript
/**
 * 创建新会话
 * @param {string|null} gatewaySessionId - 会话标识符，null 时由服务器自动生成
 * @param {string} agentId - 智能体 ID
 * @param {string|null} title - 会话标题
 * @param {object|null} metadata - 元数据
 * @returns {Promise<object>} 返回创建的会话信息
 */
async createSession(gatewaySessionId, agentId, title = null, metadata = null) {
  return this.request('POST', '/api/sessions', {
    gatewaySessionId,
    agentId,
    title,
    metadata
  });
}
```

**Step 3: 手动测试验证**

启动前端开发服务器：
```bash
cd h5
npm run dev
```

在浏览器控制台测试：
```javascript
import { api } from './src/api.js';

// 测试创建会话（不传 sessionKey）
api.createSession(null, 'counselor-bot', '测试会话')
  .then(result => console.log('创建成功:', result))
  .catch(error => console.error('创建失败:', error));
```

预期输出：
```javascript
{
  id: "550e8400-e29b-41d4-a716-446655440000",
  gateway_session_id: "agent:counselor-bot:550e8400-e29b-41d4-a716-446655440000",
  title: "测试会话",
  ...
}
```

**Step 4: 提交**

```bash
git add h5/src/api.js
git commit -m "refactor: update createSession to support server-generated UUID

- gatewaySessionId 参数改为可选，null 时由后端生成
- 更新 JSDoc 注释说明新行为
- 保持向后兼容（仍可传递自定义 sessionKey）

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: 修改会话选择器创建逻辑

**Files:**
- Modify: `h5/src/session-picker.js:162, 208-214`

**Step 1: 删除随机名称生成**

找到第 162 行，删除：
```javascript
- const defaultSessionName = uuid().split('-')[0]
```

**Step 2: 修改默认名称和创建逻辑**

找到第 162-230 行的 `promptNewSession` 函数，修改创建逻辑：

```javascript
async function promptNewSession() {
  closeSessionPicker()

  // Fetch available agents from backend
  let availableAgents = []
  let defaultAgent = 'counselor-bot'

  try {
    const response = await api.request('GET', '/api/agents')
    if (response.ok && response.agents && response.agents.length > 0) {
      availableAgents = response.agents
      defaultAgent = availableAgents[0].name
    } else {
      throw new Error('No agents available')
    }
  } catch (e) {
    console.error('Failed to fetch agents:', e)
    _onSystemMsg?.(`获取智能体列表失败: ${e.message}`)
    availableAgents = [{ name: 'counselor-bot', display_name: '心理咨询师' }]
    defaultAgent = 'counselor-bot'
  }

  // 改为友好的默认名称
  const defaultSessionName = t('session.new.default.name') || '新会话'

  const overlay = document.createElement('div')
  overlay.className = 'session-overlay cmd-overlay visible'

  const dialog = document.createElement('div')
  dialog.className = 'session-dialog'

  const agentOptions = availableAgents.map(agent =>
    `<option value="${agent.name}">${agent.display_name}</option>`
  ).join('')

  dialog.innerHTML = `
    <h3>${t('session.new')}</h3>
    <div class="form-group" style="margin:16px 0">
      <label style="font-size:13px;color:var(--text-secondary);margin-bottom:6px;display:block">${t('session.new.name')}</label>
      <input type="text" id="new-session-name" value="${defaultSessionName}" placeholder="${t('session.new.name.placeholder')}"
        style="width:100%;height:40px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;padding:0 12px;color:var(--text-primary);font-size:14px;outline:none" />
    </div>
    <div class="form-group" style="margin:16px 0">
      <label style="font-size:13px;color:var(--text-secondary);margin-bottom:6px;display:block">${t('session.new.agent')}</label>
      <select id="new-session-agent"
        style="width:100%;height:40px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;padding:0 12px;color:var(--text-primary);font-size:14px;outline:none">
        ${agentOptions}
      </select>
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${t('session.new.agent.hint')}</div>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="session-dialog-btn cancel">${t('cancel')}</button>
      <button class="session-dialog-btn confirm">${t('session.new.create')}</button>
    </div>
  `

  overlay.onclick = (e) => { if (e.target === overlay) { overlay.remove(); dialog.remove() } }
  dialog.querySelector('.cancel').onclick = () => { overlay.remove(); dialog.remove() }
  dialog.querySelector('.confirm').onclick = async () => {
    const name = dialog.querySelector('#new-session-name').value.trim()
    if (!name) return
    const agentSelect = dialog.querySelector('#new-session-agent')
    const agent = agentSelect?.value || defaultAgent

    const confirmBtn = dialog.querySelector('.confirm')
    confirmBtn.disabled = true
    confirmBtn.textContent = t('session.loading')

    try {
      // 修改：不传递 gatewaySessionId，让服务器生成
      const result = await api.createSession(null, agent, name)
      const newKey = result.gateway_session_id

      overlay.remove()
      dialog.remove()
      _onSwitch?.(newKey, name)
      _onSystemMsg?.(t('session.created', { name }))
      await refreshSessionList()
    } catch (e) {
      confirmBtn.disabled = false
      confirmBtn.textContent = t('session.new.create')
      _onSystemMsg?.(`${t('session.load.error')}: ${e.message}`)
    }
  }

  document.body.appendChild(overlay)
  document.body.appendChild(dialog)
  dialog.querySelector('#new-session-name').focus()
  dialog.querySelector('#new-session-name').onkeydown = (e) => {
    if (e.key === 'Enter') dialog.querySelector('.confirm').click()
  }
}
```

**Step 3: 添加国际化字符串**

在 `h5/src/i18n.js` 中添加：

```javascript
'session.new.default.name': '新会话',  // 英文: 'New Chat'
```

**Step 4: 手动测试验证**

1. 启动前端开发服务器
2. 打开会话选择器
3. 点击"新建会话"
4. 输入任意名称（例如"测试重复名称"）
5. 创建成功后，再次创建同名会话
6. 验证：两个会话都创建成功，且有不同的 sessionKey

**Step 5: 提交**

```bash
git add h5/src/session-picker.js h5/src/i18n.js
git commit -m "refactor: use server-generated UUID for session creation

- 删除前端随机名称生成逻辑
- 改为使用友好的默认名称'新会话'
- 修改创建会话逻辑，不传递 gatewaySessionId
- 让后端自动生成带 UUID 的 sessionKey
- 添加国际化字符串

现在可以创建同名会话而不会冲突。

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: 更新版本号

**Files:**
- Modify: `h5/package.json`

**Step 1: 更新版本号**

根据项目版本管理规范，这是一个 MINOR 功能（1.0.0 → 1.1.0）：

```json
{
  "name": "openclaw-chat-h5",
  "version": "1.1.0",  // 从 1.0.0 更新
  ...
}
```

**Step 2: 验证版本注入**

检查 `h5/vite.config.js` 确认版本注入逻辑正确：

```javascript
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  }
})
```

**Step 3: 构建验证**

```bash
cd h5
npm run build
```

预期输出：构建成功，无错误

**Step 4: 提交**

```bash
git add h5/package.json
git commit -m "chore: bump version to 1.1.0

实现会话 Key 优化功能：
- sessionKey 改为服务器生成的 UUID 格式
- 用户可自由修改会话名称，不再冲突
- 符合语义化版本规范（MINOR 版本递增）

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## 测试验证

### Task 6: 端到端测试

**Step 1: 准备测试环境**

```bash
# 启动后端服务
cd backend
npm start

# 启动前端服务
cd h5
npm run dev
```

**Step 2: 测试创建同名会话**

1. 打开浏览器访问前端
2. 登录账号
3. 打开会话选择器
4. 创建第一个会话，名称设为"测试"
5. 验证：创建成功，显示在会话列表中
6. 再次打开会话选择器
7. 创建第二个会话，名称也设为"测试"
8. 验证：创建成功，两个会话都存在于列表中
9. 打开浏览器开发者工具，查看两个会话的 `gateway_session_id`
10. 验证：两个会话的 sessionKey 不同（UUID 部分）

**Step 3: 测试修改会话名称**

1. 选择一个会话进入
2. 修改会话名称为"新名称"
3. 返回会话列表
4. 验证：名称已更新
5. 再次进入该会话
6. 发送一条消息
7. 验证：消息正常收发
8. 检查 IndexedDB 中的 `sessionKey`
9. 验证：sessionKey 保持不变

**Step 4: 测试跨设备同步（如果有环境）**

1. 在设备 A 上创建会话
2. 在设备 B 上登录同一账号
3. 打开会话选择器
4. 验证：能看到设备 A 创建的会话
5. 在设备 B 上修改会话名称
6. 返回设备 A 刷新
7. 验证：会话名称已同步更新

**Step 5: 测试边界情况**

| 测试场景 | 操作 | 预期结果 |
|---------|------|---------|
| 空名称 | 创建会话时不输入名称 | 提示"名称不能为空"或使用默认名称 |
| 超长名称 | 输入 200 字符的名称 | 根据后端验证，可能截断或拒绝 |
| 特殊字符 | 输入 emoji、特殊符号 | 正常创建和显示 |
| 网络错误 | 断网时创建会话 | 显示友好的错误提示 |
| 重复点击创建 | 快速连续点击创建按钮 | 第一个请求成功，后续请求失败或提示 |

**Step 6: 记录测试结果**

创建测试报告：
```bash
# 在项目根目录
echo "# 测试报告 - 会话 Key 优化

## 测试时间
$(date)

## 测试环境
- 前端: v1.1.0
- 后端: (版本号)

## 测试结果

### 创建同名会话
- [ ] 通过

### 修改会话名称
- [ ] 通过

### 跨设备同步
- [ ] 通过

### 边界情况
- [ ] 空名称
- [ ] 超长名称
- [ ] 特殊字符
- [ ] 网络错误
- [ ] 重复点击

## 发现的问题
(记录发现的问题)

## 建议
(记录改进建议)
" > docs/test-reports/session-key-optimization-$(date +%Y%m%d).md
```

**Step 7: 提交测试报告**

```bash
git add docs/test-reports/session-key-optimization-*.md
git commit -m "test: add session key optimization test report

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## 文档更新

### Task 7: 更新用户文档

**Step 1: 检查是否有用户文档**

```bash
ls -la docs/user-guide*.md README.md CHANGELOG.md
```

**Step 2: 更新 CHANGELOG.md**

```markdown
## [1.1.0] - 2026-03-30

### Added
- 会话名称可随时修改，不再受唯一性限制
- 服务器自动生成会话标识符（UUID），避免冲突

### Changed
- 会话创建流程优化，使用 UUID 作为唯一标识符
- 会话名称不再作为标识符的一部分

### Fixed
- 修复用户修改会话名称可能导致冲突的问题
```

**Step 3: 更新 README.md（如果需要）**

在"功能"部分添加：
```markdown
- ✅ 自定义会话名称，支持随时修改
- ✅ 跨设备同步会话数据
```

**Step 4: 提交文档更新**

```bash
git add CHANGELOG.md README.md
git commit -m "docs: update changelog for v1.1.0

记录会话 Key 优化功能：
- 新增：会话名称可随时修改
- 变更：使用 UUID 作为会话标识符
- 修复：同名会话冲突问题

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## 完成检查清单

### Task 8: 最终验证

**Step 1: 检查所有提交**

```bash
git log --oneline --graph -10
```

预期输出：看到所有相关的 commit

**Step 2: 确认版本号**

```bash
cat h5/package.json | grep version
```

预期输出：`"version": "1.1.0"`

**Step 3: 运行所有测试**

```bash
cd h5
npm test

cd ../backend
npm test
```

预期输出：所有测试通过

**Step 4: 代码审查检查清单**

- [ ] 后端 UUID 生成逻辑正确
- [ ] 冲突重试机制实现（最多3次）
- [ ] 前端 API 调用正确传递 null
- [ ] IndexedDB 存储使用正确的 sessionKey
- [ ] 国际化字符串已添加
- [ ] 版本号已更新
- [ ] 测试覆盖主要场景
- [ ] 文档已更新

**Step 5: 性能检查（可选）**

```bash
# 检查前端构建大小
cd h5
npm run build
ls -lh dist/

# 检查是否有性能回退
# （如果有性能测试）
```

**Step 6: 创建 Release 标签（可选）**

```bash
git tag -a v1.1.0 -m "Release v1.1.0: Session Key Optimization"
git push origin v1.1.0
```

---

## 回滚计划

如果发现问题需要回滚：

**Step 1: 回滚代码**

```bash
git revert <commit-range>
```

或回滚到之前的版本：
```bash
git checkout v1.0.0
```

**Step 2: 回滚数据库（如果有 schema 变更）**

```sql
-- 根据实际变更编写回滚脚本
```

**Step 3: 通知用户**

如果已发布，通知用户回滚原因和解决方案。

---

## 常见问题

### Q: 为什么选择 UUID v4？

A: UUID v4 使用随机生成，冲突概率极低（≈10^-37），无需中央协调即可保证全局唯一性。

### Q: 为什么重试3次而不是更多？

A: UUID v4 冲突概率极低，连续3次冲突的概率几乎为0。3次是合理的上限，避免极端情况下的无限循环。

### Q: 现有会话会受影响吗？

A: 不会。新的 sessionKey 格式只影响新创建的会话，现有会话继续使用旧的 sessionKey。

### Q: 如何验证 UUID 真的唯一？

A: 通过数据库的唯一约束确保。如果冲突，会触发数据库错误，我们的重试机制会处理这种情况。

---

## 参考资料

- [RFC 4122: UUID](https://datatracker.ietf.org/doc/html/rfc4122)
- [语义化版本规范](https://semver.org/lang/zh-CN/)
- 项目设计文档：`docs/plans/2026-03-30-session-key-optimization-design.md`
