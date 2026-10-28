/**
 * 环境音会话状态机（App / audio-dock / now-playing 共用，跨页面单源）。
 *
 * 背景（真机反馈）：
 * - 来电、闹钟、微信语音、其他 App 抢占音频焦点时，微信只会把 BackgroundAudioManager
 *   置为暂停，**不会**在中断结束后自动续播；不注册 wx.onAudioInterruptionEnd 就永远停着。
 * - 外部中断/系统 stop 之后，原来的实现会把“没在播”当成“用户主动停止”，
 *   清掉 lastTrackActive → 计算器/统计页迷你条消失、入睡页回到暂停/空闲；
 *   而播放器本身可能还在出声，于是出现“音乐在播但条没了”。
 * - 曲末回环依赖 onTimeUpdate，官方口径是“只有小程序在前台时才回调”，
 *   锁屏/切后台后没有回环，只能等 onEnded（后台回调不可靠）。
 *
 * 本模块收口三件事：
 * 1) 会话归属口径：lastTrackActive 只允许由“显式终止”（用户停止 / 定时到点 /
 *    权益到期 / 清除数据）写成 false；系统中断、系统 stop、播放错误、src 被清空
 *    一律只改播放态，不动会话，保证迷你条不会因为外部原因被误隐藏。
 * 2) 播放意图 wantPlaying：只有“用户在小程序内主动暂停”才阻止自动恢复；
 *    外部原因造成的暂停在中断结束/回前台时自动续播（含重设 src 与曲末 seek）。
 * 3) 中断与前后台补偿：注册 wx.onAudioInterruptionBegin/End，配合 App.onHide/onShow
 *    处理“切到其他含音频的 App”这类没有 interruption 事件的场景。
 *
 * 该模块不持有任何 UI，事件仍由 audio-dock / now-playing 监听并回写本模块。
 */

const storage = require('./storage')
const cache = require('./audio-cache')
const player = require('./audio-player')
const playerState = require('./player-state')
const { getConfig } = require('./config')

// 自动恢复延迟：让 pageLifetimes.show / App.onShow 里的同步先落定，避免和组件抢 setData
const RESUME_DELAY_MS = 60
// 用户主动停止后，底层可能补发一条迟到的 play 事件：这个窗口内不复活会话
const STOP_GRACE_MS = 800
// 用户在小程序内暂停后，底层同样可能补发迟到的 play：这个窗口内不抹掉暂停意图
const PAUSE_GRACE_MS = 800
// 续播时判定“上一曲已经播完”的尾部容差（秒）
const END_EPSILON = 0.6
// 自动重播上限：极端坏源/极短源会在几秒内反复 ended，不能无限重建音源
const REPLAY_WINDOW_MS = 10000
const REPLAY_LIMIT = 8

let audio = null
let initialized = false
let interrupted = false
// 播放意图：true = 用户在播 / 中断前在播，中断结束后应继续
let wantPlaying = false
// 最后一次暂停是否由小程序内控件触发（只有这种暂停不允许自动恢复）
let userPaused = false
let userPausedAt = 0
let playingAtHide = false
let expectedSrc = ''
let stoppedAt = 0
let resumeTimer = null
let replayAt = 0
let replayCount = 0
// 中断可观测：由 App 注入上报函数（会话层不直接依赖事件队列）
let reporter = null
let interruptAt = 0

function appGlobal() {
  try {
    const app = getApp()
    return (app && app.globalData) || null
  } catch (e) {
    return null
  }
}

function setAppSession(on) {
  const globalData = appGlobal()
  if (globalData) globalData.audioSession = !!on
}

/** 注入轻量事件上报（app.js 接 events.track）；未注入时静默跳过 */
function setReporter(fn) {
  reporter = typeof fn === 'function' ? fn : null
}

function report(type, target) {
  if (!reporter) return
  try {
    reporter(type, target)
  } catch (e) {}
}

function getAudio() {
  // 实例统一由 audio-player 持有：本模块不再自己 getBackgroundAudioManager，
  // 否则又会多出一份“谁也说不清谁先拿到”的引用。
  audio = player.audio()
  return audio
}

function isActive() {
  const meta = storage.getMeta()
  return !!meta.lastTrackId && meta.lastTrackActive !== false
}

