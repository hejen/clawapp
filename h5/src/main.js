import './style.css'
import { wsClient } from './api-client.js'
import { createChatPage, initChatUI, setSessionKey, loadHistory } from './chat-ui.js'
import { initI18n, t, onLangChange } from './i18n.js'
import { initTheme } from './theme.js'
import { initOfflineHandler } from './offline-queue.js'
import { authManager } from './auth.js'
import { api } from './api.js'

const STORAGE_KEY = 'clawapp-config'
const GUIDE_KEY = 'clawapp-guide-shown'

// 初始化 i18n 和主题
initI18n()
initTheme()

const app = document.getElementById('app')

function getConfig() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null } catch { return null }
}

function saveConfig(host, token) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ host, token }))
}

function createSetupPage() {
  const page = document.createElement('div')
  page.className = 'page setup-page'
  page.id = 'setup-page'
  const defaultHost = location.hostname && location.hostname !== 'localhost'
    ? (location.port ? `${location.hostname}:${location.port}` : location.hostname)
    : 'localhost:3210'

  page.innerHTML = `
    <div class="setup-card">
      <div class="setup-logo">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
          <defs>
            <linearGradient id="sg" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#e94560"/><stop offset="100%" stop-color="#0f3460"/></linearGradient>
          </defs>
          <rect width="64" height="64" rx="14" class="logo-bg"/>
          <path d="M32 12C20.954 12 12 20.954 12 32s8.954 20 20 20c2.5 0 4.9-.46 7.1-1.3L48 54l-1.3-8.9A19.9 19.9 0 0052 32c0-11.046-8.954-20-20-20z" stroke="url(#sg)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="24" cy="32" r="3" fill="#e94560"/><circle cx="32" cy="32" r="3" fill="#e94560"/><circle cx="40" cy="32" r="3" fill="#e94560"/>
        </svg>
        <h1>${t('app.title')}</h1>
        <p>${t('app.subtitle')}</p>
      </div>
      <div class="form-group">
        <label>${t('setup.host')}</label>
        <input type="text" id="input-host" placeholder="${t('setup.host.placeholder')}" value="${defaultHost}" />
      </div>
      <div class="form-group">
        <label>${t('setup.token')}</label>
        <input type="password" id="input-token" placeholder="${t('setup.token.placeholder')}" />
      </div>
      <button class="btn-primary" id="connect-btn">${t('setup.connect')}</button>
      <div class="setup-error" id="setup-error"></div>
      <div class="setup-tips">
        <button class="setup-tips-toggle" type="button" onclick="this.parentElement.classList.toggle('open')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          ${t('setup.tips.toggle')}
          <svg class="setup-tips-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="setup-tips-content">
          <div class="setup-tips-item">
            <span class="setup-tips-label">${t('setup.tips.host.title')}</span>
            <span class="setup-tips-desc">${t('setup.tips.host.desc').replace(/\n/g, '<br>')}</span>
          </div>
          <div class="setup-tips-item">
            <span class="setup-tips-label">${t('setup.tips.token.title')}</span>
            <span class="setup-tips-desc">${t('setup.tips.token.desc').replace(/\n/g, '<br>')}</span>
          </div>
          <a class="setup-tips-link" href="https://github.com/qingchencloud/clawapp" target="_blank" rel="noopener">${t('setup.tips.doc')} →</a>
        </div>
      </div>
    </div>
    <div class="setup-footer">
      <a href="https://clawapp.qt.cool" target="_blank" rel="noopener">Powered by 晴辰云 · clawapp.qt.cool</a>
    </div>
  `
  return page
}

