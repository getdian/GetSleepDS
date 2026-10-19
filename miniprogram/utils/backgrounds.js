/**
 * 首页背景图。
 * 默认背景免费并静默缓存；用户主动更换的图片看激励视频解锁，到期自动回退默认。
 * 纯函数 normalize/defaultOf/activeOf/categories 可在 Node 里单测。
 */
const storage = require('./storage')

function normalize(list) {
  return (Array.isArray(list) ? list : [])
    .filter((item) => item && item.enabled !== false && item.id && item.url)
    .map((item, index) => ({
      id: item.id,
      title: item.title || '夜色',
      category: item.category || '夜色',
      url: item.url,
      sort: Number.isInteger(item.sort) ? item.sort : index
    }))
    .sort((a, b) => a.sort - b.sort)
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
  return entry && entry.path ? entry.path : ''
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

function getUnlocked() {
  return storage.getBackgroundUnlock()
}

module.exports = {
  normalize,
  defaultOf,
  isUnlocked,
  activeOf,
  categories,
  localPathOf,
  cacheImage,
  prepare,
  unlock,
  getUnlocked
}
