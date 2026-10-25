/**
 * 全局播放器状态标记。
 *
 * 只解决一个竞态：缓存文件播放失败时，audio-dock 会回退到远程 URL 并继续会话；
 * now-playing 和 audio-dock 都监听同一个 BackgroundAudioManager 的 onError，
 * 后者不能把这次“可恢复错误”当成终态去清 lastTrackActive。
 *
 * 该状态只在内存中，不持久化，也不参与业务数据。
 */
const FALLBACK_TTL_MS = 8000
// 同一轮 ended 只允许一个组件接管循环重播：audio-dock 与跨页 now-playing
// 都对同一个 BackgroundAudioManager 注册了 onEnded（BAM 不保证 offEnded 可用），
// 不去重会出现两次 src 赋值 + play()，表现为“重播又跳回开头”或“静默停住但 UI 仍在播放”。
const ENDED_CLAIM_MS = 800

// 曲末无缝回环：audio-dock 与 now-playing 对同一个 BackgroundAudioManager 都注册了
// onTimeUpdate，不去重会在同一轮各 seek 一次，表现为回环点“跳两下”。
const LOOP_CLAIM_MS = 1200

// 距曲末多少秒触发回环。2s 会每轮截掉约 1% 的尾部（3 分钟音源），
// 1.2s 仍留出前台 timeupdate（约 1s 一次）的余量，且后台由 armLoop 精确排程。
const DEFAULT_TAIL_SECONDS = 1.2

let fallbackUrl = ''
let fallbackAt = 0
let endedClaimAt = 0
let expiryToastAt = 0
let loopClaimAt = 0

/** 抢占本轮 ended 的处理权；窗口内只有一个调用方拿到 true */
function claimEnded() {
  const now = Date.now()
  if (now - endedClaimAt < ENDED_CLAIM_MS) return false
  endedClaimAt = now
  return true
}

/** 抢占本轮曲末回环的处理权；窗口内只有一个调用方拿到 true */
function claimLoop() {
  const now = Date.now()
  if (now - loopClaimAt < LOOP_CLAIM_MS) return false
  loopClaimAt = now
  return true
}

/**
 * 曲末前无缝回环：在音频自然结束前 seek 回开头，避免进入 ended 状态。
 *
 * 背景（2026-10-22 真机实测）：微信自带的悬浮音符图标跟随「同一次音频会话」——
 * 曲末 ended 后再重设 src，会被微信当成新音频，浮窗在曲末消失，且程序化续播
 * 不会让它重新出现（只有用户主动起播才会再出现）。让同一会话连续播下去
 * （不 ended、不换 src）浮窗就能一直挂着；这也顺带消掉回环点的静音间隙。
 *
 * 兜底：若基础库在后台节流 onTimeUpdate 导致错过窗口，仍由 onEnded → replay
 * 的老路径接手（音乐不断，但那一轮的微信浮窗会掉）。
 *
 * @param {object} audio BackgroundAudioManager 实例
 * @param {number} [tailSeconds] 距结尾多少秒内触发回环，默认 1.2 秒
 * @returns {boolean} 本轮是否已由本组件完成回环
 */
function seamlessLoop(audio, tailSeconds) {
  if (!audio || audio.paused) return false
  const duration = Number(audio.duration)
  const current = Number(audio.currentTime)
  if (!isFinite(duration) || duration <= 0) return false
  if (!isFinite(current) || current < 0) return false
  const tail = Number(tailSeconds) > 0 ? Number(tailSeconds) : DEFAULT_TAIL_SECONDS
  if (duration - current > tail) return false
  if (!claimLoop()) return false
  try {
    audio.seek(0)
    // 个别基础库 seek 会顺带暂停：确认仍在播放，避免回环点静默停住
    if (audio.paused) audio.play()
    return true
  } catch (e) {
    return false
  }
}

/* ---------------- 回环定时器 ---------------- */

let loopTimer = null
let loopTimerAt = 0

function clearLoopTimer() {
  if (loopTimer) {
    clearTimeout(loopTimer)
    loopTimer = null
    loopTimerAt = 0
  }
}

