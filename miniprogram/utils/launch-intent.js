/**
 * 订阅消息的入睡页意图（end=1 / remind=sleep|wake）。
 *
 * 微信热启动到已缓存的 tab 页时不会重新执行页面 onLoad，而 App.onShow(options)
 * 仍会收到本次进入的 query。这里把 App 收到的意图暂存一次，由入睡页 onShow
 * 消费，避免“点提醒只回到小程序、不开结束面板”。
 *
 * 只保存不带睡眠数据的路由参数；超过 TTL 的意图视为过期，避免普通回前台
 * 时被一条很久以前的提醒重新触发。
 */
const MAX_AGE_MS = 2 * 60 * 1000

let pending = null
let seq = 0

function normalize(options) {
  const query = (options && options.query) || {}
  if (query.end === '1') {
    return { end: true, remind: '' }
  }
  if (query.remind === 'sleep' || query.remind === 'wake') {
    return { end: false, remind: query.remind }
  }
  return null
}

function capture(options, now) {
  const next = normalize(options)
  if (!next) return null
  pending = Object.assign(next, {
    id: ++seq,
    capturedAt: Number(now) || Date.now()
  })
  return pending
}

function hasPending() {
  return !!pending
}

function take(now) {
  if (!pending) return null
  const current = Number(now) || Date.now()
  if (current - pending.capturedAt > MAX_AGE_MS) {
    pending = null
    return null
  }
  const currentIntent = pending
  pending = null
  return currentIntent
}

function reset() {
  pending = null
  seq = 0
}

module.exports = {
  capture,
  hasPending,
  take,
  reset,
  normalize,
  MAX_AGE_MS
}
