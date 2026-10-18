const storage = require('./storage')

let endAt = 0
let totalMinutes = 0
let ticker = null
let listeners = []

function remaining() {
  return endAt ? Math.max(0, endAt - Date.now()) : 0
}

function total() {
  return totalMinutes
}

function emit() {
  const left = remaining()
  listeners.slice().forEach((listener) => {
    try {
      listener(left)
    } catch (e) {}
  })
}

function stopAudio() {
  try {
    const audio = wx.getBackgroundAudioManager()
    audio.stop()
  } catch (e) {}
  storage.patchMeta({ lastTrackActive: false })
}

function clear() {
  endAt = 0
  totalMinutes = 0
  if (ticker) {
    clearInterval(ticker)
    ticker = null
  }
  emit()
}

function tick() {
  if (!endAt) return
  if (Date.now() >= endAt) {
    stopAudio()
    clear()
    return
  }
  emit()
}

function start(minutes) {
  const value = Number(minutes) || 0
  if (value <= 0) {
    clear()
    return
  }
  endAt = Date.now() + value * 60 * 1000
  totalMinutes = value
  if (ticker) clearInterval(ticker)
  ticker = setInterval(tick, 1000)
  emit()
}

function subscribe(listener) {
  listeners.push(listener)
  listener(remaining())
  return function unsubscribe() {
    listeners = listeners.filter((item) => item !== listener)
  }
}

module.exports = {
  start,
  clear,
  remaining,
  total,
  subscribe
}
