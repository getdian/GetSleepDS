const META_KEY = 'sleep:audio-cache:v1'
const PRUNE_KEY = 'sleep:cache-pruned-at'
const DIR = wx.env.USER_DATA_PATH + '/sleep-audio'
const DAY_MS = 24 * 60 * 60 * 1000

let dirReady = false
const listeners = []

function notify() {
  listeners.slice().forEach((fn) => {
    try {
      fn()
    } catch (e) {}
  })
}

function onChange(fn) {
  if (typeof fn === 'function' && listeners.indexOf(fn) < 0) listeners.push(fn)
}

function offChange(fn) {
  const index = listeners.indexOf(fn)
  if (index >= 0) listeners.splice(index, 1)
}

function readMeta() {
  try {
    const value = wx.getStorageSync(META_KEY)
    return value && typeof value === 'object' ? value : {}
  } catch (e) {
    return {}
  }
}

function writeMeta(meta) {
  try {
    wx.setStorageSync(META_KEY, meta)
  } catch (e) {}
}

function hash(text) {
  let h = 5381
  for (let i = 0; i < text.length; i += 1) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0
  }
  return Math.abs(h).toString(36)
}

function pathFor(url) {
  const match = String(url).split('?')[0].match(/\.(mp3|m4a|aac|wav|ogg)$/i)
  const ext = match ? match[1].toLowerCase() : 'mp3'
  return DIR + '/' + hash(url) + '.' + ext
}

function ensureDir() {
  if (dirReady) return Promise.resolve()
  return new Promise((resolve) => {
    const fs = wx.getFileSystemManager()
    fs.access({
      path: DIR,
      success() {
        dirReady = true
        resolve()
      },
      fail() {
        fs.mkdir({
          dirPath: DIR,
          recursive: true,
          success() {
            dirReady = true
            resolve()
          },
          fail() {
            resolve()
          }
        })
      }
    })
  })
}

/** 命中缓存返回本地路径，否则返回空字符串 */
function peek(url, ttlDays) {
  if (!url) return ''
  const meta = readMeta()
  const item = meta[url]
  if (!item || !item.path) return ''

  const age = Date.now() - (item.savedAt || 0)
  if (ttlDays && age > ttlDays * DAY_MS) {
    remove(url)
    return ''
  }

  try {
    wx.getFileSystemManager().accessSync(item.path)
    return item.path
  } catch (e) {
    delete meta[url]
    writeMeta(meta)
    return ''
  }
}

function remove(url) {
  const meta = readMeta()
  const item = meta[url]
  if (!item) return
  try {
    wx.getFileSystemManager().unlinkSync(item.path)
  } catch (e) {}
  delete meta[url]
  writeMeta(meta)
}

function download(url, onProgress, ttlDays) {
  return ensureDir().then(
    () =>
      new Promise((resolve, reject) => {
        const task = wx.downloadFile({
          url,
          timeout: 60000,
          success(res) {
            if (res.statusCode !== 200) {
              reject(new Error('HTTP ' + res.statusCode))
              return
            }
            const dest = pathFor(url)
            const fs = wx.getFileSystemManager()
            try {
              fs.unlinkSync(dest)
            } catch (e) {}
            fs.saveFile({
              tempFilePath: res.tempFilePath,
              filePath: dest,
              success() {
                let size = res.dataLength || 0
                try {
                  size = fs.statSync(dest).size || size
                } catch (e) {}
                const meta = readMeta()
                meta[url] = {
                  path: dest,
                  size,
                  savedAt: Date.now()
                }
                writeMeta(meta)
                notify()
                resolve(dest)
              },
              fail() {
                reject(new Error('保存缓存失败'))
              }
            })
          },
          fail(err) {
            reject(new Error((err && err.errMsg) || '下载失败'))
          }
        })

        if (onProgress && task && task.onProgressUpdate) {
          task.onProgressUpdate((res) => onProgress(res.progress))
        }
      })
  )
}

function ensure(url, onProgress, ttlDays) {
  const cached = peek(url, ttlDays)
  if (cached) return Promise.resolve(cached)
  return download(url, onProgress, ttlDays)
}

/** 超过上限或过期时清理，最多一天执行一次 */
function maybePrune(cacheConfig) {
  const config = cacheConfig || {}
  let last = 0
  try {
    last = Number(wx.getStorageSync(PRUNE_KEY)) || 0
  } catch (e) {
    last = 0
  }
  if (Date.now() - last < DAY_MS) return 0

  const maxBytes = (config.maxMB || 80) * 1024 * 1024
  const ttlDays = config.ttlDays || 7
  const meta = readMeta()
  const entries = Object.keys(meta)
    .map((url) => Object.assign({ url: url }, meta[url]))
    .sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0))

  let total = 0
  entries.forEach((entry) => {
    total += entry.size || 0
  })

  let removed = 0
  entries.forEach((entry) => {
    const expired = Date.now() - (entry.savedAt || 0) > ttlDays * DAY_MS
    if (!expired && total <= maxBytes) return
    remove(entry.url)
    total -= entry.size || 0
    removed += 1
  })

  try {
    wx.setStorageSync(PRUNE_KEY, Date.now())
  } catch (e) {}

  if (removed) notify()
  return removed
}

function usedBytes() {
  const meta = readMeta()
  return Object.keys(meta).reduce((total, url) => total + (meta[url].size || 0), 0)
}

function cachedCount(tracks, ttlDays) {
  return (tracks || []).filter((track) => !!peek(track.url, ttlDays)).length
}

function cleanAll(exceptUrl) {
  const meta = readMeta()
  const kept = {}
  Object.keys(meta).forEach((url) => {
    if (exceptUrl && url === exceptUrl) {
      kept[url] = meta[url]
      return
    }
    try {
      wx.getFileSystemManager().unlinkSync(meta[url].path)
    } catch (e) {}
  })
  writeMeta(kept)
  notify()
}

/**
 * 进入小程序/音频页的预热：仅 Wi-Fi、仅已解锁、最多前两条。
 */
function warmup(tracks, cacheConfig, unlocked) {
  if (!unlocked || !tracks || !tracks.length) return
  const ttlDays = (cacheConfig && cacheConfig.ttlDays) || 7

  wx.getNetworkType({
    success(res) {
      if (res.networkType !== 'wifi') return
      tracks.slice(0, 2).forEach((track) => {
        if (!track.url) return
        ensure(track.url, null, ttlDays).catch(() => {})
      })
    }
  })
}

module.exports = {
  peek,
  ensure,
  remove,
  maybePrune,
  warmup,
  usedBytes,
  cachedCount,
  cleanAll,
  onChange,
  offChange
}
