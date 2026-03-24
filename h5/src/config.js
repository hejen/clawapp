/**
 * 统一配置管理
 * 用于管理前后端交互的服务器地址配置
 *
 * 配置优先级：
 * 1. localStorage 用户配置（最高优先级）
 * 2. 运行时自动检测（当前域名和路径）
 */

const STORAGE_KEY = 'clawapp-config'

/**
 * 获取默认的 API 基础 URL - 运行时自动检测
 */
function getDefaultApiBase() {
  // 自动适配当前域名和路径
  const origin = window.location.origin
  const pathname = window.location.pathname.replace(/\/$/, '')
  
  // 构造完整的 API 基础 URL
  const apiBase = `${origin}${pathname}`
  
  console.log('[config] Auto-detected API base:', apiBase)
  return apiBase
}

/**
 * 获取 API 基础 URL
 * 优先使用用户配置，否则使用默认值
 */
export function getApiBase() {
  // 1. 检查用户配置（localStorage）
  try {
    const config = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    if (config.host) {
      const host = config.host
      // 如果 host 已经包含协议，直接使用
      if (host.startsWith('http://') || host.startsWith('https://')) {
        console.log('[config] Using user config:', host)
        return host.replace(/\/+$/, '')
      }
      // 智能判断协议：IP 地址使用 http，域名使用 https
      const isIP = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(host)
      const isLocal = host === 'localhost' || host.startsWith('127.0.0.1')
      const protocol = (isIP || isLocal) ? 'http' : 'https'
      const url = `${protocol}://${host}`
      console.log('[config] Using user config:', url)
      return url
    }
  } catch (e) {
    console.error('[config] Failed to load config:', e)
  }

  // 2. 使用自动检测的默认值
  const defaultUrl = getDefaultApiBase()
  console.log('[config] Using auto-detected URL:', defaultUrl)
  return defaultUrl
}

/**
 * 获取代理 Token（如果使用 JWT 认证，这个可能为空）
 */
export function getProxyToken() {
  try {
    const config = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return config.token || null
  } catch (e) {
    return null
  }
}

/**
 * 保存配置
 */
export function saveConfig(host, token) {
  const config = { host, token }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  console.log('[config] Config saved:', { host, token })
}

/**
 * 获取完整配置对象
 */
export function getConfig() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch (e) {
    return {}
  }
}

/**
 * 检查是否在 Capacitor 环境中
 */
export function isCapacitorApp() {
  return !!window.Capacitor?.getPlatform()
}

/**
 * 获取平台信息
 */
export function getPlatform() {
  if (window.Capacitor?.getPlatform()) {
    return `capacitor:${window.Capacitor.getPlatform()}`
  }
  return 'web'
}
