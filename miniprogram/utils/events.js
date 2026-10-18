const api = require('./api')
const { wxLogin } = require('./login')

const KEY = 'sleep:events:v1'
const MAX_QUEUE = 80
const FLUSH_DELAY = 4000

let timer = null
let flushing = null

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
  } catch (e) {}
}

/**
 * 轻量事件：只上报类型与目标（音频 id），不涉及睡眠明细。
 */
function track(type, target) {
  const list = read()
  list.push({ type, target: target || '', ts: Date.now() })
  if (list.length > MAX_QUEUE) list.splice(0, list.length - MAX_QUEUE)
  write(list)
  schedule()
}

function schedule() {
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    flush()
  }, FLUSH_DELAY)
}

function flush() {
  if (flushing) return flushing

  const queued = read()
  if (!queued.length) return Promise.resolve({ skipped: 'empty' })

  flushing = wxLogin()
    .then((code) => api.trackEvents(code, queued))
    .then((res) => {
      // 请求期间可能又产生新事件，只移除已经发出的那批
      const current = read()
      current.splice(0, queued.length)
      write(current)
      return res
    })
    .catch(() => null)
    .then((result) => {
      flushing = null
      return result
    })

  return flushing
}

module.exports = { track, flush }
