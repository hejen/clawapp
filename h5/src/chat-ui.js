import { wsClient, uuid } from './api-client.js'
import { renderMarkdown } from './markdown.js'
import { initMedia, pickImage, pickMedia, getAttachments, clearAttachments, hasAttachments, showLightbox } from './media.js'
import { initCommands, showCommands } from './commands.js'
import { t, formatRelativeTime } from './i18n.js'
import { initSettings, showSettings, getDetailedMode } from './settings.js'
import { saveMessage, saveMessages, getLocalMessages, clearSessionMessages, isStorageAvailable, saveSessionInfo } from './message-db.js'
import { requestPermission, showNotification, isSupported as isNotifySupported } from './notify.js'
import { initSessionPicker, setPickerSessionKey, showSessionPicker } from './session-picker.js'
import { authManager } from './auth.js'

const STORAGE_SESSION_KEY = 'clawapp-session-key'
const STORAGE_PENDING_KEY = 'clawapp-pending-sessions'

/**
 * Get user-specific localStorage key to prevent session data leakage between users
 * @param {string} baseKey - The base key name
 * @returns {string} User-namespaced key (e.g., "clawapp-session-key-user:14" or "clawapp-session-key" for anonymous)
 */
function getUserStorageKey(baseKey) {
  const userId = authManager.userInfo?.id
  return userId ? `${baseKey}-user:${userId}` : baseKey
}

let _messagesEl = null
let _typingEl = null
let _textarea = null
let _sendBtn = null
let _previewBar = null
let _sessionKey = ''
let _serverSessionKey = ''
let _sessionTitle = ''  // 当前会话的标题（来自数据库）
let _isStreaming = false
let _isSending = false     // chat.send 请求中
let _messageQueue = []     // 消息队列（发送中时排队）
let _currentAiBubble = null
let _currentAiText = ''
let _currentAiImages = []
let _currentAiVideos = []
let _currentAiAudios = []
let _currentAiFiles = []
let _currentRunId = null
let _lastHistoryHash = ''  // 防止重连时重复渲染
let _toolCards = new Map()
let _onSettingsCallback = null
let _streamSafetyTimer = null // 流式安全超时
let _renderTimer = null    // 节流渲染定时器
let _renderPending = false // 是否有待渲染
let _unsubEvent = null
let _seenFinalRunIds = new Set()
let _lastFinalSig = ''
let _lastFinalAt = 0
let _lastReconnectNoticeAt = 0
const RENDER_THROTTLE = 30 // 渲染节流间隔 ms
const FINAL_DUP_WINDOW_MS = 5000
const RECONNECT_NOTICE_COOLDOWN_MS = 5000

// 消息过滤相关状态
let _processingIndicator = null  // 当前处理中的指示器元素
let _lastFinalContent = null     // 最后收到的非内部消息内容（用于替换指示器）

const SVG_SEND = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg>`
const SVG_ATTACH = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>`
const SVG_CMD = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17l6-6-6-6"/><path d="M12 19h8"/></svg>`
const SVG_SETTINGS = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`
const SVG_STOP = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`
const SVG_MIC = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`
const SVG_RELOAD = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`

let _recognition = null
let _isRecording = false

function shouldAutoFocusInput() {
  const ua = navigator.userAgent || ''
  const isMobileUA = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(ua)
  const isCoarsePointer = !!window.matchMedia?.('(pointer: coarse)').matches
  return !(isMobileUA || isCoarsePointer)
}

function focusInputIfDesktop() {
  if (!_textarea || !shouldAutoFocusInput()) return
  requestAnimationFrame(() => _textarea?.focus())
}

function blurInputIfMobile() {
  if (!_textarea || shouldAutoFocusInput()) return
  _textarea.blur()
}

/**
 * 检查消息是否应该显示给用户
 * @param {object} payload - SSE 事件 payload
 * @returns {boolean} - 是否应该显示
 */
function shouldDisplayMessage(payload) {
  // 如果用户开启了详细模式，显示所有消息
  if (getDetailedMode()) return true

  // 如果消息标记为内部消息，不显示
  if (payload._internal) return false

  // 默认显示
  return true
}

/**
 * 显示"正在处理"指示器（简洁模式下用于替代内部消息）
 */
function showProcessingIndicator() {
  if (!_messagesEl) return
  if (_processingIndicator) return

  const wrapper = document.createElement('div')
  wrapper.className = 'msg msg-assistant'
  wrapper.innerHTML = `
    <div class="msg-bubble">
      <div class="msg-content">
        <div class="processing-indicator">
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="processing-text">AI 正在处理...</span>
        </div>
      </div>
      <div class="msg-time">${formatTime(new Date())}</div>
    </div>
  `

  _messagesEl.insertBefore(wrapper, _typingEl)
  _processingIndicator = wrapper
  scrollToBottom()
}

/**
 * 隐藏"正在处理"指示器
 */
function hideProcessingIndicator() {
  if (_processingIndicator) {
    _processingIndicator.remove()
    _processingIndicator = null
  }
}

/** 从 OpenClaw 消息中提取可渲染内容（文本 + 图片 + 视频 + 音频 + 文件） */
function extractContent(message) {
  if (!message || typeof message !== 'object') return null
  const content = message.content
  if (typeof content === 'string') return { text: stripThinkingTags(content), images: [], videos: [], audios: [], files: [] }
  if (Array.isArray(content)) {
    const texts = [], images = [], videos = [], audios = [], files = []
    for (const block of content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        texts.push(block.text)
      } else if (block.type === 'image' && !block.omitted) {
        // base64 内嵌图片
        if (block.data) {
          images.push({ mediaType: block.mimeType || 'image/png', data: block.data })
        } else if (block.source?.type === 'base64' && block.source.data) {
          // Anthropic 格式
          images.push({ mediaType: block.source.media_type || 'image/png', data: block.source.data })
        } else if (block.url || block.source?.url) {
          // URL 格式图片
          images.push({ url: block.url || block.source.url, mediaType: block.mimeType || 'image/png' })
        }
      } else if (block.type === 'image_url' && block.image_url?.url) {
        // OpenAI 格式
        images.push({ url: block.image_url.url, mediaType: 'image/png' })
      } else if (block.type === 'video') {
        if (block.data) videos.push({ mediaType: block.mimeType || 'video/mp4', data: block.data })
        else if (block.url) videos.push({ url: block.url, mediaType: block.mimeType || 'video/mp4' })
      } else if (block.type === 'audio' || block.type === 'voice') {
        if (block.data) audios.push({ mediaType: block.mimeType || 'audio/mpeg', data: block.data, duration: block.duration })
        else if (block.url) audios.push({ url: block.url, mediaType: block.mimeType || 'audio/mpeg', duration: block.duration })
      } else if (block.type === 'file' || block.type === 'document') {
        files.push({ url: block.url || '', name: block.fileName || block.name || '文件', mimeType: block.mimeType || '', size: block.size, data: block.data })
      }
    }
    // 从 mediaUrl/mediaUrls 提取（插件返回的媒体 URL）
    const mediaUrls = message.mediaUrls || (message.mediaUrl ? [message.mediaUrl] : [])
    for (const url of mediaUrls) {
      if (!url) continue
      if (/\.(mp4|webm|mov|mkv)(\?|$)/i.test(url)) videos.push({ url, mediaType: 'video/mp4' })
      else if (/\.(mp3|wav|ogg|m4a|aac|flac)(\?|$)/i.test(url)) audios.push({ url, mediaType: 'audio/mpeg' })
      else if (/\.(jpe?g|png|gif|webp|heic|svg)(\?|$)/i.test(url)) images.push({ url, mediaType: 'image/png' })
      else files.push({ url, name: url.split('/').pop().split('?')[0] || '文件', mimeType: '' })
    }
    const text = texts.length ? stripThinkingTags(texts.join('\n')) : ''
    if (text || images.length || videos.length || audios.length || files.length) {
      return { text, images, videos, audios, files }
    }
  }
  if (typeof message.text === 'string') return { text: stripThinkingTags(message.text), images: [], videos: [], audios: [], files: [] }
  return null
}

