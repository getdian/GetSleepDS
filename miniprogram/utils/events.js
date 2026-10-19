const api = require('./api')
const { withLogin } = require('./login')
const storage = require('./storage')
const { getConfig } = require('./config')

const KEY = storage.KEYS.events
const MAX_QUEUE = 80
const BATCH_SIZE = 20
const FLUSH_DELAY = 4000
const RETRY_DELAY = 15000

let timer = null
let flushing = null
let seq = 0

function makeId() {
  seq += 1
  return Date.now().toString(36) + '-' + seq
}

function read() {
  try {
    const value = wx.getStorageSync(KEY)
    return Array.isArray(value) ? value : []
  } catch (e) {
    return []
  }
}

function write(list) {
  try {
    wx.setStorageSync(KEY, list)
    return true
  } catch (e) {
    return false
  }
}

/**
 * 轻量事件：只上报类型与目标（音频 id），不涉及睡眠明细。
 */
function track(type, target) {
  // 运营可在后台关闭匿名事件统计；关闭后连本地队列都不写
  const config = getConfig()
  if (config.features && config.features.events === false) return

  const list = read()
  list.push({ id: makeId(), type, target: target || '', ts: Date.now() })
  if (list.length > MAX_QUEUE) list.splice(0, list.length - MAX_QUEUE)
  write(list)
  schedule(FLUSH_DELAY)
}

function schedule(delay) {
  if (timer || flushing) return
  timer = setTimeout(() => {
    timer = null
    flush()
  }, delay || FLUSH_DELAY)
}

/**
 * 一次最多发 20 条；成功后按 id 删除已确认批次，避免并发 track 造成错位。
 * 失败不丢队列；4xx 视为永久脏数据，丢弃本批以免永远卡住。
 */
function flush() {
  if (flushing) return flushing

  const queued = read()
  if (!queued.length) return Promise.resolve({ skipped: 'empty' })

  const batch = queued.slice(0, BATCH_SIZE)
  const ids = {}
  batch.forEach((item) => {
    ids[item.id] = true
  })

  flushing = withLogin((code) => api.trackEvents(code, batch))
    .then((res) => {
      const current = read()
      write(current.filter((item) => !ids[item.id]))
      return res
    })
    .catch((error) => {
      // 服务端已明确拒绝的批次不再重试；网络/5xx 保留，指数退避
      if (error && error.status >= 400 && error.status < 500) {
        const current = read()
        write(current.filter((item) => !ids[item.id]))
      }
      return null
    })
    .then((result) => {
      flushing = null
      if (read().length) schedule(result ? 1000 : RETRY_DELAY)
      return result
    })

  return flushing
}

/** 清除待上报队列（“清除全部数据”时调用） */
function clearQueue() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  write([])
}

module.exports = { track, flush, clearQueue }
