const META_KEY = 'sleep:audio-cache:v1'
const PRUNE_KEY = 'sleep:cache-pruned-at'
const DIR = wx.env.USER_DATA_PATH + '/sleep-audio'
const DAY_MS = 24 * 60 * 60 * 1000

let dirReady = false
const listeners = []

/**
 * 会话级坏源黑名单：播放报错但磁盘文件仍在（解码/网络抖动）时只标记、不删文件。
 * 放在缓存模块而不是组件里，是为了让「自动续播」与「预热/自动缓存」也共享同一口径：
 * - peek() 命中坏源返回空 → 组件回退远程、续播不会再次命中；
 * - 下载成功自动解禁（文件已被重下/修复）；
 * - 手动播放/清理缓存时解禁，允许用户重新验证一次。
 */
const badUrls = new Set()

function markBad(url) {
  if (url) badUrls.add(url)
}

function isBad(url) {
  return !!url && badUrls.has(url)
}

function clearBad(url) {
  if (url) badUrls.delete(url)
  else badUrls.clear()
}

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

/**
 * 命中缓存返回本地路径，否则返回空字符串。
 * keepUrl：正在播放的 URL。TTL 到期时只判空、不删文件，
 * 否则 refreshCache/applyFilter 这类高频调用会删掉在播文件导致中断。
 */
function peek(url, ttlDays, keepUrl) {
  if (!url) return ''
  // 本会话内已判定播不出来的源：不算命中，让调用方走远程/重下
  if (isBad(url)) return ''
  const meta = readMeta()
  const item = meta[url]
  if (!item || !item.path) return ''

  const age = Date.now() - (item.savedAt || 0)
  if (ttlDays && age > ttlDays * DAY_MS) {
    if (!keepUrl || keepUrl !== url) {
      remove(url)
      notify()
    }
    return ''
  }

  try {
    wx.getFileSystemManager().accessSync(item.path)
    return item.path
  } catch (e) {
    delete meta[url]
    writeMeta(meta)
    // 文件已丢：让“已缓存”角标/缓存统计立即刷新，而不是等下一次手动刷新
    notify()
    return ''
  }
}

function remove(url) {
  clearBad(url)
  const meta = readMeta()
  const item = meta[url]
  if (!item) return
  try {
    wx.getFileSystemManager().unlinkSync(item.path)
  } catch (e) {}
  delete meta[url]
  writeMeta(meta)
}

/**
 * 缓存文件是否仍在磁盘上（只读：不判 TTL、不删除、不通知）。
 * 播放报错时用它区分「本地文件坏了」与「网络/解码错误」：
 * 后者不该删文件——切歌竞态下删的可能已经是新曲的正常缓存。
 */
function isUsable(url) {
  if (!url) return false
  const meta = readMeta()
  const item = meta[url]
  if (!item || !item.path) return false
  try {
    wx.getFileSystemManager().accessSync(item.path)
    return true
  } catch (e) {
    return false
  }
}

// 同一 URL 的进行中任务。warmup / 解锁预热 / 用户取消后重试都可能撞在一起，
// 没有这张表时两个 download 会同时 unlink + saveFile 同一路径。
const inflight = new Map()

function download(url, onProgress, ttlDays, onTask) {
  return ensureDir().then(
    () =>
      new Promise((resolve, reject) => {
        const dest = pathFor(url)
        // 先写临时文件，再原子替换；避免 unlink(dest) 删掉正在播放的文件。
        const tmp = dest + '.part-' + Date.now().toString(36)
        const cleanupTmp = () => {
          try {
            wx.getFileSystemManager().unlinkSync(tmp)
          } catch (e) {}
        }

        const task = wx.downloadFile({
          url,
          timeout: 60000,
          success(res) {
            if (res.statusCode !== 200) {
              cleanupTmp()
              reject(new Error('HTTP ' + res.statusCode))
              return
            }
            const fs = wx.getFileSystemManager()
            fs.saveFile({
              tempFilePath: res.tempFilePath,
              filePath: tmp,
              success() {
                try {
                  try {
                    fs.renameSync(tmp, dest)
                  } catch (e) {
                    // 个别文件系统不允许 rename 覆盖已有文件。
                    // 不能先 unlink(dest)：dest 可能正是 BackgroundAudioManager 正在读的
                    // 在播文件（TTL 过期后重下/预热撞上播放），删掉会让 seek 或循环重开失败。
                    // 先改名备份，换入新文件；换入失败时把备份还原。
                    const backup = dest + '.old-' + Date.now().toString(36)
                    let moved = false
                    try {
                      fs.renameSync(dest, backup)
                      moved = true
                    } catch (e2) {}
                    try {
                      fs.renameSync(tmp, dest)
                    } catch (e3) {
                      if (moved) {
                        try {
                          fs.renameSync(backup, dest)
                        } catch (e4) {}
                      }
                      throw e3
                    }
                    if (moved) {
                      try {
                        fs.unlinkSync(backup)
                      } catch (e5) {}
                    }
                  }
                } catch (e) {
                  cleanupTmp()
                  reject(new Error('保存缓存失败'))
                  return
                }
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
                // 重新下载成功 = 文件已修复，解除本会话的坏源标记
                clearBad(url)
                notify()
                resolve(dest)
              },
              fail() {
                cleanupTmp()
                reject(new Error('保存缓存失败'))
              }
            })
          },
          fail(err) {
            cleanupTmp()
            reject(new Error((err && err.errMsg) || '下载失败'))
          }
        })

        if (onTask) onTask(task)
        if (onProgress && task && task.onProgressUpdate) {
          task.onProgressUpdate((res) => onProgress(res.progress))
        }
      })
  )
}