function stripThinkingTags(text) {
  return text
    .replace(/<\s*think(?:ing)?\s*>[\s\S]*?<\s*\/\s*think(?:ing)?\s*>/gi, '')
    // 过滤 OpenClaw 注入的元数据（Conversation info / Inbound Context）
    .replace(/Conversation info \(untrusted metadata\):\s*```json[\s\S]*?```\s*/gi, '')
    .replace(/\[Queued messages while agent was busy\]\s*---\s*Queued #\d+\s*/gi, '')
    .trim()
}

export function createChatPage() {
  const page = document.createElement('div')
  page.className = 'page chat-page hidden'
  page.id = 'chat-page'
  page.innerHTML = `
    <div class="chat-header">
      <div class="status-dot" id="status-dot"></div>
      <div class="title" id="session-title">ClawApp</div>
      <button class="settings-btn" id="reload-btn" title="${t('settings.reload')}">${SVG_RELOAD}</button>
      <button class="settings-btn" id="settings-btn">${SVG_SETTINGS}</button>
    </div>
    <div class="chat-messages" id="chat-messages">
      <div class="typing-indicator" id="typing-indicator"><span></span><span></span><span></span></div>
    </div>
    <button class="scroll-bottom-btn" id="scroll-bottom-btn">↓</button>
    <div class="preview-bar" id="preview-bar"></div>
    <div class="chat-input-area">
      <!-- Quick commands temporarily disabled -->
      <!-- <button class="icon-btn" id="cmd-btn">${SVG_CMD}</button> -->
      <!-- Attachment upload temporarily disabled -->
      <!-- <button class="icon-btn" id="attach-btn">${SVG_ATTACH}</button> -->
      <!-- Voice input temporarily disabled -->
      <!-- <button class="icon-btn" id="mic-btn" style="display:none">${SVG_MIC}</button> -->
      <div class="input-wrapper"><textarea id="chat-input" rows="1" placeholder="${t('chat.input.placeholder')}"></textarea></div>
      <button class="send-btn" id="send-btn" disabled>${SVG_SEND}</button>
    </div>
  `
  return page
}

export function setSessionKey(key) {
  console.log('[setSessionKey v2]', Date.now(), 'key:', key, 'type:', typeof key)

  // 记录服务端默认会话，但不要在重连时覆盖用户当前会话
  _serverSessionKey = key || ''

  // 如果服务器返回 null（用户没有会话），设置"无会话"状态
  if (key === null && !_sessionKey) {
    // 首次连接且无会话，设置"无会话"状态
    console.log('[setSessionKey] No session for user, setting empty state')
    _sessionKey = ''
    setPickerSessionKey('')
    localStorage.removeItem(getUserStorageKey(STORAGE_SESSION_KEY))
    updateSessionTitle()
    disableChatInput()
    return
  }

  // 仅在首次初始化（当前无会话）时设置 active session
  if (!_sessionKey) {
    const storageKey = getUserStorageKey(STORAGE_SESSION_KEY)
    const saved = localStorage.getItem(storageKey)
    _sessionKey = saved || _serverSessionKey || ''
    if (_sessionKey) localStorage.setItem(storageKey, _sessionKey)
  }

  console.log('[setSessionKey] Final _sessionKey:', _sessionKey)
  setPickerSessionKey(_sessionKey)
  updateSessionTitle()
  // 如果有会话，确保输入框可用
  if (_sessionKey) enableChatInput()
}

/** 禁用聊天输入（无会话状态） */
function disableChatInput() {
  if (_textarea) _textarea.disabled = true
  if (_sendBtn) _sendBtn.disabled = true
}

/** 启用聊天输入（有会话状态） */
function enableChatInput() {
  if (_textarea) _textarea.disabled = false
  updateSendState()  // 正确更新发送按钮状态
}
export function getSessionKey() { return _sessionKey }

function readPendingSessions() {
  try {
    const raw = localStorage.getItem(STORAGE_PENDING_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writePendingSessions(map) {
  try {
    localStorage.setItem(STORAGE_PENDING_KEY, JSON.stringify(map || {}))
  } catch {}
}

function markSessionPending(pending) {
  if (!_sessionKey) return
  const map = readPendingSessions()
  if (pending) map[_sessionKey] = Date.now()
  else delete map[_sessionKey]
  writePendingSessions(map)
}

function isSessionMarkedPending() {
  if (!_sessionKey) return false
  const map = readPendingSessions()
  return !!map[_sessionKey]
}

async function restorePendingIndicator() {
  if (!_sessionKey) return
  const localPending = isSessionMarkedPending()
  if (localPending) showTyping(true)

  try {
    const progress = await wsClient.getSessionProgress(_sessionKey, { preferSessionKey: true })
    if (progress?.busy) {
      showTyping(true)
      markSessionPending(true)
      return
    }
    if (localPending) {
      showTyping(false)
      markSessionPending(false)
    }
  } catch (e) {
    console.warn('[chat] restorePendingIndicator failed:', e)
  }
}

export function initChatUI(onSettings) {
  _messagesEl = document.getElementById('chat-messages')
  _typingEl = document.getElementById('typing-indicator')
  
  // 滚动到底部按钮
  const scrollBtn = document.getElementById('scroll-bottom-btn')
  scrollBtn.onclick = () => scrollToBottom()
  _messagesEl.onscroll = () => {
    const { scrollTop, scrollHeight, clientHeight } = _messagesEl
    scrollBtn.classList.toggle('visible', scrollHeight - scrollTop - clientHeight > 200)
  }
  _textarea = document.getElementById('chat-input')
  _sendBtn = document.getElementById('send-btn')
  _previewBar = document.getElementById('preview-bar')
  _onSettingsCallback = onSettings

  initMedia(_previewBar, updateSendState)
  initSettings(onSettings)

  // 页面就绪后静默检查通知权限（已 granted 则无感，'default' 则不主动弹窗——由用户在设置里开启）
  if (isNotifySupported && Notification.permission === 'granted') {
    // 已授权，无需任何操作
  }

  document.getElementById('reload-btn').onclick = () => location.reload()
  document.getElementById('settings-btn').onclick = () => showSettings()
  document.getElementById('session-title').onclick = () => showSessionPicker()
  initSessionPicker({
    onSwitch: switchSession,
    onSystemMsg: appendSystemMessage,
    onClear: clearCurrentSession,
  })
  // Quick commands temporarily disabled
  // document.getElementById('cmd-btn').onclick = () => showCommands()
  // Attachment upload temporarily disabled
  // document.getElementById('attach-btn').onclick = () => pickMedia()
  _sendBtn.onclick = () => handleSendClick()

  _textarea.addEventListener('input', () => { autoResize(); updateSendState() })
  _textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); handleSendClick() }
  })

  // Voice input temporarily disabled
  /*
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
  const micBtn = document.getElementById('mic-btn')
  if (SpeechRecognition && micBtn) {
    micBtn.style.display = ''
    const isSecure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    micBtn.onclick = () => isSecure ? toggleVoiceInput(SpeechRecognition) : appendSystemMessage(t('voice.need.https'))
  }
  */

  initCommands((cmd, fillOnly) => {
    if (fillOnly) { _textarea.value = cmd; focusInputIfDesktop(); updateSendState() }
    else { _textarea.value = cmd; sendMessage() }
  })

  if (_unsubEvent) _unsubEvent()
  _unsubEvent = wsClient.onEvent(handleEvent)
  wsClient.onStatusChange(status => {
    const dot = document.getElementById('status-dot')
    dot.className = 'status-dot'
    if (status === 'ready' || status === 'connected') {
      dot.classList.add('connected')
      hideDisconnectBanner()
      restorePendingIndicator().catch(() => {})
    } else if (status === 'connecting' || status === 'reconnecting') {
      dot.classList.add('connecting')
      showDisconnectBanner(true)
      notifyReconnectingSession()
    } else if (status === 'disconnected') {
      showDisconnectBanner(false)
    }
  })

  restorePendingIndicator().catch(() => {})

  // 检查无会话状态：如果 sessionKey 为空，禁用输入框
  // 这处理页面刷新时 setSessionKey 在 DOM 初始化之前调用的情况
  if (!_sessionKey) {
    disableChatInput()
  }
}

