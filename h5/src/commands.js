/**
 * 快捷指令面板 - 支持角色过滤和命令拦截
 */

import { t } from './i18n.js'

// ============ 角色管理 ============

let _userRole = null

/** 设置当前用户角色 */
export function setUserRole(roleName) {
  _userRole = roleName
  console.log('[commands] User role set:', roleName)
}

export function getUserRole() {
  return _userRole
}

function isAdmin() {
  return _userRole === 'admin'
}

// ============ 命令定义 ============

// 所有已知的命令前缀（用于匹配用户输入）
const KNOWN_COMMAND_PREFIXES = [
  '/model', '/new', '/reset', '/compact', '/stop',
  '/think', '/help', '/status', '/whoami', '/commands',
  '/context', '/skill', '/verbose',
]

// 需要 admin 权限的命令前缀
const ADMIN_ONLY_PREFIXES = [
  '/model', '/think', '/skill', '/verbose', '/compact',
  '/reset', '/help', '/status', '/whoami', '/commands', '/context',
]

// 前端本地处理的命令
const LOCAL_COMMANDS = ['/new', '/stop']

// 判断输入文本是否是命令
function parseCommand(text) {
  if (!text.startsWith('/')) return null
  const trimmed = text.trim()
  const spaceIdx = trimmed.indexOf(' ')
  const cmd = spaceIdx === -1 ? trimmed : trimmed.substring(0, spaceIdx)
  if (!KNOWN_COMMAND_PREFIXES.includes(cmd)) return null
  return cmd
}

// 判断命令是否需要 admin 权限
function isAdminCommand(cmd) {
  return ADMIN_ONLY_PREFIXES.some(prefix => cmd === prefix || cmd.startsWith(prefix + ' '))
}

/**
 * 执行命令拦截
 * @param {string} text - 用户输入文本
 * @param {object} handlers - 回调函数
 * @param {function} handlers.onNew - 处理 /new
 * @param {function} handlers.onStop - 处理 /stop
 * @param {function} handlers.onSend - 发送命令给 Agent（admin）
 * @param {function} handlers.onBlocked - 命令被拦截提示
 * @returns {'handled'|'blocked'|null} handled=本地处理, blocked=权限不足, null=不是命令
 */
export function executeCommand(text, handlers) {
  const cmd = parseCommand(text)
  if (!cmd) return null

  // 本地命令：所有用户可用
  if (cmd === '/new') {
    handlers.onNew?.()
    return 'handled'
  }
  if (cmd === '/stop') {
    handlers.onStop?.()
    return 'handled'
  }

  // Admin 命令
  if (isAdminCommand(cmd)) {
    if (isAdmin()) {
      handlers.onSend?.(text)
      return 'handled'
    } else {
      handlers.onBlocked?.(cmd)
      return 'blocked'
    }
  }

  // 未知处理（理论上不会到这里）
  return null
}

// ============ 命令面板 ============

function getAllCommandGroups() {
  return [
    {
      titleKey: 'cmd.model',
      adminOnly: true,
      commands: [
        { cmd: '/model', descKey: 'cmd.model.switch', fill: true },
        { cmd: '/model list', descKey: 'cmd.model.list' },
        { cmd: '/model status', descKey: 'cmd.model.status' },
      ],
    },
    {
      titleKey: 'cmd.session',
      adminOnly: false,
      commands: [
        { cmd: '/new', descKey: 'cmd.session.new' },
        { cmd: '/reset', descKey: 'cmd.session.reset', adminOnly: true },
        { cmd: '/compact', descKey: 'cmd.session.compact', adminOnly: true },
        { cmd: '/stop', descKey: 'cmd.session.stop' },
      ],
    },
    {
      titleKey: 'cmd.think',
      adminOnly: true,
      commands: [
        { cmd: '/think off', descKey: 'cmd.think.off' },
        { cmd: '/think low', descKey: 'cmd.think.low' },
        { cmd: '/think medium', descKey: 'cmd.think.medium' },
        { cmd: '/think high', descKey: 'cmd.think.high' },
      ],
    },
    {
      titleKey: 'cmd.info',
      adminOnly: true,
      commands: [
        { cmd: '/help', descKey: 'cmd.info.help' },
        { cmd: '/status', descKey: 'cmd.info.status' },
        { cmd: '/whoami', descKey: 'cmd.info.whoami' },
        { cmd: '/commands', descKey: 'cmd.info.commands' },
        { cmd: '/context', descKey: 'cmd.info.context' },
      ],
    },
    {
      titleKey: 'cmd.skill',
      adminOnly: true,
      commands: [
        { cmd: '/skill ', descKey: 'cmd.skill.run', fill: true },
      ],
    },
    {
      titleKey: 'cmd.advanced',
      adminOnly: true,
      commands: [
        { cmd: '/verbose on', descKey: 'cmd.advanced.verbose.on' },
        { cmd: '/verbose off', descKey: 'cmd.advanced.verbose.off' },
        { cmd: '/compact ', descKey: 'cmd.advanced.compact', fill: true },
      ],
    },
  ]
}

function getCommandGroups() {
  const groups = getAllCommandGroups()
  if (isAdmin()) return groups

  // 普通用户：过滤掉 adminOnly 的分组和命令
  return groups
    .filter(g => !g.adminOnly)
    .map(g => ({
      ...g,
      commands: g.commands.filter(c => !c.adminOnly),
    }))
    .filter(g => g.commands.length > 0)
}

let _overlay = null
let _panel = null
let _onSelect = null

export function initCommands(onSelect) {
  _onSelect = onSelect
}

function _buildPanel() {
  _overlay?.remove()
  _panel?.remove()

  _overlay = document.createElement('div')
  _overlay.className = 'cmd-overlay'
  _overlay.onclick = () => hideCommands()

  _panel = document.createElement('div')
  _panel.className = 'cmd-panel'

  const header = document.createElement('div')
  header.className = 'cmd-panel-header'
  header.innerHTML = `
    <h3>${t('cmd.title')}</h3>
    <button class="close-btn">×</button>
  `
  header.querySelector('.close-btn').onclick = () => hideCommands()

  const list = document.createElement('div')
  list.className = 'cmd-list'

  getCommandGroups().forEach(group => {
    const title = document.createElement('div')
    title.className = 'cmd-group-title'
    title.textContent = t(group.titleKey)
    list.appendChild(title)

    group.commands.forEach(({ cmd, descKey, fill }) => {
      const item = document.createElement('div')
      item.className = 'cmd-item'
      item.innerHTML = `
        <span class="cmd-text">${cmd}</span>
        <span class="cmd-desc">${t(descKey)}</span>
      `
      item.onclick = () => {
        hideCommands()
        if (fill) _onSelect?.(cmd + ' ', true)
        else _onSelect?.(cmd, false)
      }
      list.appendChild(item)
    })
  })

  _panel.appendChild(header)
  _panel.appendChild(list)
  document.body.appendChild(_overlay)
  document.body.appendChild(_panel)
}

export function showCommands() {
  _buildPanel()
  _overlay?.classList.add('visible')
  _panel?.classList.add('visible')
}

export function hideCommands() {
  _overlay?.classList.remove('visible')
  _panel?.classList.remove('visible')
}

export function isCommandsVisible() {
  return _panel?.classList.contains('visible') ?? false
}