function ensure(url, onProgress, ttlDays) {
  // 即使 TTL 已过也不先删旧文件：rename 会原子覆盖，提前删只会在播时造成中断
  const cached = peek(url, ttlDays, url)
  if (cached) return Promise.resolve(cached)

  const running = inflight.get(url)
  if (running) {
    if (typeof onProgress === 'function') running.progress.push(onProgress)
    return running.promise
  }

  const progress = typeof onProgress === 'function' ? [onProgress] : []
  const entry = { progress, task: null, promise: null, cancelled: false }
  entry.promise = download(
    url,
    (percent) => {
      progress.slice().forEach((fn) => {
        try {
          fn(percent)
        } catch (e) {}
      })
    },
    ttlDays,
    (task) => {
      entry.task = task
      // 取消可能发生在 ensureDir 完成之前，此时 task 还没创建。
      if (entry.cancelled && task && task.abort) {
        try {
          task.abort()
        } catch (e) {}
      }
    }
  )
  inflight.set(url, entry)
  const clear = () => {
    if (inflight.get(url) === entry) inflight.delete(url)
  }
  entry.promise.then(clear, clear)
  return entry.promise
}

/** 用户取消解锁时中止仍在进行的下载；已缓存的文件不受影响。 */
function cancel(url) {
  const entry = inflight.get(url)
  if (!entry) return false
  entry.cancelled = true
  if (inflight.get(url) === entry) inflight.delete(url)
  if (entry.task && entry.task.abort) {
    try {
      entry.task.abort()
    } catch (e) {}
  }
  return true
}

/** 超过上限或过期时清理，最多一天执行一次；keepUrl 用于保护正在播放的文件。 */
function maybePrune(cacheConfig, keepUrl) {
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
    if (keepUrl && entry.url === keepUrl) return
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

function cachedCount(tracks, ttlDays, keepUrl) {
  return (tracks || []).filter((track) => !!peek(track.url, ttlDays, keepUrl)).length
}

/** 单条缓存大小（字节）；未缓存返回 0。用于「删除这首缓存（X MB）」与按曲目管理 */
function sizeOf(url) {
  if (!url) return 0
  const item = readMeta()[url]
  return item && item.size ? Number(item.size) || 0 : 0
}

function cleanAll(exceptUrl) {
  // 先中止在途下载：否则「清理」完成后，还没下完的任务会把文件与计数重新写回来
  if (exceptUrl) {
    Array.from(badUrls).forEach((url) => {
      if (url !== exceptUrl) badUrls.delete(url)
    })
  } else {
    badUrls.clear()
  }
  Array.from(inflight.keys()).forEach((url) => {
    if (!exceptUrl || url !== exceptUrl) cancel(url)
  })
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
 * 主动播放后的自动缓存延迟：
 * - Wi-Fi：起播 8 秒后再下（让首播先跑稳，避免与流式播放抢带宽）；
 * - 移动网络：起播 20 秒后再下（避免只试听几秒也下整首；用户继续听说明是真需求）。
 * 注意：小程序无法复用 BackgroundAudioManager 的流缓存，首次后台下载会与流式播放
 * 并行（约多耗 1 倍流量），换来之后每次播放都走本地、不再重复下载。
 */
function autoCacheDelay(networkType) {
  // 即使 Wi-Fi 也要先给起播让路：首次是流式播放，若同时下整首（后台已有 1.5–11MB 的素材），
  // 两条连接抢带宽会表现为“播几秒突然暂停”。8s 后才开始后台缓存，移动网络 20s。
  return networkType === 'wifi' ? 8000 : 20000
}

/**
 * 自动缓存的容量闸：已占用达到后台 maxMB（默认 80）就不再自动下载。
 * maybePrune 一天只跑一次，不加这道闸时连续试听多首会把占用推过上限直到第二天。
 * 用户主动的「缓存」动作不受此限。
 */
function canAutoCache(cacheConfig) {
  const maxMB = Number(cacheConfig && cacheConfig.maxMB) || 80
  return usedBytes() < maxMB * 1024 * 1024
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
  cancel,
  remove,
  isUsable,
  markBad,
  isBad,
  clearBad,
  maybePrune,
  autoCacheDelay,
  canAutoCache,
  warmup,
  usedBytes,
  cachedCount,
  sizeOf,
  cleanAll,
  onChange,
  offChange
}