function toggleVoiceInput(SR) {
  if (_isRecording && _recognition) { _recognition.stop(); return }
  const micBtn = document.getElementById('mic-btn')
  _recognition = new SR()
  _recognition.lang = navigator.language || 'zh-CN'
  _recognition.interimResults = true
  _recognition.continuous = false
  _isRecording = true
  micBtn.classList.add('recording')

  _recognition.onresult = (e) => {
    _textarea.value = Array.from(e.results).map(r => r[0].transcript).join('')
    autoResize()
    updateSendState()
  }
  _recognition.onend = () => {
    _isRecording = false
    micBtn.classList.remove('recording')
    _recognition = null
    focusInputIfDesktop()
  }
  _recognition.onerror = (e) => {
    _isRecording = false
    micBtn.classList.remove('recording')
    _recognition = null
    console.error('[voice] error:', e.error)
    if (e.error === 'not-allowed') appendSystemMessage(t('voice.need.permission'))
    else if (e.error === 'network') appendSystemMessage(t('voice.service.unavailable'))
    else if (e.error !== 'aborted' && e.error !== 'no-speech') appendSystemMessage(`${t('voice.error')} (${e.error})`)
  }
  _recognition.start()
}

function autoResize() {
  _textarea.style.height = 'auto'
  _textarea.style.height = Math.min(_textarea.scrollHeight, 120) + 'px'
}

function updateSendState() {
  if (!_textarea) return  // Guard: initChatUI may not have been called yet
  const hasText = _textarea.value.trim().length > 0
  if (!_sendBtn) return  // Guard: initChatUI may not have been called yet
  _sendBtn.disabled = !hasText && !hasAttachments()
  // 流式响应中显示停止按钮
  if (_isStreaming) {
    _sendBtn.innerHTML = SVG_STOP
    _sendBtn.disabled = false
    _sendBtn.classList.add('stop-mode')
  } else {
    _sendBtn.innerHTML = SVG_SEND
    _sendBtn.classList.remove('stop-mode')
  }
}

function isSessionMissingError(message) {
  return /会话不存在|session\s+not\s+found/i.test(String(message || ''))
}

function notifyReconnectingSession() {
  const now = Date.now()
  if (now - _lastReconnectNoticeAt < RECONNECT_NOTICE_COOLDOWN_MS) return
  _lastReconnectNoticeAt = now
  appendSystemMessage(`${t('chat.send.error')}: ${t('chat.reconnecting')}`)
}

function fallbackToDefaultSessionWithNotice() {
  // For JWT users, DO NOT fallback to shared default session (security risk!)
  // Only use _serverSessionKey if available (server-provided user-specific session)
  if (authManager.authType === 'jwt') {
    appendSystemMessage(`${t('chat.send.error')}: ${t('chat.session.missing.manual')}`)
    return
  }

  // For token users, can use server-provided session key
  const fallback = _serverSessionKey
  if (!fallback || fallback === _sessionKey) {
    appendSystemMessage(`${t('chat.send.error')}: ${t('chat.session.missing.manual')}`)
    return
  }
  appendSystemMessage(`${t('chat.send.error')}: ${t('chat.session.missing.fallback')}`)
  switchSession(fallback)
}

function handleSendClick() {
  if (_isStreaming) {
    wsClient.chatAbort(_sessionKey, _currentRunId).catch(() => {})
    return
  }
  blurInputIfMobile()
  sendMessage()
}

async function sendMessage() {
  const text = _textarea.value.trim()
  if (!text && !hasAttachments()) return

  const attachments = getAttachments()
  _textarea.value = ''
  _textarea.style.height = 'auto'
  clearAttachments()
  updateSendState()

  // 如果正在发送或流式响应中，加入队列
  if (_isSending || _isStreaming) {
    if (text) {
      appendUserMessage(text, attachments)
      saveMessage({
        id: uuid(),
        sessionKey: _sessionKey,
        role: 'user',
        content: text,
        attachments: attachments?.length ? attachments : undefined,
        timestamp: Date.now()
      })
    }
    _messageQueue.push({ text, attachments })
    // 已在入队时 append，发送时不要重复渲染
    return
  }

  await doSend(text, attachments)
}

/** 实际发送消息 */
async function doSend(text, attachments) {
  if (text) {
    console.log('[chat] appendUserMessage:', text.substring(0, 50))
    appendUserMessage(text, attachments)
    // 保存用户消息到本地（含附件）
    saveMessage({ id: uuid(), sessionKey: _sessionKey, role: 'user', content: text, attachments: attachments?.length ? attachments : undefined, timestamp: Date.now() })
  }
  showTyping(true)
  markSessionPending(true)
  _isSending = true
  _textarea.disabled = true

  try {
    await wsClient.chatSend(_sessionKey, text, attachments.length ? attachments : undefined)
  } catch (err) {
    showTyping(false)
    markSessionPending(false)
    if (isSessionMissingError(err.message)) {
      fallbackToDefaultSessionWithNotice()
      return
    }
    if (err.message.includes('未连接') || err.message.includes('超时') || err.message.includes('重连') || err.message.includes('timeout') || err.message.includes('reconnect')) {
      appendSystemMessage(t('chat.reconnecting'))
    } else {
      appendSystemMessage(`${t('chat.send.error')}: ${err.message}`)
    }
  } finally {
    _isSending = false
    _textarea.disabled = false
    focusInputIfDesktop()
  }
}