/** 首次运行：将登录页变为「设置密码」表单 */
function showFirstRunSetup(hostInput, errorEl) {
  const card = document.querySelector('.setup-card')
  if (!card) return

  // 替换标题
  const logo = card.querySelector('.setup-logo')
  if (logo) {
    logo.querySelector('h1').textContent = t('setup.firstrun.title')
    logo.querySelector('p').textContent = t('setup.firstrun.subtitle')
  }

  // 隐藏原始 host/token 表单
  card.querySelectorAll('.form-group').forEach(g => g.style.display = 'none')
  const tipsEl = card.querySelector('.setup-tips')
  if (tipsEl) tipsEl.style.display = 'none'

  // 插入密码设置表单
  const setupForm = document.createElement('div')
  setupForm.className = 'setup-firstrun'
  setupForm.innerHTML = `
    <div class="form-group">
      <label>${t('setup.firstrun.password')}</label>
      <input type="password" id="firstrun-pwd" placeholder="${t('setup.firstrun.password.placeholder')}" />
    </div>
    <div class="form-group">
      <label>${t('setup.firstrun.confirm')}</label>
      <input type="password" id="firstrun-pwd-confirm" placeholder="${t('setup.firstrun.confirm.placeholder')}" />
    </div>
  `
  const connectBtn = document.getElementById('connect-btn')
  card.insertBefore(setupForm, connectBtn)

  connectBtn.textContent = t('setup.firstrun.submit')

  // 替换按钮行为
  connectBtn.onclick = async () => {
    const pwd = document.getElementById('firstrun-pwd').value
    const pwd2 = document.getElementById('firstrun-pwd-confirm').value
    errorEl.textContent = ''

    if (!pwd || pwd.length < 4) { errorEl.textContent = t('setup.firstrun.error.short'); return }
    if (pwd !== pwd2) { errorEl.textContent = t('setup.firstrun.error.mismatch'); return }

    connectBtn.disabled = true
    connectBtn.textContent = t('setup.connecting')
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd })
      })
      const data = await res.json()
      if (!data.ok) {
        errorEl.textContent = t('setup.firstrun.error.fail') + (data.error || '')
        connectBtn.disabled = false
        connectBtn.textContent = t('setup.firstrun.submit')
        return
      }
      // 设置成功，自动连接
      const host = hostInput.value.trim() || 'localhost:3210'
      doConnect(host, data.token, errorEl, connectBtn)
    } catch (e) {
      errorEl.textContent = t('setup.firstrun.error.fail') + e.message
      connectBtn.disabled = false
      connectBtn.textContent = t('setup.firstrun.submit')
    }
  }

  // Enter 键提交
  const confirmInput = document.getElementById('firstrun-pwd-confirm')
  if (confirmInput) confirmInput.onkeydown = (e) => { if (e.key === 'Enter') connectBtn.click() }
}

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('hidden', p.id !== pageId))
}

let chatInitialized = false

