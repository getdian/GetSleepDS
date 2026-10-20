const storage = require('./storage')

let endAt = 0
let totalMinutes = 0
let pausedRemaining = 0
let ticker = null
let listeners = []

function remaining() {
  if (pausedRemaining > 0) return pausedRemaining
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

function persist(keepMinutes) {
  const meta = storage.getMeta()
  // 定时到点/手动停止只清运行态，不覆盖用户上次选择的分钟数；
  // 只有用户主动选“关”时才把偏好写成 0。
  const minutes = keepMinutes
    ? typeof meta.audioTimerMinutes === 'number'
      ? meta.audioTimerMinutes
      : totalMinutes
    : totalMinutes
  storage.patchMeta({
    audioTimerEndAt: endAt,
    audioTimerMinutes: minutes,
    audioTimerPausedRemaining: pausedRemaining
  })
}

function clearTicker() {
  if (ticker) {
    clearInterval(ticker)
    ticker = null
  }
}

function clear(silent, keepMinutes) {
  endAt = 0
  totalMinutes = 0
  pausedRemaining = 0
  clearTicker()
  if (!silent) persist(keepMinutes === true)
  emit()
}

function tick() {
  if (!endAt) return
  if (Date.now() >= endAt) {
    stopAudio()
    clear(undefined, true)
    return
  }
  emit()
}

function startTicker() {
  clearTicker()
  ticker = setInterval(tick, 1000)
}

function start(minutes) {
  const value = Number(minutes) || 0
  if (value <= 0) {
    clear()
    return
  }
  endAt = Date.now() + value * 60 * 1000
  totalMinutes = value
  pausedRemaining = 0
  startTicker()
  persist()
  emit()
}

/** 暂停计时：保留剩余毫秒，恢复时从剩余时间继续，而不是重新算一整段 */
function pause() {
  if (!endAt) return
  pausedRemaining = Math.max(0, endAt - Date.now())
  endAt = 0
  clearTicker()
  persist()
  emit()
}

function resume() {
  if (!pausedRemaining) return
  endAt = Date.now() + pausedRemaining
  pausedRemaining = 0
  startTicker()
  persist()
  emit()
}

function shouldStop() {
  return !!endAt && Date.now() >= endAt
}

function isPaused() {
  return pausedRemaining > 0
}

/** 冷启动/回到前台时恢复：到点直接停，未到点重新挂上 ticker */
function restore() {
  if (endAt || pausedRemaining) return remaining()
  const meta = storage.getMeta()
  const savedEnd = Number(meta.audioTimerEndAt) || 0
  const savedRemain = Number(meta.audioTimerPausedRemaining) || 0
  const savedTotal = Number(meta.audioTimerMinutes) || 0

  if (savedRemain > 0) {
    pausedRemaining = savedRemain
    totalMinutes = savedTotal
    emit()
    return pausedRemaining
  }
  if (!savedEnd) return 0
  if (savedEnd <= Date.now()) {
    stopAudio()
    clear(undefined, true)
    return 0
  }
  endAt = savedEnd
  totalMinutes = savedTotal
  startTicker()
  emit()
  return remaining()
}

/** 只更新“下次播放用多久”的偏好，不启动倒计时（暂停/未播放时使用） */
function setPreference(minutes) {
  const value = Number(minutes) || 0
  totalMinutes = value
  pausedRemaining = 0
  clearTicker()
  endAt = 0
  storage.patchMeta({ audioTimerMinutes: value, audioTimerEndAt: 0, audioTimerPausedRemaining: 0 })
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
  setPreference,
  pause,
  resume,
  restore,
  remaining,
  total,
  shouldStop,
  isPaused,
  subscribe
}