/** 处理队列中的下一条消息（在 final/error/aborted 后调用） */
function processMessageQueue() {
  if (_messageQueue.length === 0) return
  if (_isSending || _isStreaming) return
  const next = _messageQueue.shift()
  // 用户消息已经在入队时 append 过了，这里不再 append
  showTyping(true)
  markSessionPending(true)
  _isSending = true
  _textarea.disabled = true
  wsClient.chatSend(_sessionKey, next.text, next.attachments?.length ? next.attachments : undefined)
    .catch(err => {
      showTyping(false)
      markSessionPending(false)
      if (isSessionMissingError(err.message)) {
        fallbackToDefaultSessionWithNotice()
        return
      }
      appendSystemMessage(`${t('chat.send.error')}: ${err.message}`)
    })
    .finally(() => {
      _isSending = false
      _textarea.disabled = false
      focusInputIfDesktop()
    })
}

function handleEvent(msg) {
  console.log('[chat] handleEvent:', msg.event, msg)
  const { event, payload } = msg
  if (event === 'chat') handleChatEvent(payload)
  else if (event === 'agent') handleAgentEvent(payload)
  else if (event === 'system.notify') handleSystemNotify(payload)
}

/** 处理 OpenClaw Gateway 主动推送的 system.notify 事件 */
function handleSystemNotify(payload) {
  if (!payload) return
  const title = payload.title || 'OpenClaw'
  const body = payload.body || payload.message || payload.text || ''
  const sentAt = payload._sentAt ? new Date(payload._sentAt) : new Date()
  appendSystemNotifyItem(title, body, sentAt)
  const tag = payload.tag || 'system-notify'
  const opts = { body, tag, renotify: true }
  if (payload.icon) opts.icon = payload.icon
  if (payload.data) opts.data = payload.data
  showNotification(title, opts)
}

/** 实时 SSE 插入一条居中系统通知行 */
function appendSystemNotifyItem(title, body, sentAt) {
  if (!_messagesEl) return
  const sentAtMs = sentAt instanceof Date ? sentAt.getTime() : (Number(sentAt) || Date.now())
  if (_messagesEl.querySelector(`.system-notify-item[data-sent-at="${sentAtMs}"]`)) return
  const wrapper = document.createElement('div')
  wrapper.className = 'msg system-notify-item'
  wrapper.dataset.sentAt = sentAtMs
  const timeStr = formatTime(new Date(sentAtMs))
  const titleHtml = title ? `<span class="sni-title">${escapeText(title)}</span>` : ''
  const bodyHtml = body ? `<span class="sni-body">${escapeText(body)}</span>` : ''
  wrapper.innerHTML = `<div class="sni-pill">🔔 ${titleHtml}${titleHtml && bodyHtml ? '：' : ''}${bodyHtml}<span class="sni-time">${timeStr}</span></div>`
  _messagesEl.insertBefore(wrapper, _typingEl)
  scrollToBottom()
}

function handleChatEvent(payload) {
  if (!payload) return
  console.log('[chat] handleChatEvent state:', payload.state, 'sessionKey:', payload.sessionKey, '_sessionKey:', _sessionKey)
  // sessionKey 过滤 - 但如果 sessionKey 为空也处理（兼容没有返回 sessionKey 的情况）
  if (payload.sessionKey && payload.sessionKey !== _sessionKey && _sessionKey) return

  const { state } = payload
  const isInternal = payload._internal
  const detailedMode = getDetailedMode()

  // 简洁模式下的消息过滤逻辑
  if (!detailedMode && isInternal) {
    // 内部消息不直接显示
    if (state === 'delta') {
      // 显示临时的"正在处理"指示器（如果还没有）
      if (!_processingIndicator) {
        showProcessingIndicator()
      }
    }
    // 跳过内部消息的处理
    return
  }

  // 对于非内部消息，或详细模式下的所有消息，正常处理
  // 如果有处理指示器，在显示真实内容前先移除
  if (!isInternal && state === 'final' && _processingIndicator) {
    hideProcessingIndicator()
  }

  if (state === 'delta') {
    const c = extractContent(payload.message)
    if (c?.text && c.text.length > _currentAiText.length) {
      showTyping(false)
      if (!_currentAiBubble) { _currentAiBubble = createAiBubble(); _currentRunId = payload.runId }
      _currentAiText = c.text
      if (c.images.length) _currentAiImages = c.images
      if (c.videos.length) _currentAiVideos = c.videos
      if (c.audios.length) _currentAiAudios = c.audios
      if (c.files.length) _currentAiFiles = c.files
      throttledRender()
    }
    return
  }

  if (state === 'final') {
    const c = extractContent(payload.message)
    const finalText = c?.text
    const finalImages = c?.images || []
    const finalVideos = c?.videos || []
    const finalAudios = c?.audios || []
    const finalFiles = c?.files || []
    const runId = payload.runId
    const sig = `${finalText || ''}__img:${finalImages.length}__vid:${finalVideos.length}__aud:${finalAudios.length}__file:${finalFiles.length}`
    const now = Date.now()

    // 去重1：同 runId 的重复 final（重连补发/重复投递）
    if (runId && _seenFinalRunIds.has(runId)) {
      console.log('[chat] 忽略重复 final(runId):', runId)
      return
    }
    // 去重2：短时间内同内容重复 final（runId 缺失或变化）
    if (sig && _lastFinalSig === sig && now - _lastFinalAt < FINAL_DUP_WINDOW_MS) {
      console.log('[chat] 忽略重复 final(signature):', sig.slice(0, 80))
      if (runId) _seenFinalRunIds.add(runId)
      return
    }

    const hasMedia = finalImages.length || finalVideos.length || finalAudios.length || finalFiles.length
    // 忽略空 final（Gateway 会为一条消息触发多个 run，部分是空 final）
    if (!_currentAiBubble && !finalText && !hasMedia) return
    showTyping(false)
    // 如果流式阶段没有创建 bubble，从 final message 中提取
    if (!_currentAiBubble && (finalText || hasMedia)) {
      _currentAiBubble = createAiBubble()
      _currentAiText = finalText || ''
      _currentAiImages = finalImages
      _currentAiVideos = finalVideos
      _currentAiAudios = finalAudios
      _currentAiFiles = finalFiles
    }
    // 移除光标元素
    const wrapper = _currentAiBubble?.parentElement
    if (wrapper) {
      const cursor = wrapper.querySelector('.typing-cursor')
      if (cursor) cursor.remove()
      const time = wrapper.querySelector('.msg-time')
      if (time) time.textContent = formatTime(new Date())
    }
    if (_currentAiBubble && (_currentAiText || _currentAiImages.length || _currentAiVideos.length || _currentAiAudios.length || _currentAiFiles.length)) {
      _currentAiBubble.innerHTML = renderMarkdown(_currentAiText)
      appendImagesToEl(_currentAiBubble, _currentAiImages)
      appendVideosToEl(_currentAiBubble, _currentAiVideos)
      appendAudiosToEl(_currentAiBubble, _currentAiAudios)
      appendFilesToEl(_currentAiBubble, _currentAiFiles)
      bindImageClicks(_currentAiBubble)
      bindVideoClicks(_currentAiBubble)
      initVoiceBubbles(_currentAiBubble)
    }
    // 保存 AI 回复到本地
    if (_currentAiText) {
      saveMessage({ id: payload.runId || uuid(), sessionKey: _sessionKey, role: 'assistant', content: _currentAiText, timestamp: Date.now() })
    }

    if (runId) {
      _seenFinalRunIds.add(runId)
      if (_seenFinalRunIds.size > 200) {
        _seenFinalRunIds = new Set(Array.from(_seenFinalRunIds).slice(-100))
      }
    }
    _lastFinalSig = sig
    _lastFinalAt = now

    // 页面在后台时（如手机熄屏、切换到其他 App）弹出浏览器通知
    if (document.hidden && isNotifySupported && Notification.permission === 'granted' && (finalText || hasMedia)) {
      const preview = finalText ? (finalText.length > 80 ? finalText.slice(0, 80) + '…' : finalText) : t('notify.media')
      showNotification(t('notify.ai.reply'), { body: preview, tag: 'ai-reply', renotify: false })
    }

    resetStreamState()
    processMessageQueue()
    return
  }

  if (state === 'aborted') {
    showTyping(false)
    if (_currentAiText.trim()) {
      if (_currentAiBubble) {
        _currentAiBubble.innerHTML = renderMarkdown(_currentAiText)
        bindImageClicks(_currentAiBubble)
        bindVideoClicks(_currentAiBubble)
        initVoiceBubbles(_currentAiBubble)
      }
      // 移除光标，更新时间
      const wrapper = _currentAiBubble?.parentElement
      if (wrapper) {
        const cursor = wrapper.querySelector('.typing-cursor')
        if (cursor) cursor.remove()
        const time = wrapper.querySelector('.msg-time')
        if (time) time.textContent = formatTime(new Date())
      }
    }
    appendSystemMessage(t('chat.aborted'))
    resetStreamState()
    processMessageQueue()
    return
  }

  if (state === 'error') {
    const errMsg = payload.errorMessage || t('chat.error.unknown')
    // 流式进行中（lifecycle start 已触发），Gateway 可能自动重试
    if (_isStreaming) {
      console.warn('[chat] 流式中临时错误，等待 Gateway 重试:', errMsg)
      appendTransientWarning(`⚠ ${errMsg}`)
      return
    }
    // 非流式状态，终态错误
    showTyping(false)
    markSessionPending(false)
    appendSystemMessage(`${t('chat.error.prefix')}: ${errMsg}`)
    resetStreamState()
    processMessageQueue()
    return
  }
}