/**
 * 本进程内仍然存活的会话（用于区分“外部中断导致 src 暂空”与“冷启动残影”）：
 * lastTrackActive 只是持久化标记，进程重启后它可能还是 true；
 * 加上 globalData.audioSession（只在本次启动播放过时为 true）才是真活。
 */
function isSessionLive() {
  const globalData = appGlobal()
  return isActive() && !!(globalData && globalData.audioSession)
}

/** 与 audio-dock / now-playing 同一口径：解锁有效或后台配置为免费模式才允许起播 */
function canPlay() {
  const globalData = appGlobal()
  if (globalData && globalData.audioUnlockedSession) return true
  if (storage.getUnlockExpire() > Date.now()) return true
  const unlock = getConfig().unlock || {}
  return unlock.mode !== 'rewarded' || !unlock.adUnitId
}

function currentTrack() {
  const meta = storage.getMeta()
  if (!meta.lastTrackId) return null
  const list = getConfig().audio || []
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].id === meta.lastTrackId) return list[i]
  }
  return null
}

function cachedSrc(track) {
  const cfg = getConfig()
  const ttlDays = (cfg.cache && cfg.cache.ttlDays) || 7
  return cache.peek(track.url, ttlDays, track.url) || ''
}

/** 距曲末是否已经进入“播完”区间（中断期间自然播完，续播要回到开头） */
function atTrackEnd(target) {
  const duration = Number(target.duration)
  const current = Number(target.currentTime)
  if (!isFinite(duration) || duration <= 0) return false
  if (!isFinite(current) || current < 0) return false
  return current >= duration - END_EPSILON
}

function setExpectedSrc(url) {
  expectedSrc = url || ''
}

function getExpectedSrc() {
  return expectedSrc
}

function markPlayIntent(resetReplay) {
  userPaused = false
  userPausedAt = 0
  wantPlaying = true
  stoppedAt = 0
  // 只有“用户重新点播”才重新计时；自动回环不得清预算，否则坏源会以 1Hz 无限重建
  if (resetReplay) {
    replayAt = 0
    replayCount = 0
  }
  setAppSession(true)
  // 起播后由 onPlay/canplay 重新排回环定时器
  playerState.clearLoopTimer()
}

/** 小程序内主动播放/续播：清掉“用户暂停”标记，允许后续自动恢复 */
function markUserPlay() {
  markPlayIntent(true)
}

/**
 * 自动回环续播（ended / seamlessLoop 兜底路径）。
 * 与 markUserPlay 的唯一区别：不动 replayAt/replayCount，
 * 这样 10 秒内 8 次的上限才真正生效（AGENTS.md §5.6）。
 */
function markAutoReplay() {
  markPlayIntent(false)
}

/** 小程序内主动暂停：这是唯一不允许自动恢复的暂停来源 */
function markUserPause() {
  userPaused = true
  userPausedAt = Date.now()
  wantPlaying = false
  clearResumeTimer()
  // 暂停时不留回环定时器：否则恢复瞬间可能被旧定时器 seek
  playerState.clearLoopTimer()
}

/**
 * 显式终止会话：用户停止 / 定时到点 / 权益到期 / 清除数据。
 * 这是唯一允许把 lastTrackActive 写成 false 的入口（组件不再各自 patchMeta）。
 */
function markStopped() {
  userPaused = false
  userPausedAt = 0
  wantPlaying = false
  stoppedAt = Date.now()
  setAppSession(false)
  clearResumeTimer()
  playerState.clearLoopTimer()
  storage.patchMeta({ lastTrackActive: false, lastTrackPlaying: false })
}

/** 底层 play 事件：任何来源的起播都视为会话存活（系统通知栏续播也走这里） */
function onPlay() {
  // 停止后迟到的 play 事件不能复活会话（连播放意图也不能改，
  // 否则下一次回前台会被自动续播，表现为“点了停止又自己响”）
  if (stoppedAt && Date.now() - stoppedAt < STOP_GRACE_MS) return
  // 用户刚在小程序内点了暂停：底层可能补发一条迟到的 play，
  // 不能因此把“暂停意图”抹掉（真正的续播会先走 markUserPlay）。
  if (userPaused && userPausedAt && Date.now() - userPausedAt < PAUSE_GRACE_MS) return
  userPaused = false
  userPausedAt = 0
  wantPlaying = true
  setAppSession(true)
  const meta = storage.getMeta()
  if (meta.lastTrackId && meta.lastTrackActive === false) {
    storage.patchMeta({ lastTrackActive: true, lastTrackPlaying: true })
  }
}

