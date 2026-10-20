const FALLBACK = require('../config/fallback')
const api = require('./api')
const storage = require('./storage')

const CACHE_TTL = 10 * 60 * 1000

let memory = null
let inflight = null

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
  const cache = storage.getConfigCache()
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL) {
    memory = merge(cache.data)
    return Promise.resolve(memory)
  }
  // 冷启动时 app.onLaunch / 页面 onLoad / ads.apply 会同时触发，共享同一个在途请求。
  if (inflight) return inflight

  inflight = api
    .fetchConfig()
    .then((data) => {
      storage.setConfigCache(data)
      memory = merge(data)
      return memory
    })
    .catch(() => {
      memory = merge(cache ? cache.data : null)
      return memory
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

module.exports = {
  getConfig,
  loadConfig
}