function handleAgentEvent(payload) {
  if (!payload) return
  // 过滤非当前会话的事件
  if (payload.sessionKey && payload.sessionKey !== _sessionKey) return
  const { runId, stream, data } = payload

  if (stream === 'lifecycle') {
    if (data?.phase === 'start') {
      _currentRunId = runId; showTyping(true); _isStreaming = true; updateSendState()
      clearTransientWarnings()
      // 安全超时：如果 60s 内没有 chat final / lifecycle end，强制重置
      clearTimeout(_streamSafetyTimer)
      _streamSafetyTimer = setTimeout(() => {
        if (_isStreaming) { console.warn('[chat] 流式安全超时，强制重置'); resetStreamState() }
      }, 60000)
    }
    if (data?.phase === 'end') {
      showTyping(false)
      clearTimeout(_streamSafetyTimer)
      // 注意：lifecycle end 可能早于 chat.final 到达。
      // 这里不能 resetStreamState，否则 final 会再创建一次气泡，造成“流式后快速重复一遍”。
      _isStreaming = false
      updateSendState()
      // 队列在 chat.final/error/aborted 终态里再推进，避免提前发送导致状态交错。
    }
    return
  }

  // agent assistant 事件 — 用累积 text 驱动流式渲染（比 chat delta 频率高）
  if (stream === 'assistant') {
    const text = data?.text
    if (text && typeof text === 'string') {
      const cleaned = stripThinkingTags(text)
      if (cleaned && cleaned.length > _currentAiText.length) {
        showTyping(false)
        clearTransientWarnings()
        if (!_currentAiBubble) { _currentAiBubble = createAiBubble(); _currentRunId = runId }
        _currentAiText = cleaned
        throttledRender()
      }
    }
    return
  }

  // tool 事件用 toolCallId + phase 跟踪
  if (stream === 'tool') {
    const toolCallId = data?.toolCallId
    if (!toolCallId) return
    const name = data.name || 'tool'
    const phase = data.phase || ''

    let card = _toolCards.get(toolCallId)
    if (!card) {
      card = createToolCard(name, phase === 'start' ? 'running' : 'done')
      _toolCards.set(toolCallId, card)
    }
    if (phase === 'result' || phase === 'error') {
      updateToolCard(card, phase === 'error' ? 'error' : 'done')
    } else if (phase === 'update') {
      updateToolCard(card, 'running')
    }
    scrollToBottom()
    return
  }
}

function resetStreamState() {
  clearTimeout(_streamSafetyTimer)
  // 最后一次渲染确保完整
  if (_currentAiBubble && (_currentAiText || _currentAiImages.length || _currentAiVideos.length || _currentAiAudios.length || _currentAiFiles.length)) {
    _currentAiBubble.innerHTML = renderMarkdown(_currentAiText)
    appendImagesToEl(_currentAiBubble, _currentAiImages)
    appendVideosToEl(_currentAiBubble, _currentAiVideos)
    appendAudiosToEl(_currentAiBubble, _currentAiAudios)
    appendFilesToEl(_currentAiBubble, _currentAiFiles)
    bindImageClicks(_currentAiBubble)
    bindVideoClicks(_currentAiBubble)
    initVoiceBubbles(_currentAiBubble)
    scrollToBottom()
  }
  _renderPending = false
  _lastRenderTime = 0
  _currentAiBubble = null
  _currentAiText = ''
  _currentAiImages = []
  _currentAiVideos = []
  _currentAiAudios = []
  _currentAiFiles = []
  _currentRunId = null
  _isStreaming = false
  _toolCards.clear()
  markSessionPending(false)
  updateSendState()
}

/** 节流渲染：避免高频 delta 导致疯狂重绘 */
let _lastRenderTime = 0

function throttledRender() {
  if (_renderPending) return
  const now = performance.now()
  const elapsed = now - _lastRenderTime

  if (elapsed >= RENDER_THROTTLE) {
    // 距离上次渲染已超过阈值，立即渲染
    doRender()
  } else {
    // 在下一个 rAF 渲染
    _renderPending = true
    requestAnimationFrame(() => {
      _renderPending = false
      doRender()
    })
  }
}

function doRender() {
  _lastRenderTime = performance.now()
  if (_currentAiBubble && _currentAiText) {
    _currentAiBubble.innerHTML = renderMarkdown(_currentAiText)
    scrollToBottom()
  }
}

function createAiBubble(msgTime) {
  const wrapper = document.createElement('div')
  wrapper.className = 'msg ai'
  const bubble = document.createElement('div')
  bubble.className = 'msg-bubble'
  
  // 添加光标
  const cursor = document.createElement('span')
  cursor.className = 'typing-cursor'
  cursor.innerHTML = ' ▋'
  
  // 添加时间戳
  const time = document.createElement('div')
  time.className = 'msg-time'
  time.textContent = formatTime(msgTime || new Date())
  
  wrapper.appendChild(bubble)
  wrapper.appendChild(cursor)
  wrapper.appendChild(time)
  
  _messagesEl.insertBefore(wrapper, _typingEl)
  scrollToBottom()
  return bubble
}