/**
 * 底层 pause 事件。
 * 系统暂停（来电/其他 App/锁屏控件）不改变播放意图，留给中断结束或回前台续播；
 * 只有用户在小程序内暂停（markUserPause 已置标记）才清掉意图。
 *
 * 说明：锁屏/通知栏的暂停与系统中断在 API 上不可区分（都只有 pause，
 * 没有原因字段），产品口径统一按“外部中断可恢复”处理；小程序内的
 * 暂停/停止则一定不会被自动拉起。
 */
function onPause() {
  if (userPaused) wantPlaying = false
}

/**
 * 底层 stop 事件。
 * 系统 stop（微信浮窗 X、系统回收）是显式停止动作：不再自动续播，
 * 但保留会话让迷你条以“已暂停”继续显示（与运营确认过的口径一致）。
 *
 * 注意：不要在这里清 stoppedAt —— 用户主动停止的路径是先 markStopped()
 * 再 audio.stop()，stop 事件紧随其后；清掉宽限会让迟到的 play 重新复活会话。
 */
function onStop() {
  wantPlaying = false
}

/** 起播失败（play() 抛错）：不要自动反复重试，交给用户点击 */
function onPlayFailed() {
  wantPlaying = false
}

/**
 * 曲末自动重播的限流（只由抢到 claimEnded 的组件调用）。
 * 正常 3 分钟的音源每轮只增 1 次；坏源/极短源会在 10s 内打满，
 * 之后停在“已暂停”等用户手动重试，避免约 1Hz 的无限重建音源。
 */
function allowReplay() {
  const now = Date.now()
  if (now - replayAt > REPLAY_WINDOW_MS) {
    replayAt = now
    replayCount = 0
  }
  replayCount += 1
  return replayCount <= REPLAY_LIMIT
}

function clearResumeTimer() {
  if (resumeTimer) {
    clearTimeout(resumeTimer)
    resumeTimer = null
  }
}

function playCurrent(reason) {
  const target = getAudio()
  if (!target) return false
  if (!canPlay()) return false
  const track = currentTrack()
  if (!track || !track.url || track.url.indexOf('https://') !== 0) return false
  try {
    if (!target.src) {
      // 系统 stop 后 src 会被清空：直接 play() 无声，必须重建音源
      target.title = '睡点 · ' + track.title
      target.epname = '环境音'
      target.singer = '睡点'
      const src = cachedSrc(track) || track.url
      setExpectedSrc(src)
      target.src = src
    } else if (atTrackEnd(target)) {
      // 中断期间自然播完：先回到开头，否则 play() 会立刻再次 ended
      target.seek(0)
    }
    if (target.paused) target.play()
  } catch (e) {
    return false
  }
  wantPlaying = true
  userPaused = false
  userPausedAt = 0
  setAppSession(true)
  storage.patchMeta({ lastTrackActive: true, lastTrackPlaying: true })
  return true
}

/**
 * 外部中断结束 / 回到前台 / 配置就绪后尝试续播。
 * 只有“本来应该在播、且不是用户在小程序内暂停”才恢复。
 */
function resumeIfPossible(reason) {
  if (!initialized) init()
  if (interrupted || userPaused || !wantPlaying) return false
  if (!isActive()) return false
  if (!canPlay()) return false
  const target = getAudio()
  if (!target) return false
  if (!target.paused) return true
  clearResumeTimer()
  resumeTimer = setTimeout(() => {
    resumeTimer = null
    if (interrupted || userPaused || !wantPlaying || !isActive() || !canPlay()) return
    const latest = getAudio()
    if (!latest || !latest.paused) return
    playCurrent(reason)
  }, RESUME_DELAY_MS)
  return true
}