/**
 * 在“距曲末 tail 秒”预排一次回环，给后台/锁屏兜底。
 *
 * BackgroundAudioManager 没有 loop 属性，唯一官方做法是 ended 后重设 src；
 * 但 onTimeUpdate 官方口径是“只有小程序在前台时才回调”，锁屏后 seamlessLoop
 * 永远等不到窗口，而 ended 在后台又可能延迟/丢失 → 表现为“播完就停，没有循环”。
 * 这里把回环点换成一个 setTimeout：前台由 timeupdate 每秒校准，后台由定时器兜底。
 * timeupdate 与定时器同源（player-state 单例），不会出现两个定时器各 seek 一次。
 *
 * @param {object} audio BackgroundAudioManager 实例
 * @param {number} [tailSeconds] 距结尾多少秒内回环，默认 1.2 秒
 * @returns {boolean} 是否成功排上
 */
function armLoop(audio, tailSeconds) {
  if (!audio || audio.paused) return false
  const duration = Number(audio.duration)
  const current = Number(audio.currentTime)
  if (!isFinite(duration) || duration <= 0) return false
  if (!isFinite(current) || current < 0) return false
  const tail = Number(tailSeconds) > 0 ? Number(tailSeconds) : DEFAULT_TAIL_SECONDS
  const delay = (duration - current - tail) * 1000
  if (delay <= 0) return false
  const at = Date.now() + delay
  // timeupdate 每秒一次：目标时间没变就不要反复重建定时器
  if (loopTimer && Math.abs(loopTimerAt - at) < 500) return true
  clearLoopTimer()
  const timer = setTimeout(() => {
    loopTimer = null
    loopTimerAt = 0
    if (audio.paused) return
    const latestDuration = Number(audio.duration)
    const latestCurrent = Number(audio.currentTime)
    if (!isFinite(latestDuration) || latestDuration <= 0) return
    if (!isFinite(latestCurrent) || latestCurrent < 0) return
    // 定时器被系统节流提前唤醒：还没到回环点，按最新位置重排
    if (latestDuration - latestCurrent > tail + 0.5) {
      armLoop(audio, tail)
      return
    }
    if (!seamlessLoop(audio, tail + 0.5)) return
    // 回环后立刻排下一轮。个别基础库 seek(0) 后 currentTime 未同步刷新，
    // armLoop 会因 delay<=0 拒绝排队；锁屏后没有 timeupdate 补排，
    // 不补这一次就会出现“后台只回环一轮”。等一拍再试。
    if (armLoop(audio, tail)) return
    setTimeout(() => {
      if (!audio.paused) armLoop(audio, tail)
    }, 800)
  }, delay)
  if (timer && typeof timer.unref === 'function') timer.unref()
  loopTimer = timer
  loopTimerAt = at
  return true
}

function markFallback(url) {
  fallbackUrl = url || ''
  fallbackAt = Date.now()
}

function clearFallback() {
  fallbackUrl = ''
  fallbackAt = 0
}

function isFallbacking(url) {
  if (!fallbackUrl || Date.now() - fallbackAt > FALLBACK_TTL_MS) return false
  return !url || url === fallbackUrl
}

/**
 * 判断一条 onError 是否可能属于“当前这次播放源”。
 *
 * BackgroundAudioManager 的 onError 不带 src，切歌/缓存回退时旧源的错误可能在
 * 新源已经起播后到达。各组件在每次赋值 src 时记录 `_expectSrc`，事件到达时比对
 * 播放器上的真实 src：
 * - 两者都非空且不同 → 说明 src 已被更晚的一次赋值替换，这条错误属于旧源，忽略；
 * - 任一为空（基础库清空 src，或本进程尚未记录）→ 无法判定，按当前源处理（保守）。
 */
function isCurrentSourceError(eventSrc, expectedSrc) {
  if (!eventSrc || !expectedSrc) return true
  return eventSrc === expectedSrc
}

/** 定时到点提示在 dock 与 now-playing 间只允许一个弹出 */
function claimExpiryToast(windowMs) {
  const now = Date.now()
  const win = Number(windowMs) || 2000
  if (now - expiryToastAt < win) return false
  expiryToastAt = now
  return true
}

module.exports = {
  markFallback,
  clearFallback,
  isFallbacking,
  claimEnded,
  claimLoop,
  seamlessLoop,
  armLoop,
  clearLoopTimer,
  claimExpiryToast,
  isCurrentSourceError
}