function createToolCard(name, status) {
  const wrapper = document.createElement('div')
  wrapper.className = 'msg ai'
  const card = document.createElement('div')
  card.className = 'tool-card'
  card.innerHTML = `<div class="tool-name">🔧 ${escapeText(name)}</div><div class="tool-status ${status === 'running' ? 'running' : 'done'}">${statusText(status)}</div>`
  wrapper.appendChild(card)
  _messagesEl.insertBefore(wrapper, _typingEl)
  return card
}

function updateToolCard(card, status) {
  const statusEl = card.querySelector('.tool-status')
  if (statusEl) {
    statusEl.className = `tool-status ${status === 'running' ? 'running' : status === 'error' ? 'error' : 'done'}`
    statusEl.textContent = statusText(status)
  }
}

function statusText(s) {
  const map = { running: t('tool.running'), done: t('tool.done'), error: t('tool.error') }
  return map[s] || s
}

function appendUserMessage(text, attachments, msgTime) {
  const wrapper = document.createElement('div')
  wrapper.className = 'msg user'
  const bubble = document.createElement('div')
  bubble.className = 'msg-bubble'
  let html = escapeText(text).replace(/\n/g, '<br>')
  if (attachments?.length) {
    attachments.forEach(att => {
      const src = att.data || (att.content ? `data:${att.mimeType};base64,${att.content}` : '')
      const cat = att.category || att.type || 'image'
      if (cat === 'image' && src) {
        html += `<br><img src="${src}" alt="attachment" class="msg-img" />`
      } else if (cat === 'video' && src) {
        html += `<br><video controls preload="metadata" class="msg-video" src="${src}"></video>`
      } else if (cat === 'audio' && src) {
        html += `<br><audio controls preload="metadata" class="msg-audio" src="${src}"></audio>`
      } else if (att.fileName || att.name) {
        html += `<br><div class="msg-file-card"><span class="msg-file-icon">📎</span><span class="msg-file-name">${escapeText(att.fileName || att.name)}</span></div>`
      }
    })
  }
  bubble.innerHTML = html
  bindImageClicks(bubble)
  bindVideoClicks(bubble)
  initVoiceBubbles(bubble)

  // 添加时间戳
  const time = document.createElement('div')
  time.className = 'msg-time'
  time.textContent = formatTime(msgTime || new Date())
  
  wrapper.appendChild(bubble)
  wrapper.appendChild(time)
  const ts = (msgTime || new Date()).getTime()
  wrapper.dataset.msgTime = ts
  _messagesEl.insertBefore(wrapper, _typingEl)
  scrollToBottom()
}

function appendAiMessage(text, msgTime, images, videos, audios, files) {
  const wrapper = document.createElement('div')
  wrapper.className = 'msg ai'
  const bubble = document.createElement('div')
  bubble.className = 'msg-bubble'
  bubble.innerHTML = renderMarkdown(text)
  appendImagesToEl(bubble, images)
  appendVideosToEl(bubble, videos)
  appendAudiosToEl(bubble, audios)
  appendFilesToEl(bubble, files)
  bindImageClicks(bubble)
  bindVideoClicks(bubble)
  initVoiceBubbles(bubble)

  // 添加时间戳
  const time = document.createElement('div')
  time.className = 'msg-time'
  time.textContent = formatTime(msgTime || new Date())
  
  wrapper.appendChild(bubble)
  wrapper.appendChild(time)
  wrapper.dataset.msgTime = (msgTime || new Date()).getTime()
  _messagesEl.insertBefore(wrapper, _typingEl)
  scrollToBottom()
}

function appendSystemMessage(text) {
  const el = document.createElement('div')
  el.className = 'system-msg'
  el.textContent = text
  _messagesEl.insertBefore(el, _typingEl)
  scrollToBottom()
}

/** 显示可自动消失的临时警告（流式恢复后淡出） */
function appendTransientWarning(text) {
  const el = document.createElement('div')
  el.className = 'system-msg transient-warning'
  el.textContent = text
  _messagesEl.insertBefore(el, _typingEl)
  scrollToBottom()
  return el
}

/** 清除所有临时警告（流式恢复时调用） */
function clearTransientWarnings() {
  const warnings = _messagesEl.querySelectorAll('.transient-warning')
  warnings.forEach(el => {
    el.style.transition = 'opacity 0.5s'
    el.style.opacity = '0'
    setTimeout(() => el.remove(), 500)
  })
}

function showTyping(show) {
  _typingEl.classList.toggle('visible', show)
  if (show) scrollToBottom()
}

function scrollToBottom() {
  requestAnimationFrame(() => { _messagesEl.scrollTop = _messagesEl.scrollHeight })
}

function appendImagesToEl(el, images) {
  if (!images?.length) return
  images.forEach(img => {
    const imgEl = document.createElement('img')
    if (img.data) {
      imgEl.src = `data:${img.mediaType};base64,${img.data}`
    } else if (img.url) {
      imgEl.src = img.url
    }
    imgEl.className = 'msg-img'
    el.appendChild(imgEl)
  })
}

/** 渲染视频到消息气泡 */
function appendVideosToEl(el, videos) {
  if (!videos?.length) return
  videos.forEach(vid => {
    const container = document.createElement('div')
    container.className = 'msg-video-wrap'
    const videoEl = document.createElement('video')
    videoEl.className = 'msg-video'
    videoEl.controls = true
    videoEl.preload = 'metadata'
    videoEl.playsInline = true
    if (vid.data) {
      videoEl.src = `data:${vid.mediaType};base64,${vid.data}`
    } else if (vid.url) {
      videoEl.src = vid.url.startsWith('/') ? vid.url : vid.url
    }
    container.appendChild(videoEl)
    el.appendChild(container)
  })
}

/** 渲染音频到消息气泡 */
function appendAudiosToEl(el, audios) {
  if (!audios?.length) return
  audios.forEach(aud => {
    let src = ''
    if (aud.data) src = `data:${aud.mediaType};base64,${aud.data}`
    else if (aud.url) src = aud.url

    // 如果是通过 /media 端点提供的音频，使用语音气泡样式
    if (aud.url && /\/media\?/.test(aud.url)) {
      const bubble = document.createElement('div')
      bubble.className = 'voice-bubble'
      bubble.dataset.src = src
      bubble.innerHTML = `<span class="voice-icon">&#9654;</span><span class="voice-bar"></span><span class="voice-dur">${aud.duration ? Math.round(aud.duration) + '″' : '0″'}</span>`
      el.appendChild(bubble)
    } else {
      // 标准音频播放器
      const audioEl = document.createElement('audio')
      audioEl.className = 'msg-audio'
      audioEl.controls = true
      audioEl.preload = 'metadata'
      audioEl.src = src
      el.appendChild(audioEl)
    }
  })
}

