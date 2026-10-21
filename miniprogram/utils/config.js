const FALLBACK = require('../config/fallback')
const api = require('./api')
const storage = require('./storage')

const CACHE_TTL = 10 * 60 * 1000

let memory = null
let inflight = null
// 失败不抛出是为了主流程可用，但调用方需要能区分“配置确实为空”与“拉取失败”。
let lastErrorAt = 0
let lastLoadedAt = 0

const AD_SLOTS = ['home', 'sleep', 'stats', 'statsFooter']

/** 展示位逐槽合并：旧配置没有 ads 时全部回落到关闭状态 */
function mergeAds(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const out = {}
  AD_SLOTS.forEach((slot) => {
    const base = FALLBACK.ads[slot] || {}
    const item = source[slot] && typeof source[slot] === 'object' ? source[slot] : {}
    out[slot] = Object.assign({}, base, item)
  })
  return out
}

function merge(raw) {
  if (!raw) return FALLBACK
  return {
    version: raw.version || FALLBACK.version,
    audio: Array.isArray(raw.audio) && raw.audio.length ? raw.audio : FALLBACK.audio,
    unlock: Object.assign({}, FALLBACK.unlock, raw.unlock || {}),
    ads: mergeAds(raw.ads),
    backgrounds: Array.isArray(raw.backgrounds) ? raw.backgrounds : FALLBACK.backgrounds,
    defaultBackgroundId:
      typeof raw.defaultBackgroundId === 'string'
        ? raw.defaultBackgroundId
        : FALLBACK.defaultBackgroundId,
    backgroundUnlockHours:
      Number(raw.backgroundUnlockHours) || FALLBACK.backgroundUnlockHours,
    features: Object.assign({}, FALLBACK.features, raw.features || {}),
    reminder: Object.assign({}, FALLBACK.reminder, raw.reminder || {}),
    cache: Object.assign({}, FALLBACK.cache, raw.cache || {}),
    copy: Object.assign({}, FALLBACK.copy, raw.copy || {})
  }
}

function getConfig() {
  if (memory) return memory
  const cache = storage.getConfigCache()
  memory = merge(cache ? cache.data : null)
  return memory
}

/**
 * 拉取远程配置。任何失败都不抛出，返回缓存或内置兜底。
 */
function loadConfig(force) {
  // 只要有在途请求，就必须等它，不能先用旧缓存短路；否则 app.onLaunch 的
  // force 请求还没回来，页面 onLoad 的 force:false 会拿着旧缓存渲染，
  // 后台刚改的背景图/广告位要等 10 分钟 TTL 才出现。
  if (inflight) return inflight

  const cache = storage.getConfigCache()
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL) {
    memory = merge(cache.data)
    return Promise.resolve(memory)
  }

  inflight = api
    .fetchConfig()
    .then((data) => {
      storage.setConfigCache(data)
      memory = merge(data)
      lastLoadedAt = Date.now()
      lastErrorAt = 0
      return memory
    })
    .catch(() => {
      lastErrorAt = Date.now()
      memory = merge(cache ? cache.data : null)
      return memory
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/**
 * 最近一次远程拉取是否失败：失败时 loadConfig 返回的是兜底配置（backgrounds=[]），
 * 页面不能据此断言“后台没有配置”。
 */
function getConfigStatus() {
  return {
    failed: lastErrorAt > 0 && lastErrorAt >= lastLoadedAt,
    failedAt: lastErrorAt,
    loadedAt: lastLoadedAt
  }
}

module.exports = {
  getConfig,
  loadConfig,
  getConfigStatus
}
