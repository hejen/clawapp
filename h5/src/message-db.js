/**
 * 本地消息存储 - 使用 IndexedDB 实现离线消息持久化
 *
 * 功能：
 * - 连接时自动加载本地缓存
 * - 发送/接收消息自动存入本地
 * - 断网时使用本地缓存
 * - 网络恢复后与服务器同步
 */

import { authManager } from './auth.js'
import { api } from './api.js'

const DB_NAME = 'clawapp-messages'
const DB_VERSION = 1
const STORE_NAME = 'messages'
const STORE_SESSIONS = 'sessions'

let _db = null

/** 打开数据库 */
function openDB() {
  return new Promise((resolve, reject) => {
    if (_db) return resolve(_db)
    
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    
    request.onerror = () => reject(request.error)
    
    request.onsuccess = () => {
      _db = request.result
      resolve(_db)
    }
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result
      
      // 消息存储
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const msgStore = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        msgStore.createIndex('sessionKey', 'sessionKey', { unique: false })
        msgStore.createIndex('timestamp', 'timestamp', { unique: false })
        msgStore.createIndex('sessionKey_timestamp', ['sessionKey', 'timestamp'], { unique: false })
      }
      
      // 会话索引存储
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        db.createObjectStore(STORE_SESSIONS, { keyPath: 'sessionKey' })
      }
    }
  })
}

/** 保存消息到本地 */
export async function saveMessage(message) {
  if (!message || !message.id) return
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    
    // 确保有必需字段
    const msg = {
      id: message.id,
      sessionKey: message.sessionKey || '',
      role: message.role || 'assistant',
      content: message.content || message.text || '',
      attachments: message.attachments || undefined,
      timestamp: message.timestamp || Date.now(),
      sync: true  // 已同步标记
    }
    
    store.put(msg)
  } catch (e) {
    console.error('[db] saveMessage error:', e)
  }
}

/** 批量保存消息（用于加载历史后） */
export async function saveMessages(messages) {
  if (!messages || !messages.length) return
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    
    messages.forEach(msg => {
      if (!msg.id) return
      store.put({
        id: msg.id,
        sessionKey: msg.sessionKey || '',
        role: msg.role || 'assistant',
        content: msg.content || msg.text || '',
        timestamp: msg.timestamp || Date.now(),
        sync: true
      })
    })
  } catch (e) {
    console.error('[db] saveMessages error:', e)
  }
}

/** 获取会话消息（本地） */
export async function getLocalMessages(sessionKey, limit = 200) {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const index = store.index('sessionKey_timestamp')
      const range = IDBKeyRange.bound(
        [sessionKey, 0],
        [sessionKey, Date.now() + 1]
      )
      
      const messages = []
      const request = index.openCursor(range, 'prev')  // 倒序获取（最新的在前）
      
      request.onsuccess = (event) => {
        const cursor = event.target.result
        if (cursor && messages.length < limit) {
          messages.push(cursor.value)
          cursor.continue()
        }
      }
      
      tx.oncomplete = () => resolve(messages.reverse())  // 转为正序
      tx.onerror = () => resolve([])
    })
  } catch (e) {
    console.error('[db] getLocalMessages error:', e)
    return []
  }
}

/** 删除会话的所有消息 */
export async function clearSessionMessages(sessionKey) {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const index = store.index('sessionKey')
    const request = index.openCursor(sessionKey)
    
    request.onsuccess = (event) => {
      const cursor = event.target.result
      if (cursor) {
        cursor.delete()
        cursor.continue()
      }
    }
  } catch (e) {
    console.error('[db] clearSessionMessages error:', e)
  }
}

/** 保存会话信息 */
export async function saveSessionInfo(session) {
  if (!session || !session.sessionKey) return
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_SESSIONS, 'readwrite')
    const store = tx.objectStore(STORE_SESSIONS)
    store.put({
      sessionKey: session.sessionKey,
      name: session.name || '',
      updatedAt: session.updatedAt || Date.now(),
      lastActivity: session.lastActivity || Date.now()
    })
  } catch (e) {
    console.error('[db] saveSessionInfo error:', e)
  }
}

/** 获取所有本地会话 */
export async function getLocalSessions() {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_SESSIONS, 'readonly')
      const store = tx.objectStore(STORE_SESSIONS)
      const request = store.getAll()
      
      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => resolve([])
    })
  } catch (e) {
    console.error('[db] getLocalSessions error:', e)
    return []
  }
}

/** 检查 IndexedDB 是否可用 */
export function isStorageAvailable() {
  try {
    return 'indexedDB' in window && !!indexedDB
  } catch (e) {
    return false
  }
}

/** 获取存储使用情况 */
export async function getStorageUsage() {
  if (navigator.storage && navigator.storage.estimate) {
    const estimate = await navigator.storage.estimate()
    return {
      usage: estimate.usage || 0,
      quota: estimate.quota || 0,
      usagePercent: estimate.quota ? (estimate.usage / estimate.quota * 100).toFixed(2) : 0
    }
  }
  return null
}

/** 获取单个会话信息 */
export async function getSession(sessionKey) {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_SESSIONS, 'readonly')
      const store = tx.objectStore(STORE_SESSIONS)
      const request = store.get(sessionKey)

      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => resolve(null)
    })
  } catch (e) {
    console.error('[db] getSession error:', e)
    return null
  }
}

/**
 * Sync sessions from server (for logged-in users)
 */
export async function syncSessionsFromServer() {
  if (authManager.authType !== 'jwt') {
    return; // Only sync for logged-in users
  }

  try {
    const sessions = await api.listSessions();

    for (const session of sessions) {
      const existing = await getSession(session.gateway_session_id);

      if (!existing) {
        // New session from server, add to local storage
        await saveSessionInfo({
          sessionKey: session.gateway_session_id,
          name: session.title || 'New Chat',
          updatedAt: session.updated_at || Date.now(),
          lastActivity: session.updated_at || Date.now()
        });
      }
    }

    console.log(`Synced ${sessions.length} sessions from server`);
  } catch (error) {
    console.error('Failed to sync sessions:', error);
  }
}

/**
 * Save session to server (for logged-in users)
 */
export async function saveSessionToServer(session) {
  if (authManager.authType !== 'jwt') {
    return; // Only save for logged-in users
  }

  try {
    await api.createSession(
      session.sessionKey,
      session.agentId || 'default',
      session.name
    );
    console.log('Session saved to server:', session.sessionKey);
  } catch (error) {
    console.error('Failed to save session to server:', error);
  }
}