async function initApp() {
  try {
    // Initialize authentication first
    const authInfo = await authManager.init()

    // NO AUTH - Show login page for new users
    if (!authInfo) {
      showLoginPage()
      return
    }

    // JWT user authentication: skip setup page, connect directly
  if (authInfo && authInfo.type === 'jwt') {
    const config = getConfig()
    const host = config?.host || window.location.hostname
    const token = authInfo.token

    // Create pages but hide setup page
    const setupPage = createSetupPage()
    const chatPage = createChatPage()
    app.appendChild(setupPage)
    app.appendChild(chatPage)

    // Initialize offline handler
    initOfflineHandler()

    // Setup Gateway ready callback
    wsClient.onReady((hello, sessionKey) => {
      setSessionKey(sessionKey)
      showPage('chat-page')
      if (!chatInitialized) {
        chatInitialized = true
        initChatUI(() => {
          wsClient.disconnect()
          showPage('setup-page')
          chatInitialized = false
        })
      }
      requestAnimationFrame(() => loadHistory())
      showGuideIfNeeded()
    })

    // Connect directly with JWT token
    await connectWithToken(host, token)
    return
  }

  // Token user or config-based auth: continue with existing flow
  const setupPage = createSetupPage()
  const chatPage = createChatPage()
  app.appendChild(setupPage)
  app.appendChild(chatPage)

  const config = getConfig()
  const connectBtn = document.getElementById('connect-btn')
  const hostInput = document.getElementById('input-host')
  const tokenInput = document.getElementById('input-token')
  const errorEl = document.getElementById('setup-error')

  // Pre-fill token from URL if available (token auth mode)
  if (authInfo && authInfo.type === 'token') {
    tokenInput.value = authInfo.token
  }

  if (config) {
    hostInput.value = config.host
    if (!authInfo || authInfo.type !== 'token') {
      tokenInput.value = config.token
    }
  }

  // 首次运行检测
  if (!config?.token && (!authInfo || authInfo.type !== 'token')) {
    fetch('/api/setup-hint').then(r => r.json()).then(data => {
      if (data.ok && data.firstRun) {
        showFirstRunSetup(hostInput, errorEl)
      }
    }).catch(() => {})
  }

  connectBtn.onclick = () => {
    const host = hostInput.value.trim()
    const token = tokenInput.value.trim()
    if (!host) { errorEl.textContent = t('setup.error.host'); return }
    if (!token) { errorEl.textContent = t('setup.error.token'); return }
    errorEl.textContent = ''
    connectBtn.disabled = true
    connectBtn.textContent = t('setup.connecting')
    doConnect(host, token, errorEl, connectBtn)
  }

  // 监听连接状态变化，显示错误信息
  wsClient.onStatusChange((status, errorMsg) => {
    if (status === 'auth_failed' || (status === 'error' && errorMsg)) {
      // 认证失败或错误，停止重试，显示错误
      errorEl.textContent = errorMsg || t('setup.error.auth')
      connectBtn.disabled = false
      connectBtn.textContent = t('setup.connect')
    }
  })

  tokenInput.onkeydown = (e) => { if (e.key === 'Enter') connectBtn.click() }

  // 初始化离线队列处理
  initOfflineHandler()

  // 注册 Gateway 就绪回调 - 每次连接/重连都会触发
  wsClient.onReady((hello, sessionKey) => {
    setSessionKey(sessionKey)  // 内部会优先恢复 localStorage 保存的会话
    showPage('chat-page')
    if (!chatInitialized) {
      chatInitialized = true
      initChatUI(() => {
        wsClient.disconnect()
        showPage('setup-page')
        chatInitialized = false
      })
    }
    // 确保 DOM 就绪后再加载历史
    requestAnimationFrame(() => loadHistory())
    // 首次使用显示引导
    showGuideIfNeeded()
  })

  // 自动连接
  if (config?.host && config?.token) {
    connectBtn.disabled = true
    connectBtn.textContent = t('setup.connecting')
    doConnect(config.host, config.token, errorEl, connectBtn)
  } else if (authInfo && authInfo.type === 'token' && hostInput.value) {
    // Auto-connect for token users with host from config
    const host = hostInput.value.trim()
    connectBtn.disabled = true
    connectBtn.textContent = t('setup.connecting')
    doConnect(host, authInfo.token, errorEl, connectBtn)
  }

  // 语言切换时重建连接页
  onLangChange(() => {
    if (document.getElementById('setup-page')?.classList.contains('hidden')) return
    const newSetup = createSetupPage()
    const oldSetup = document.getElementById('setup-page')
    oldSetup.replaceWith(newSetup)
    // 重新绑定事件
    const btn = document.getElementById('connect-btn')
    const hi = document.getElementById('input-host')
    const ti = document.getElementById('input-token')
    const err = document.getElementById('setup-error')
    if (config) { hi.value = config.host; ti.value = config.token }
    btn.onclick = () => {
      const host = hi.value.trim()
      const token = ti.value.trim()
      if (!host) { err.textContent = t('setup.error.host'); return }
      if (!token) { err.textContent = t('setup.error.token'); return }
      err.textContent = ''
      btn.disabled = true
      btn.textContent = t('setup.connecting')
      doConnect(host, token, err, btn)
    }
    ti.onkeydown = (e) => { if (e.key === 'Enter') btn.click() }
  })
  } catch (error) {
    console.error('Auth initialization failed:', error)
    // Show login page on error
    showLoginPage()
  }
}

