const storage = require('./storage')
const audioSession = require('./audio-session')

let endAt = 0
let totalMinutes = 0
let pausedRemaining = 0
let ticker = null
let listeners = []
// 最近一次“定时到点”的时间戳（不持久化），供 UI 做一次性提示
let expiredAt = 0

function remaining() {
  if (pausedRemaining > 0) return pausedRemaining
  return endAt ? Math.max(0, endAt - Date.now()) : 0
}

function total() {
  return totalMinutes
}

function lastExpiredAt() {
  return expiredAt
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
  // 定时到点是业务终止：只有这类显式终止才允许清会话（与“外部中断不算停止”同一口径）
  audioSession.markStopped()
  // 到点即结束这一段会话：播放器的定时偏好也要回到“关”。
  // 播放器起播时按自身 timerMinutes 重新起表，漏清会让用户“再点一首”时
  // 静默又开始上一轮的倒计时（UI 胶囊还显示“关”）。
  // 延迟 require：audio-player 会用到本模块，顶层引用会形成循环依赖。
  const player = require('./audio-player')
  if (player && player.setTimerMinutes) player.setTimerMinutes(0)
}

/** 后台音频是否仍有存活会话（冷启动时没有 src，持久化的倒计时不应继续生效） */
function hasLiveAudio() {
  try {
    if (!wx.getBackgroundAudioManager) return false
    const audio = wx.getBackgroundAudioManager()
    return !!(audio && audio.src)
  } catch (e) {
    return false
  }
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
  pausedRemaining = 0
  clearTicker()
  if (!silent) {
    if (keepMinutes === true) {
      persist(true)
    } else {
      totalMinutes = 0
      persist(false)
    }
  }
  totalMinutes = 0
  emit()
}

function tick() {
  if (!endAt) return
  if (Date.now() >= endAt) {
    expiredAt = Date.now()
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
  expiredAt = 0
  endAt = Date.now() + value * 60 * 1000
  totalMinutes = value
  pausedRemaining = 0
  startTicker()
  persist()
  emit()
}

/**
 * 暂停计时：保留剩余毫秒，恢复时从剩余时间继续，而不是重新算一整段。
 * 若暂停发生在“已到点但 tick 还没跑”的瞬间，按到点处理，避免倒计时被静默吞掉。
 */
function pause() {
  if (!endAt) return
  const left = endAt - Date.now()
  if (left <= 0) {
    expiredAt = Date.now()
    stopAudio()
    clear(undefined, true)
    return
  }
  pausedRemaining = left
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

/** 继续播放时按需续上倒计时：暂停中→续剩余；没有运行中的倒计时→按偏好重新起表 */
function arm(minutes) {
  if (pausedRemaining > 0) {
    resume()
    return true
  }
  if (endAt) return true
  const value = Number(minutes) || 0
  if (value <= 0) return false
  start(value)
  return true
}

function shouldStop() {
  return !!endAt && Date.now() >= endAt
}

function isPaused() {
  return pausedRemaining > 0
}

/** 冷启动/回到前台时恢复：到点立即停；无存活音频时清掉上次运行态 */
function restore() {
  if (endAt) {
    if (Date.now() >= endAt) {
      // 切后台/锁屏期间 JS 被挂起，回来时不能只返回 0 而让音频继续播
      expiredAt = Date.now()
      stopAudio()
      clear(undefined, true)
      return 0
    }
    if (!ticker) startTicker()
    return remaining()
  }
  if (pausedRemaining > 0) return pausedRemaining

  const meta = storage.getMeta()
  const savedEnd = Number(meta.audioTimerEndAt) || 0
  const savedRemain = Number(meta.audioTimerPausedRemaining) || 0
  const savedTotal = Number(meta.audioTimerMinutes) || 0
  if (!savedEnd && !savedRemain) return 0

  // 到点优先：即使播放器 src 已被系统清空，也要把可能残留的后台会话停掉
  if (savedEnd && savedEnd <= Date.now()) {
    expiredAt = Date.now()
    stopAudio()
    clear(undefined, true)
    return 0
  }

  // 杀进程/冷启动/外部中断后 src 可能为空：不能调用 stopAudio()——
  // 那会把“外部中断导致 src 短暂为空”误判成用户主动停止
  // （audio.stop() + lastTrackActive=false → 首页/统计页迷你条消失、入睡页显示暂停）。
  if (!hasLiveAudio()) {
    // 本进程会话还活着（外部中断清空 src）时保留倒计时，等 audio-session 续播后继续，
    // 避免“续播成功但定时被清、从零重算/整夜不放”。
    if (audioSession.isSessionLive()) {
      if (savedRemain > 0) {
        pausedRemaining = savedRemain
        totalMinutes = savedTotal
        emit()
        return pausedRemaining
      }
      if (savedEnd) {
        endAt = savedEnd
        totalMinutes = savedTotal
        startTicker()
        emit()
        return remaining()
      }
    }
    clear(undefined, true)
    return 0
  }

  if (savedRemain > 0) {
    pausedRemaining = savedRemain
    totalMinutes = savedTotal
    emit()
    return pausedRemaining
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
  expiredAt = 0
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
  arm,
  restore,
  remaining,
  total,
  shouldStop,
  isPaused,
  lastExpiredAt,
  subscribe
}