/** 渲染文件卡片到消息气泡 */
function appendFilesToEl(el, files) {
  if (!files?.length) return
  files.forEach(f => {
    const card = document.createElement('div')
    card.className = 'msg-file-card'
    const ext = (f.name || '').split('.').pop().toLowerCase()
    const iconMap = { pdf: '📄', doc: '📝', docx: '📝', txt: '📃', md: '📃', json: '📋', csv: '📊', zip: '📦', rar: '📦' }
    const icon = iconMap[ext] || '📎'
    const size = f.size ? formatFileSize(f.size) : ''
    card.innerHTML = `<span class="msg-file-icon">${icon}</span><div class="msg-file-info"><span class="msg-file-name">${escapeText(f.name || '文件')}</span>${size ? `<span class="msg-file-size">${size}</span>` : ''}</div>`
    if (f.url) {
      card.style.cursor = 'pointer'
      card.onclick = () => window.open(f.url, '_blank')
    } else if (f.data) {
      card.style.cursor = 'pointer'
      card.onclick = () => {
        const a = document.createElement('a')
        a.href = `data:${f.mimeType || 'application/octet-stream'};base64,${f.data}`
        a.download = f.name || '文件'
        a.click()
      }
    }
    el.appendChild(card)
  })
}

function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function bindImageClicks(container) {
  container.querySelectorAll('img.msg-img').forEach(img => { img.onclick = () => showLightbox(img.src) })
}

function bindVideoClicks(container) {
  container.querySelectorAll('video.msg-video').forEach(vid => {
    // 双击全屏/灯箱
    vid.ondblclick = (e) => {
      e.preventDefault()
      showLightbox(vid.src, 'video')
    }
  })
}

/** 语音气泡：加载时长、设置宽度、绑定播放 */
let _playingAudio = null
function initVoiceBubbles(container) {
  const MIN_W = 80, MAX_W = 220, MIN_S = 1, MAX_S = 60
  container.querySelectorAll('.voice-bubble:not([data-init])').forEach(el => {
    el.setAttribute('data-init', '1')
    const src = el.dataset.src
    const audio = new Audio()
    audio.preload = 'metadata'
    audio.src = src
    audio.onloadedmetadata = () => {
      const dur = Math.round(audio.duration)
      el.querySelector('.voice-dur').textContent = dur + '″'
      const clamped = Math.max(MIN_S, Math.min(dur, MAX_S))
      const ratio = (clamped - MIN_S) / (MAX_S - MIN_S)
      el.style.width = (MIN_W + ratio * (MAX_W - MIN_W)) + 'px'
    }
    el.onclick = () => {
      if (_playingAudio && _playingAudio !== audio) { _playingAudio.pause(); _playingAudio.currentTime = 0; document.querySelectorAll('.voice-bubble.playing').forEach(b => b.classList.remove('playing')) }
      if (audio.paused) { audio.play(); el.classList.add('playing'); _playingAudio = audio }
      else { audio.pause(); audio.currentTime = 0; el.classList.remove('playing'); _playingAudio = null }
    }
    audio.onended = () => { el.classList.remove('playing'); _playingAudio = null }
  })
}

function escapeText(str) {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

/** 打字机光标 */
function createCursor() {
  const cursor = document.createElement('span')
  cursor.className = 'typing-cursor'
  cursor.innerHTML = ' ▋'
  return cursor
}

function formatTime(date) {
  const h = date.getHours().toString().padStart(2, '0')
  const m = date.getMinutes().toString().padStart(2, '0')
  return `${h}:${m}`
}

export async function loadHistory() {
  if (!_sessionKey) return
  const hasExisting = _messagesEl?.querySelector('.msg')

  // 首次加载：显示本地缓存（快速展示，不等待服务端）
  if (!hasExisting && isStorageAvailable()) {
    const local = await getLocalMessages(_sessionKey, 200)
    if (local.length) {
      clearMessages()
      local.forEach(msg => {
        const msgTime = msg.timestamp ? new Date(msg.timestamp) : new Date()
        // Only render known roles to avoid displaying system/protocol messages
        if (msg.role === 'user') appendUserMessage(msg.content || '', msg.attachments || null, msgTime)
        else if (msg.role === 'assistant') appendAiMessage(msg.content || '', msgTime)
        // Skip all other roles (system, no_reply, tool, etc.)
      })
      scrollToBottom()
    }
  }

  // 从服务端并行拉取：聊天历史 + 通知历史
  if (!wsClient.gatewayReady) return
  try {
    const [chatResult, notifyItems] = await Promise.all([
      wsClient.chatHistory(_sessionKey, 200),
      wsClient.notifyHistory(),
    ])

    if (!chatResult?.messages?.length) {
      if (!_messagesEl.querySelector('.msg')) { clearMessages(); appendSystemMessage(t('chat.no.messages')) }
      if (notifyItems.length) insertNotifyItemsInOrder(notifyItems)
      return
    }
    // 去重
    const deduped = dedupeHistory(chatResult.messages)
    // 算 hash，没变就跳过渲染
    const hash = deduped.map(m => `${m.role}:${m.text?.length || 0}`).join('|')
    if (hash === _lastHistoryHash && hasExisting && !notifyItems.length) return
    _lastHistoryHash = hash

    // 有待发送/发送中的本地消息时，不要全量重绘，避免覆盖本地乐观渲染
    if (hasExisting && (_isSending || _isStreaming || _messageQueue.length > 0)) {
      // Only save user and assistant messages
      saveMessages(chatResult.messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => {
          const c = extractContent(m)
          return { id: m.id || uuid(), sessionKey: _sessionKey, role: m.role, content: c?.text || '', timestamp: m.timestamp || Date.now() }
        }))
      return
    }

    clearMessages()
    deduped.forEach(msg => {
      const msgTime = msg.timestamp ? new Date(msg.timestamp) : new Date()
      // Only render known roles
      if (msg.role === 'user') {
        appendUserMessage(msg.text, msg.images?.length ? msg.images.map(i => ({ content: i.data, mimeType: i.mediaType, category: 'image' })) : null, msgTime)
      } else if (msg.role === 'assistant') {
        appendAiMessage(msg.text, msgTime, msg.images, msg.videos, msg.audios, msg.files)
      }
      // Skip all other roles (system messages, protocol messages, etc.)
    })
    // 将通知条按时间插到对应位置
    insertNotifyItemsInOrder(notifyItems)
    // Only save user and assistant messages to localStorage (filter out system/protocol messages)
    saveMessages(chatResult.messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => {
        const c = extractContent(m)
        return { id: m.id || uuid(), sessionKey: _sessionKey, role: m.role, content: c?.text || '', timestamp: m.timestamp || Date.now() }
      }))
    scrollToBottom()
  } catch (e) {
    console.error('[chat] loadHistory error:', e)
    if (isSessionMissingError(e.message)) {
      fallbackToDefaultSessionWithNotice()
      return
    }
    if (!_messagesEl.querySelector('.msg')) appendSystemMessage(`${t('chat.load.error')}: ${e.message}`)
  }
}