function doConnect(host, token, errorEl, connectBtn) {
  wsClient.disconnect()

  // 超时处理
  let done = false
  let unsub = null
  const timeout = setTimeout(() => {
    if (done) return
    done = true
    if (unsub) unsub()
    errorEl.textContent = t('setup.error.timeout')
    connectBtn.disabled = false
    connectBtn.textContent = t('setup.connect')
    // 不 disconnect — ws-client 内部会自动重连
    // 如果后续重连成功，onReady 回调会自动跳转到聊天页
  }, 20000)

  // 监听错误（502 Gateway 不可用等）— 立即停止等待
  const prevOnStatus = wsClient._onStatusChange
  wsClient.onStatusChange((status, errorMsg) => {
    if (status === 'error' && errorMsg && !done) {
      done = true
      clearTimeout(timeout)
      if (unsub) unsub()
      errorEl.textContent = errorMsg
      connectBtn.disabled = false
      connectBtn.textContent = t('setup.connect')
    }
    if (status === 'auth_failed' && !done) {
      done = true
      clearTimeout(timeout)
      if (unsub) unsub()
      errorEl.textContent = errorMsg || t('setup.error.auth')
      connectBtn.disabled = false
      connectBtn.textContent = t('setup.connect')
    }
  })

  // 一次性监听就绪
  unsub = wsClient.onReady(() => {
    if (done) return
    done = true
    clearTimeout(timeout)
    unsub()
    saveConfig(host, token)
    connectBtn.disabled = false
    connectBtn.textContent = t('setup.connect')
    errorEl.textContent = ''
  })

  wsClient.connect(host, token)
}

/**
 * Connect with JWT token (for authenticated users)
 * Simplified version of doConnect without UI elements
 */
async function connectWithToken(host, token) {
  wsClient.disconnect()
  wsClient.connect(host, token)
  // The onReady callback is already registered in initApp
}

/** 新用户引导 */
function showGuideIfNeeded() {
  if (localStorage.getItem(GUIDE_KEY)) return
  localStorage.setItem(GUIDE_KEY, '1')

  const overlay = document.createElement('div')
  overlay.className = 'guide-overlay'
  overlay.innerHTML = `
    <div class="guide-card">
      <h2>${t('guide.welcome')}</h2>
      <div class="guide-tips">
        <div class="guide-tip">${t('guide.tip1')}</div>
        <div class="guide-tip">${t('guide.tip2')}</div>
        <div class="guide-tip">${t('guide.tip3')}</div>
        <div class="guide-tip">${t('guide.tip4')}</div>
        <div class="guide-tip">${t('guide.tip5')}</div>
        <div class="guide-tip">${t('guide.tip6')}</div>
      </div>
      <button class="btn-primary guide-btn">${t('guide.start')}</button>
    </div>
  `
  overlay.querySelector('.guide-btn').onclick = () => overlay.remove()
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove() }
  document.body.appendChild(overlay)
}

