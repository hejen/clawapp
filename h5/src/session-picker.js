/**
 * 会话选择器 - 会话列表/新建/删除/切换 UI
 */

import { wsClient, uuid } from './api-client.js'
import { api } from './api.js'
import { t, formatRelativeTime } from './i18n.js'
import { getAgentDisplayName } from './chat-ui.js'

let _sessionKey = ''
let _onSwitch = null
let _onSystemMsg = null
let _onClearSession = null  // 删除当前会话时的回调

function escapeText(str) {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

/**
 * 初始化会话选择器
 * @param {object} opts
 * @param {() => string} opts.getSessionKey - 获取当前 sessionKey
 * @param {(key: string) => void} opts.onSwitch - 切换会话回调
 * @param {(text: string) => void} opts.onSystemMsg - 系统消息回调
 * @param {() => void} opts.onClear - 清空当前会话回调（删除当前会话时调用）
 */
export function initSessionPicker(opts) {
  _onSwitch = opts.onSwitch
  _onSystemMsg = opts.onSystemMsg
  _onClearSession = opts.onClear
}

export function setPickerSessionKey(key) {
  _sessionKey = key
}

/** 会话选择面板 */
export async function showSessionPicker() {
  document.querySelector('.session-overlay')?.remove()
  document.querySelector('.session-panel')?.remove()

  const overlay = document.createElement('div')
  overlay.className = 'session-overlay cmd-overlay visible'
  overlay.onclick = () => closeSessionPicker()

  const panel = document.createElement('div')
  panel.className = 'session-panel cmd-panel visible'
  panel.innerHTML = `
    <div class="cmd-panel-header">
      <h3>${t('session.title')}</h3>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="session-action-btn" id="session-new-btn" title="${t('session.new')}">＋</button>
        <button class="close-btn">×</button>
      </div>
    </div>
    <div class="session-list cmd-list">
      <div class="session-loading">${t('session.loading')}</div>
    </div>
  `
  panel.querySelector('.close-btn').onclick = () => closeSessionPicker()
  panel.querySelector('#session-new-btn').onclick = () => promptNewSession()

  document.body.appendChild(overlay)
  document.body.appendChild(panel)

  await refreshSessionList()
}

/** 刷新会话列表 */
export async function refreshSessionList() {
  const listEl = document.querySelector('.session-list')
  if (!listEl) return
  listEl.innerHTML = '<div class="session-loading">' + t('session.loading') + '</div>'

  try {
    // Use user's sessions from /api/sessions instead of Gateway's sessions.list
    const result = await api.listSessions()
    const sessions = result || []
    listEl.innerHTML = ''

    if (!sessions.length) {
      listEl.innerHTML = '<div class="session-loading">' + t('session.empty') + '</div>'
      return
    }

    sessions.forEach(s => {
      const key = s.sessionKey || s.key || ''
      const sessionId = s.id
      const isActive = key === _sessionKey
      const item = document.createElement('div')
      item.className = `cmd-item${isActive ? ' session-active' : ''}`

      // 解析会话信息
      // 新格式: agent:{agentId}:{userId}:{uuid}
      const parts = key.split(':')
      const agent = parts[1] || ''
      const agentLabel = agent ? getAgentDisplayName(agent) : ''
      let name = s.title || ''
      let detail = agent !== 'main' ? agentLabel : ''

      // 最后活跃时间
      const updated = s.updatedAt || s.lastActivity
      const timeStr = formatRelativeTime(updated)

      item.innerHTML = `
        <div class="session-item-content" style="flex:1;min-width:0">
          <div class="cmd-text" style="font-family:inherit;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeText(name)}</div>
          ${detail ? `<div class="cmd-desc">${escapeText(detail)}</div>` : ''}
        </div>
        ${timeStr ? `<div class="cmd-desc" style="flex-shrink:0">${timeStr}</div>` : ''}
        ${isActive ? '<div style="color:var(--success);flex-shrink:0">●</div>' : ''}
        <button class="session-delete-btn" title="${t('session.delete')}">✕</button>
      `

      // 点击切换会话
      item.querySelector('.session-item-content').onclick = () => {
        if (key === _sessionKey) { closeSessionPicker(); return }
        _onSwitch?.(key, name, sessionId)  // 传递会话名称和数据库 ID
        closeSessionPicker()
      }

      // 删除按钮 - use sessionId instead of sessionKey
      item.querySelector('.session-delete-btn').onclick = (e) => {
        e.stopPropagation()
        confirmDeleteSession(sessionId, key, name)
      }

      listEl.appendChild(item)
    })
  } catch (e) {
    listEl.innerHTML = `<div class="session-loading" style="color:var(--danger)">${t('session.load.error')}: ${escapeText(e.message)}</div>`
  }
}

/** 新建会话弹窗 */
export async function promptNewSession() {
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
    if (!name) {
      // 提示用户输入名称
      const input = dialog.querySelector('#new-session-name')
      input.style.borderColor = 'var(--danger, #e74c3c)'
      input.placeholder = t('session.new.name.required') || '请输入会话名称'
      input.focus()
      setTimeout(() => { input.style.borderColor = '' }, 2000)
      return
    }
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

/** 确认删除会话 */
function confirmDeleteSession(sessionId, key, name) {
  const overlay = document.createElement('div')
  overlay.className = 'session-overlay cmd-overlay visible'

  const dialog = document.createElement('div')
  dialog.className = 'session-dialog'
  dialog.innerHTML = `
    <h3>${t('session.delete')}</h3>
    <p style="color:var(--text-secondary);font-size:14px;margin:12px 0">
      ${t('session.delete.confirm', { name: escapeText(name) })}<br>${t('session.delete.warning')}
    </p>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="session-dialog-btn cancel">${t('cancel')}</button>
      <button class="session-dialog-btn danger">${t('session.delete.btn')}</button>
    </div>
  `

  overlay.onclick = (e) => { if (e.target === overlay) { overlay.remove(); dialog.remove() } }
  dialog.querySelector('.cancel').onclick = () => { overlay.remove(); dialog.remove() }
  dialog.querySelector('.danger').onclick = async () => {
    overlay.remove()
    dialog.remove()
    try {
      await api.deleteSession(sessionId)
      // 如果删的是当前会话，清空会话状态并禁用输入
      if (key === _sessionKey) {
        _onClearSession?.()
      }
      await refreshSessionList()
    } catch (e) {
      _onSystemMsg?.(`${t('session.delete.fail')}: ${e.message}`)
    }
  }

  document.body.appendChild(overlay)
  document.body.appendChild(dialog)
}

export function closeSessionPicker() {
  document.querySelector('.session-overlay')?.remove()
  document.querySelector('.session-panel')?.remove()
}

/** 修改会话名称弹窗
 * @param {number} sessionId - 会话数据库 ID
 * @param {string} currentTitle - 当前会话标题
 * @param {Function} onSuccess - 修改成功后的回调 (newTitle) => void
 * @param {Function} onError - 修改失败的回调 (error) => void
 */
export async function promptRenameSession(sessionId, currentTitle, onSuccess, onError) {
  // 移除可能已存在的弹窗
  document.querySelectorAll('.rename-overlay, .rename-dialog').forEach(el => el.remove())

  const overlay = document.createElement('div')
  overlay.className = 'session-overlay cmd-overlay visible'

  const dialog = document.createElement('div')
  dialog.className = 'session-dialog'
  dialog.innerHTML = `
    <h3>${t('session.rename') || '修改名称'}</h3>
    <div class="form-group" style="margin:16px 0">
      <input type="text" id="rename-session-name" value="${escapeText(currentTitle)}" placeholder="${t('session.new.name.placeholder')}"
        style="width:100%;height:40px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;padding:0 12px;color:var(--text-primary);font-size:14px;outline:none" />
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="session-dialog-btn cancel">${t('cancel')}</button>
      <button class="session-dialog-btn confirm">${t('session.rename.confirm') || '确定'}</button>
    </div>
  `

  overlay.onclick = (e) => { if (e.target === overlay) { overlay.remove(); dialog.remove() } }
  dialog.querySelector('.cancel').onclick = () => { overlay.remove(); dialog.remove() }
  dialog.querySelector('.confirm').onclick = async () => {
    const newName = dialog.querySelector('#rename-session-name').value.trim()
    if (!newName) {
      const input = dialog.querySelector('#rename-session-name')
      input.style.borderColor = 'var(--danger, #e74c3c)'
      input.placeholder = t('session.new.name.required') || '请输入会话名称'
      input.focus()
      setTimeout(() => { input.style.borderColor = '' }, 2000)
      return
    }

    const confirmBtn = dialog.querySelector('.confirm')
    confirmBtn.disabled = true
    confirmBtn.textContent = t('session.loading')

    try {
      await api.updateSessionTitle(sessionId, newName)
      overlay.remove()
      dialog.remove()
      onSuccess?.(newName)
    } catch (e) {
      confirmBtn.disabled = false
      confirmBtn.textContent = t('session.rename.confirm') || '确定'
      onError?.(e)
    }
  }

  document.body.appendChild(overlay)
  document.body.appendChild(dialog)
  dialog.querySelector('#rename-session-name').focus()
  dialog.querySelector('#rename-session-name').select()
  dialog.querySelector('#rename-session-name').onkeydown = (e) => {
    if (e.key === 'Enter') dialog.querySelector('.confirm').click()
  }
}