function onInterruptionBegin() {
  interrupted = true
  // 中断前在播：记下恢复意图。事件顺序由系统决定，这里以播放器真实状态为准，
  // 同时保留 wantPlaying（用户起播时已置 true），两者取或。
  if (audio && !audio.paused) wantPlaying = true
  // 运营指标：中断频次与“恢复到播”的比例。同一段中断只记一次 begin。
  if (!interruptAt) {
    interruptAt = Date.now()
    const meta = storage.getMeta()
    report('audio_interrupt', 'begin|' + (meta.lastTrackId || 'unknown'))
  }
}

function onInterruptionEnd() {
  interrupted = false
  const startedAt = interruptAt
  interruptAt = 0
  const resumed = resumeIfPossible('interruption-end')
  // end 里带持续时间与恢复结果，后台可算“平均中断时长 / 恢复成功率”
  if (startedAt) {
    const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000))
    report('audio_interrupt', 'end|' + seconds + 's|' + (resumed ? 'resume' : 'skip'))
  }
}

/** App.onHide：记录离开小程序时是否在播，回前台据此判断是否被外部打断 */
function onAppHide() {
  // 刚执行过显式终止（用户停止/定时到点）：stop() 可能还没生效，
  // 不能因为“播放器暂时还在出声”就把播放意图重新打开。
  if (stoppedAt && Date.now() - stoppedAt < STOP_GRACE_MS) {
    playingAtHide = false
    wantPlaying = false
    return
  }
  if (!isActive()) {
    playingAtHide = false
    return
  }
  playingAtHide = !!(audio && !audio.paused)
  if (playingAtHide) wantPlaying = true
}

/** App.onShow：切到其他含音频的 App 不会触发 interruption 事件，只能靠这里补偿 */
function onAppShow() {
  const target = getAudio()
  const wasPlaying = playingAtHide
  playingAtHide = false
  if (target && !target.paused) {
    wantPlaying = true
    return
  }
  if (!wantPlaying && !wasPlaying) return
  wantPlaying = true
  resumeIfPossible('app-show')
}

/** 配置异步到达后补一次续播：首屏可能是内置兜底配置，找不到上次的曲目 */
function onConfigReady() {
  if (!wantPlaying) return
  const target = getAudio()
  if (target && !target.paused) return
  resumeIfPossible('config-ready')
}

/** 幂等初始化；只在 App.onLaunch 调一次（监听是全局的，重复注册会叠加回调） */
function init() {
  if (initialized) return
  initialized = true
  getAudio()
  if (typeof wx === 'undefined') return
  if (typeof wx.onAudioInterruptionBegin === 'function') {
    try {
      wx.onAudioInterruptionBegin(onInterruptionBegin)
    } catch (e) {}
  }
  if (typeof wx.onAudioInterruptionEnd === 'function') {
    try {
      wx.onAudioInterruptionEnd(onInterruptionEnd)
    } catch (e) {}
  }
}

/** 仅供单测：清空模块内存态（不清理 storage） */
// 回环预算注入：seamlessLoop（前台 timeupdate + 后台 armLoop）与 ended 共用同一窗口，
// 否则 duration 略大于回环 tail 的坏源能靠 seek(0) 永久绕过 8 次上限。
playerState.setLoopGuard(allowReplay)

function _resetForTest() {
  clearResumeTimer()
  audio = null
  // 实例缓存现在归 audio-player 管：不一起清掉，下一个用例仍会拿到上一轮
  // 的假播放器，表现为“续播没发生”。
  player._resetForTest()
  initialized = false
  interrupted = false
  wantPlaying = false
  userPaused = false
  userPausedAt = 0
  playingAtHide = false
  expectedSrc = ''
  stoppedAt = 0
  replayAt = 0
  replayCount = 0
  interruptAt = 0
  reporter = null
}

module.exports = {
  init,
  setReporter,
  isActive,
  isSessionLive,
  isInterrupted: () => interrupted,
  isUserPaused: () => userPaused,
  wantsPlayback: () => wantPlaying,
  canPlay,
  markUserPlay,
  markAutoReplay,
  markUserPause,
  markStopped,
  onPlay,
  onPause,
  onStop,
  onPlayFailed,
  allowReplay,
  resumeIfPossible,
  onInterruptionBegin,
  onInterruptionEnd,
  onAppHide,
  onAppShow,
  onConfigReady,
  setExpectedSrc,
  getExpectedSrc,
  currentTrack,
  _resetForTest
}
