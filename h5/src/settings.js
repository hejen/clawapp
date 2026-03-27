/**
 * 设置面板 - 主题/语言/连接管理
 */

import { getTheme, setTheme } from './theme.js'
import { getLang, setLang, t, onLangChange } from './i18n.js'
import { requestPermission, isSupported as isNotifySupported } from './notify.js'
import { authManager } from './auth.js'

const LAYOUT_KEY = 'clawapp-layout'
const DETAILED_MODE_KEY = 'clawapp-detailed-mode'

let _onDisconnect = null

/**
 * 获取详细模式设置
 */
export function getDetailedMode() {
  const value = localStorage.getItem(DETAILED_MODE_KEY)
  return value === 'true'  // 默认 false (简洁模式)
}

/**
 * 设置详细模式
 */
export function setDetailedMode(enabled) {
  localStorage.setItem(DETAILED_MODE_KEY, enabled ? 'true' : 'false')
}

function getLayout() {
  return localStorage.getItem(LAYOUT_KEY) || 'auto'
}

function setLayout(value) {
  localStorage.setItem(LAYOUT_KEY, value)
  if (value === 'auto') delete document.documentElement.dataset.layout
  else document.documentElement.dataset.layout = value
}

export function initSettings(onDisconnect) {
  _onDisconnect = onDisconnect
  // 启动时恢复布局
  const saved = getLayout()
  if (saved !== 'auto') document.documentElement.dataset.layout = saved
}