/** 去重：合并 Gateway 重试产生的重复消息 */
function dedupeHistory(messages) {
  const detailedMode = getDetailedMode()
  const deduped = []
  for (const msg of messages) {
    // 过滤内部消息（简洁模式下）
    if (!detailedMode) {
      // 跳过工具调用结果
      if (msg.role === 'toolResult') continue
      // 跳过工具调用消息
      if (msg.role === 'tool') continue
      // 跳过带有 thinking 标记的消息
      if (msg.metadata?.thinking) continue
    } else {
      // 详细模式下也跳过 toolResult（这些通常不需要显示）
      if (msg.role === 'toolResult') continue
    }

    const c = extractContent(msg)
    if (!c?.text && !c?.images?.length && !c?.videos?.length && !c?.audios?.length && !c?.files?.length) continue
    const last = deduped[deduped.length - 1]
    if (last && last.role === msg.role) {
      if (msg.role === 'user' && last.text === (c.text || '')) continue
      if (msg.role === 'assistant') {
        last.text = [last.text, c.text].filter(Boolean).join('\n')
        last.images = [...(last.images || []), ...(c.images || [])]
        last.videos = [...(last.videos || []), ...(c.videos || [])]
        last.audios = [...(last.audios || []), ...(c.audios || [])]
        last.files = [...(last.files || []), ...(c.files || [])]
        continue
      }
    }
    deduped.push({ role: msg.role, text: c.text || '', images: c.images, videos: c.videos, audios: c.audios, files: c.files, timestamp: msg.timestamp })
  }
  return deduped
}

/** 清空消息区域（保留 typing indicator） */
function clearMessages() {
  if (!_messagesEl) return
  const children = Array.from(_messagesEl.children)
  children.forEach(child => { if (child !== _typingEl) _messagesEl.removeChild(child) })
}

/**
 * 按时间顺序注入通知条到当前消息列表中
 * @param {Array<{title,body,_sentAt}>} items 服务端返回的通知列表
 */
function insertNotifyItemsInOrder(items) {
  if (!_messagesEl || !items?.length) return
  const sorted = [...items].sort((a, b) => (a._sentAt || 0) - (b._sentAt || 0))

  // 收集所有带 data-msg-time 的消息元素（用于找插入位置）
  const msgEls = Array.from(_messagesEl.children).filter(
    el => el !== _typingEl && !el.classList.contains('system-notify-item') && el.dataset.msgTime
  )

  for (const n of sorted) {
    const sentAtMs = n._sentAt || 0
    const title = n.title || 'OpenClaw'
    const body = n.body || n.message || n.text || ''

    // DOM 内去重
    if (sentAtMs && _messagesEl.querySelector(`.system-notify-item[data-sent-at="${sentAtMs}"]`)) continue

    const wrapper = document.createElement('div')
    wrapper.className = 'msg system-notify-item'
    if (sentAtMs) wrapper.dataset.sentAt = sentAtMs
    const timeStr = sentAtMs ? formatTime(new Date(sentAtMs)) : ''
    const titleHtml = title ? `<span class="sni-title">${escapeText(title)}</span>` : ''
    const bodyHtml = body ? `<span class="sni-body">${escapeText(body)}</span>` : ''
    wrapper.innerHTML = `<div class="sni-pill">🔔 ${titleHtml}${titleHtml && bodyHtml ? '：' : ''}${bodyHtml}<span class="sni-time">${timeStr}</span></div>`

    // 找第一个时间戳比它更晚的消息元素，插到它前面
    const after = sentAtMs ? msgEls.find(el => Number(el.dataset.msgTime) > sentAtMs) : null
    _messagesEl.insertBefore(wrapper, after || _typingEl)
  }
}

export function abortChat() {
  wsClient.chatAbort(_sessionKey, _currentRunId).catch(() => {})
}

/** 更新标题栏显示当前会话名 */
function updateSessionTitle() {
  const titleEl = document.getElementById('session-title')
  if (!titleEl) return

  // 无会话状态
  if (!_sessionKey) {
    titleEl.textContent = t('session.none') || '无会话'
    titleEl.title = ''
    return
  }

  // 从 sessionKey 提取智能体和会话名称
  // 格式: agent:main:test1 或 agent:counselor-bot:test2
  const parts = _sessionKey.split(':')
  let agent = 'main'
  let sessionName = ''

  if (parts.length >= 3) {
    agent = parts[1]
    sessionName = parts.slice(2).join(':')
  }

  // 使用数据库标题（如果有），否则使用从 sessionKey 提取的名称
  // 统一格式：[agent] 会话名称
  let displayName = _sessionTitle || sessionName

  // 如果显示名称不包含智能体前缀，添加前缀
  if (!displayName.match(/^\[.+\]\s/)) {
    displayName = `[${agent}] ${displayName}`
  }

  titleEl.textContent = displayName
  titleEl.title = _sessionKey
}

/** 断连横幅 */
function showDisconnectBanner(isReconnecting) {
  hideDisconnectBanner()
  const banner = document.createElement('div')
  banner.className = 'disconnect-banner'
  banner.id = 'disconnect-banner'
  if (isReconnecting) {
    banner.innerHTML = `<span class="disconnect-text">${t('chat.reconnecting')}</span>`
  } else {
    banner.innerHTML = `
      <span class="disconnect-text">${t('chat.disconnected')}</span>
      <button class="disconnect-retry-btn" id="retry-connect-btn">${t('chat.retry')}</button>
    `
  }
  // 插入到 header 后面
  const header = document.querySelector('.chat-header')
  if (header) header.after(banner)

  const retryBtn = document.getElementById('retry-connect-btn')
  if (retryBtn) {
    retryBtn.onclick = () => {
      showDisconnectBanner(true)
      wsClient.reconnect()
    }
  }
}

function hideDisconnectBanner() {
  document.getElementById('disconnect-banner')?.remove()
}

/** 切换到指定会话 */
function switchSession(newKey, title = null) {
  _sessionKey = newKey
  _sessionTitle = title || ''  // 保存会话标题
  setPickerSessionKey(newKey)
  localStorage.setItem(getUserStorageKey(STORAGE_SESSION_KEY), newKey)
  _lastHistoryHash = ''
  _seenFinalRunIds.clear()
  _lastFinalSig = ''
  _lastFinalAt = 0
  resetStreamState()
  updateSessionTitle()
  enableChatInput()  // 确保切换会话后输入框可用

  // 立即清空当前消息，避免在加载新会话数据时显示旧会话的内容
  clearMessages()

  showLoadingOverlay()
  loadHistory().finally(() => {
    hideLoadingOverlay()
    restorePendingIndicator().catch(() => {})
  })
}

/** 清空当前会话（删除当前会话时调用） */
export function clearCurrentSession() {
  // 清空会话键
  _sessionKey = ''
  setPickerSessionKey('')
  localStorage.removeItem(getUserStorageKey(STORAGE_SESSION_KEY))

  // 清空消息列表
  clearMessages()

  // 重置状态
  _lastHistoryHash = ''
  _seenFinalRunIds.clear()
  _lastFinalSig = ''
  _lastFinalAt = 0
  resetStreamState()

  // 更新会话标题为默认状态
  const titleEl = document.getElementById('session-title')
  if (titleEl) {
    titleEl.textContent = t('session.none') || '无会话'
    titleEl.title = ''
  }

  // 禁用输入框和发送按钮
  if (_textarea) _textarea.disabled = true
  if (_sendBtn) _sendBtn.disabled = true

  // 显示提示消息
  appendSystemMessage(t('session.deleted.hint') || '当前会话已删除，请选择或创建新会话')
}

/** 加载遮罩 */
function showLoadingOverlay() {
  hideLoadingOverlay()
  const el = document.createElement('div')
  el.className = 'chat-loading-overlay'
  el.innerHTML = '<div class="chat-loading-spinner"></div>'
  _messagesEl?.parentElement?.appendChild(el)
}

function hideLoadingOverlay() {
  document.querySelector('.chat-loading-overlay')?.remove()
}