// ============ Login Page ============
function showLoginPage() {
  const loginHtml = `
    <div id="loginPage" class="login-container">
      <h1>${t('login.title')}</h1>
      <p class="subtitle">${t('login.subtitle')}</p>

      <div id="loginError" class="error"></div>
      <div id="loginSuccess" class="success"></div>

      <div class="tabs">
        <button class="tab active" data-tab="login">${t('login.tab.login')}</button>
        <button class="tab" data-tab="register">${t('login.tab.register')}</button>
      </div>

      <form id="loginForm">
        <div class="form-group">
          <label for="username">${t('login.username')}</label>
          <input type="text" id="username" name="username" required autocomplete="username">
        </div>

        <div class="form-group">
          <label for="password">${t('login.password')}</label>
          <input type="password" id="password" name="password" required autocomplete="current-password">
        </div>

        <button type="submit" class="btn" id="loginBtn">
          <span id="loginBtnText">${t('login.btn')}</span>
        </button>
      </form>

      <form id="registerForm" style="display: none;">
        <div class="form-group">
          <label for="regUsername">${t('login.username')}</label>
          <input type="text" id="regUsername" name="username" required autocomplete="username">
        </div>

        <div class="form-group">
          <label for="regEmail">${t('login.email')}</label>
          <input type="email" id="regEmail" name="email" autocomplete="email">
        </div>

        <div class="form-group">
          <label for="regPassword">${t('login.password')}</label>
          <input type="password" id="regPassword" name="password" required autocomplete="new-password">
        </div>

        <div class="form-group">
          <label for="regPasswordConfirm">${t('login.confirm')}</label>
          <input type="password" id="regPasswordConfirm" name="passwordConfirm" required autocomplete="new-password">
        </div>

        <button type="submit" class="btn" id="registerBtn">
          <span id="registerBtnText">${t('login.register.btn')}</span>
        </button>
      </form>
    </div>

    <style>
      .login-container {
        max-width: 400px;
        margin: 100px auto;
        padding: 40px;
        background: white;
        border-radius: 12px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.1);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .login-container h1 {
        text-align: center;
        margin-bottom: 10px;
      }
      .subtitle {
        text-align: center;
        color: #666;
        margin-bottom: 30px;
      }
      .tabs {
        display: flex;
        margin-bottom: 20px;
        border-bottom: 1px solid #ddd;
      }
      .tab {
        flex: 1;
        padding: 10px;
        border: none;
        background: none;
        cursor: pointer;
        border-bottom: 2px solid transparent;
      }
      .tab.active {
        border-bottom-color: #667eea;
        color: #667eea;
      }
      .form-group {
        margin-bottom: 15px;
      }
      .form-group label {
        display: block;
        margin-bottom: 5px;
        font-weight: 500;
      }
      .form-group input {
        width: 100%;
        padding: 10px;
        border: 1px solid #ddd;
        border-radius: 6px;
        font-size: 14px;
      }
      .btn {
        width: 100%;
        padding: 12px;
        background: #667eea;
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 16px;
        cursor: pointer;
      }
      .btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .error {
        background: #fee;
        color: #c33;
        padding: 10px;
        border-radius: 6px;
        margin-bottom: 15px;
        display: none;
      }
      .error.show {
        display: block;
      }
      .success {
        background: #efe;
        color: #3c3;
        padding: 10px;
        border-radius: 6px;
        margin-bottom: 15px;
        display: none;
      }
      .success.show {
        display: block;
      }
    </style>
  `

  document.body.innerHTML = loginHtml

  // Setup tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
      tab.classList.add('active')

      const tabName = tab.dataset.tab
      if (tabName === 'login') {
        document.getElementById('loginForm').style.display = 'block'
        document.getElementById('registerForm').style.display = 'none'
      } else {
        document.getElementById('loginForm').style.display = 'none'
        document.getElementById('registerForm').style.display = 'block'
      }
    })
  })

  // Setup login form
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault()

    const username = document.getElementById('username').value
    const password = document.getElementById('password').value
    const btn = document.getElementById('loginBtn')
    const btnText = document.getElementById('loginBtnText')
    const errorEl = document.getElementById('loginError')

    // Reset messages
    errorEl.classList.remove('show')
    btn.disabled = true
    btnText.textContent = t('login.btn.loading')

    try {
      const result = await authManager.login(username, password)
      api.setToken(result.token)

      // Reload page to enter chat
      window.location.reload()
    } catch (error) {
      errorEl.textContent = error.message
      errorEl.classList.add('show')
      btn.disabled = false
      btnText.textContent = t('login.btn')
    }
  })

  // Setup register form
  document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault()

    const username = document.getElementById('regUsername').value
    const email = document.getElementById('regEmail').value
    const password = document.getElementById('regPassword').value
    const passwordConfirm = document.getElementById('regPasswordConfirm').value
    const btn = document.getElementById('registerBtn')
    const btnText = document.getElementById('registerBtnText')
    const errorEl = document.getElementById('loginError')
    const successEl = document.getElementById('loginSuccess')

    // Reset messages
    errorEl.classList.remove('show')
    successEl.classList.remove('show')

    // Validate
    if (password !== passwordConfirm) {
      errorEl.textContent = t('login.error.mismatch')
      errorEl.classList.add('show')
      return
    }

    btn.disabled = true
    btnText.textContent = t('login.register.btn.loading')

    try {
      await authManager.register(username, password, email)

      successEl.textContent = t('login.register.success')
      successEl.classList.add('show')

      // Switch to login tab
      setTimeout(() => {
        document.querySelector('[data-tab="login"]').click()
      }, 1500)
    } catch (error) {
      errorEl.textContent = error.message
      errorEl.classList.add('show')
    } finally {
      btn.disabled = false
      btnText.textContent = t('login.register.btn')
    }
  })
}

initApp()