export function showSettings() {
  document.querySelector('.settings-overlay')?.remove()
  document.querySelector('.settings-panel')?.remove()

  const overlay = document.createElement('div')
  overlay.className = 'settings-overlay cmd-overlay visible'
  overlay.onclick = () => closeSettings()

  const panel = document.createElement('div')
  panel.className = 'settings-panel cmd-panel visible'

  const currentTheme = getTheme()
  const currentLang = getLang()
  const currentLayout = getLayout()
  const currentDetailedMode = getDetailedMode()

  panel.innerHTML = `
    <div class="cmd-panel-header">
      <h3>${t('settings.title')}</h3>
      <button class="close-btn">×</button>
    </div>
    <div class="settings-content cmd-list">
      <div class="settings-section">
        <div class="settings-label">${t('settings.theme')}</div>
        <div class="settings-toggle-group" id="theme-toggle">
          <button class="settings-toggle ${currentTheme === 'light' ? 'active' : ''}" data-value="light">
            ☀️ ${t('settings.theme.light')}
          </button>
          <button class="settings-toggle ${currentTheme === 'dark' ? 'active' : ''}" data-value="dark">
            🌙 ${t('settings.theme.dark')}
          </button>
          <button class="settings-toggle ${currentTheme === 'auto' ? 'active' : ''}" data-value="auto">
            🔄 ${t('settings.theme.auto')}
          </button>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-label">${t('settings.lang')}</div>
        <div class="settings-toggle-group" id="lang-toggle">
          <button class="settings-toggle ${currentLang === 'zh-CN' ? 'active' : ''}" data-value="zh-CN">
            中文
          </button>
          <button class="settings-toggle ${currentLang === 'en' ? 'active' : ''}" data-value="en">
            English
          </button>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-label">${t('settings.layout')}</div>
        <div class="settings-toggle-group" id="layout-toggle">
          <button class="settings-toggle ${currentLayout === 'compact' ? 'active' : ''}" data-value="compact">
            ${t('settings.layout.compact')}
          </button>
          <button class="settings-toggle ${currentLayout === 'auto' ? 'active' : ''}" data-value="auto">
            ${t('settings.layout.auto')}
          </button>
          <button class="settings-toggle ${currentLayout === 'wide' ? 'active' : ''}" data-value="wide">
            ${t('settings.layout.wide')}
          </button>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-label">${t('settings.detailedMode')}</div>
        <div class="settings-desc" style="font-size:12px;color:#666;margin-bottom:8px">${t('settings.detailedMode.desc')}</div>
        <div class="settings-toggle-group" id="detailed-mode-toggle">
          <button class="settings-toggle ${!currentDetailedMode ? 'active' : ''}" data-value="false">
            ${t('settings.detailedMode.simple')}
          </button>
          <button class="settings-toggle ${currentDetailedMode ? 'active' : ''}" data-value="true">
            ${t('settings.detailedMode.detailed')}
          </button>
        </div>
      </div>

      <div class="settings-section" style="margin-top:16px">
        <div class="settings-label">${t('settings.notify')}</div>
        <div id="notify-section">${renderNotifySection()}</div>
      </div>

      <div class="settings-section" style="margin-top:16px">
        <div class="settings-label">${t('settings.password')}</div>
        <div class="settings-pwd-form" id="pwd-form">
          <input type="password" id="pwd-current" class="settings-pwd-input" placeholder="${t('settings.password.current')}" />
          <input type="password" id="pwd-new" class="settings-pwd-input" placeholder="${t('settings.password.new')}" />
          <input type="password" id="pwd-confirm" class="settings-pwd-input" placeholder="${t('settings.password.confirm')}" />
          <div class="settings-pwd-msg" id="pwd-msg"></div>
          <button class="settings-primary-btn" id="pwd-submit">${t('settings.password.submit')}</button>
        </div>
      </div>

      <div class="settings-section" style="margin-top:16px">
        <button class="settings-disconnect-btn" id="settings-disconnect">
          ${t('settings.disconnect')}
        </button>
        ${authManager.isAuthenticated() && authManager.getAuthInfo().type === 'jwt' ? `
        <button class="settings-disconnect-btn" id="settings-logout" style="margin-top:8px">
          ${t('settings.logout')}
        </button>
        ` : ''}
      </div>

      <div class="settings-about">
        <div class="settings-about-header">
          <span class="settings-about-logo">💬</span>
          <div>
            <div class="settings-about-name">OpenClaw Chat</div>
            <div class="settings-about-ver">${t('about.version')} ${__APP_VERSION__}</div>
          </div>
        </div>
      </div>
    </div>
  `

  panel.querySelector('.close-btn').onclick = () => closeSettings()

  // 主题切换
  panel.querySelectorAll('#theme-toggle .settings-toggle').forEach(btn => {
    btn.onclick = () => {
      const value = btn.dataset.value
      setTheme(value)
      panel.querySelectorAll('#theme-toggle .settings-toggle').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
    }
  })

  // 语言切换
  panel.querySelectorAll('#lang-toggle .settings-toggle').forEach(btn => {
    btn.onclick = () => {
      const value = btn.dataset.value
      setLang(value)
      panel.querySelectorAll('#lang-toggle .settings-toggle').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      // 语言切换后重建面板
      closeSettings()
      showSettings()
    }
  })

  // 布局切换
  panel.querySelectorAll('#layout-toggle .settings-toggle').forEach(btn => {
    btn.onclick = () => {
      setLayout(btn.dataset.value)
      panel.querySelectorAll('#layout-toggle .settings-toggle').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
    }
  })

  // 详细模式切换
  panel.querySelectorAll('#detailed-mode-toggle .settings-toggle').forEach(btn => {
    btn.onclick = () => {
      const value = btn.dataset.value === 'true'
      setDetailedMode(value)
      panel.querySelectorAll('#detailed-mode-toggle .settings-toggle').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      // 触发自定义事件，通知其他模块设置已更改
      window.dispatchEvent(new CustomEvent('detailed-mode-change', { detail: { enabled: value } }))
    }
  })

  // 通知按鈕
  const notifyBtn = panel.querySelector('#notify-enable-btn')
  if (notifyBtn) {
    notifyBtn.onclick = async () => {
      const permission = await requestPermission()
      const section = panel.querySelector('#notify-section')
      if (section) section.innerHTML = renderNotifySection()
    }
  }

  // 修改密码
  const pwdSubmit = panel.querySelector('#pwd-submit')
  if (pwdSubmit) {
    pwdSubmit.onclick = async () => {
      const cur = panel.querySelector('#pwd-current').value
      const nw = panel.querySelector('#pwd-new').value
      const cf = panel.querySelector('#pwd-confirm').value
      const msg = panel.querySelector('#pwd-msg')
      msg.textContent = ''
      msg.className = 'settings-pwd-msg'

      if (!nw || nw.length < 4) { msg.textContent = t('settings.password.error.short'); msg.classList.add('error'); return }
      if (nw !== cf) { msg.textContent = t('settings.password.error.mismatch'); msg.classList.add('error'); return }

      pwdSubmit.disabled = true
      try {
        const res = await fetch('/api/change-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentToken: cur, newToken: nw })
        })
        const data = await res.json()
        if (!data.ok) {
          msg.textContent = res.status === 401 ? t('settings.password.error.wrong') : (data.error || t('settings.password.error.fail'))
          msg.classList.add('error')
        } else {
          msg.textContent = t('settings.password.success')
          msg.classList.add('success')
          panel.querySelector('#pwd-current').value = ''
          panel.querySelector('#pwd-new').value = ''
          panel.querySelector('#pwd-confirm').value = ''
          // 更新本地存储的 token
          try {
            const cfg = JSON.parse(localStorage.getItem('clawapp-config') || '{}')
            if (cfg.token) { cfg.token = nw; localStorage.setItem('clawapp-config', JSON.stringify(cfg)) }
          } catch {}
        }
      } catch (e) {
        msg.textContent = t('settings.password.error.fail')
        msg.classList.add('error')
      } finally {
        pwdSubmit.disabled = false
      }
    }
  }

  // 断开连接
  panel.querySelector('#settings-disconnect').onclick = () => {
    closeSettings()
    _onDisconnect?.()
  }

  // 退出登录（仅 JWT 用户）
  const logoutBtn = panel.querySelector('#settings-logout')
  if (logoutBtn) {
    logoutBtn.onclick = () => {
      closeSettings()
      authManager.logout()
    }
  }

  document.body.appendChild(overlay)
  document.body.appendChild(panel)
}

function closeSettings() {
  document.querySelector('.settings-overlay')?.remove()
  document.querySelector('.settings-panel')?.remove()
}

/**
 * 根据当前通知权限状态渲染对应 HTML 片段
 */
function renderNotifySection() {
  if (!isNotifySupported) {
    return `<span class="settings-notify-status muted">${t('settings.notify.unsupported')}</span>`
  }
  const perm = Notification.permission
  if (perm === 'granted') {
    return `<span class="settings-notify-status ok">✓ ${t('settings.notify.granted')}</span>`
  }
  if (perm === 'denied') {
    return `<span class="settings-notify-status warn">${t('settings.notify.denied')}</span>`
  }
  // 'default' — 未请求过
  return `<button class="settings-toggle" id="notify-enable-btn">${t('settings.notify.enable')}</button>`
}
