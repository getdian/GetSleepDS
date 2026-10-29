/**
 * 首页背景图。
 * 默认背景免费并静默缓存；用户主动更换的图片看激励视频解锁，到期自动回退默认。
 * 纯函数 normalize/defaultOf/activeOf/categories 可在 Node 里单测。
 */
const storage = require('./storage')
const F = require('./format')

/**
 * 列表缩略图走 COS 图片处理，避免选择器一次拉 20 张原图。
 * 若 COS 未开图片处理，picker 会在 binderror 时回退原图。
 */
function thumbUrlOf(url, width) {
  if (!url || typeof url !== 'string' || url.indexOf('https://') !== 0) return ''
  if (url.indexOf('imageMogr2') >= 0) return url
  return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'imageMogr2/thumbnail/' + (width || 360) + 'x'
}

function normalize(list) {
  return (Array.isArray(list) ? list : [])
    .filter((item) => item && item.enabled !== false && item.id && item.url)
    .map((item, index) => ({
      id: item.id,
      title: item.title || '夜色',
      category: item.category || '夜色',
      url: item.url,
      thumbUrl: thumbUrlOf(item.url),
      sort: Number.isInteger(item.sort) ? item.sort : index,
      // 展示用「已被使用 N 次」的后台人气基数（真实次数由服务端累加）
      useBase: Math.max(0, Math.floor(Number(item.useBase) || 0))
    }))
    .sort((a, b) => a.sort - b.sort)
}

/**
 * 背景列表第二行的使用次数文案。
 * 0 次时回落「可随时更换」——没人用过还写「已被使用 0 次」比不显示更伤信任，
 * 也保留了原文案的可切换暗示。
 */
function useTextOf(count) {
  const num = Math.max(0, Math.floor(Number(count) || 0))
  if (!num) return '可随时更换'
  const wan = F.compactWan(num)
  if (wan) return '已被使用 ' + wan + ' 万次'
  return '已被使用 ' + num + ' 次'
}

/**
 * 展示值 = 后台人气基数（item.useBase）+ 真实使用次数（服务端 real）。
 * 真实数缺失/非法按 0：网络抖动不会把运营设的值显示成 0，
 * 运营调低基数也不会被旧的展示值压住（基数永远取当前配置）。
 */
function withUseCounts(items, realMap) {
  const map = realMap || {}
  return (items || []).map((item) => {
    const real = Math.max(0, Math.floor(Number(map[item.id]) || 0))
    const count = (Number(item.useBase) || 0) + real
    return Object.assign({}, item, {
      useCount: count,
      useText: useTextOf(count)
    })
  })
}

function defaultOf(config) {
  const list = normalize(config && config.backgrounds)
  if (!list.length) return null
  const id = config && config.defaultBackgroundId
  return (
    list.filter((item) => item.id === id)[0] ||
    list[0]
  )
}

function isUnlocked(unlocked, id, now) {
  return !!unlocked && unlocked.id === id && Number(unlocked.expireAt) > (now || Date.now())
}

function activeOf(config, unlocked, now) {
  const list = normalize(config && config.backgrounds)
  if (!list.length) return null
  const fallback = defaultOf(config)
  if (!unlocked || !isUnlocked(unlocked, unlocked.id, now)) return fallback
  return list.filter((item) => item.id === unlocked.id)[0] || fallback
}

function categories(list) {
  const seen = {}
  const out = []
  ;(list || []).forEach((item) => {
    const category = item.category || '夜色'
    if (seen[category]) return
    seen[category] = true
    out.push(category)
  })
  return ['全部'].concat(out)
}

function localPathOf(url) {
  if (!url) return ''
  const cache = storage.getBackgroundCache()
  const entry = cache[url]
  if (!entry || !entry.path) return ''
  try {
    // 微信清理用户文件后索引可能仍在；不校验会每次先失败再回退远程
    wx.getFileSystemManager().accessSync(entry.path)
    return entry.path
  } catch (e) {
    delete cache[url]
    try {
      wx.setStorageSync(storage.KEYS.backgroundCache, cache)
    } catch (err) {}
    return ''
  }
}

function hashUrl(url) {
  let hash = 0
  for (let i = 0; i < url.length; i += 1) {
    hash = (hash * 31 + url.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36)
}

/** 下载并持久化到 USER_DATA_PATH；失败返回空串，调用方继续用远程 URL */
function cacheImage(url) {
  if (!url) return Promise.resolve('')
  const cached = localPathOf(url)
  if (cached) return Promise.resolve(cached)
  if (!wx.downloadFile || !wx.getFileSystemManager) return Promise.resolve('')

  return new Promise((resolve) => {
    wx.downloadFile({
      url,
      success: (res) => {
        if (res.statusCode !== 200 || !res.tempFilePath) {
          resolve('')
          return
        }
        try {
          const target = wx.env.USER_DATA_PATH + '/bg-' + hashUrl(url) + '.img'
          wx.getFileSystemManager().copyFileSync(res.tempFilePath, target)
          storage.setBackgroundCache(url, target)
          resolve(target)
        } catch (e) {
          resolve(res.tempFilePath)
        }
      },
      fail: () => resolve('')
    })
  })
}

/** 当前应使用的背景（带 localPath）；异步把图片缓存到本地 */
function prepare(config, onCached) {
  const unlocked = storage.getBackgroundUnlock()
  const active = activeOf(config, unlocked)
  if (!active) return null

  const result = Object.assign({}, active, { localPath: localPathOf(active.url) })
  cacheImage(active.url).then((path) => {
    if (path && onCached) onCached(active.id, path)
  })
  return result
}

function unlock(id, hours) {
  const ttl = Number(hours) || 24
  return storage.setBackgroundUnlock({
    id,
    expireAt: Date.now() + ttl * 60 * 60 * 1000
  })
}

/** 清除背景图本地缓存文件（“清除数据”或切换缓存时使用） */
function cleanCache() {
  const cache = storage.getBackgroundCache()
  Object.keys(cache).forEach((url) => {
    const path = cache[url] && cache[url].path
    if (!path) return
    try {
      wx.getFileSystemManager().unlinkSync(path)
    } catch (e) {}
  })
  return storage.clearBackgroundCache()
}

function getUnlocked() {
  return storage.getBackgroundUnlock()
}

module.exports = {
  normalize,
  useTextOf,
  withUseCounts,
  thumbUrlOf,
  defaultOf,
  isUnlocked,
  activeOf,
  categories,
  localPathOf,
  cacheImage,
  prepare,
  unlock,
  getUnlocked,
  cleanCache
}
