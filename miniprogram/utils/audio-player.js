/**
 * 环境音播放器 —— BackgroundAudioManager 的唯一 owner。
 *
 * 为什么要有它（2026-10-28 架构收口）：
 * 一个播放器之前被两个组件各注册了一套监听（play/pause/waiting/canplay/timeupdate/
 * stop/ended/error），两边各写一遍“起播/暂停/曲末推进/缓存回退/停止宽限”，
 * 再用 claimEnded/claimLoop/claimExpiryToast 三个时间窗互相让路。
 *
 * 本模块现在持有：实例、事件注册、播放状态（playing/loading/当前曲目）、起播兜底、
 * 定时偏好、曲末推进、缓存回退、错误归属。对外只暴露动词与只读 snapshot；
 * audio-dock 已退化为订阅 snapshot 的视图（now-playing 的迁移是下一步）。
 *
 * 刻意保留的协调（同一模块内仍有两个入口，不是两个组件）：
 * - playerState.claimLoop：一次回环可能由 timeupdate 与 armLoop 定时器同时到达。
 * - playerState.claimEnded：部分基础库会重复派发 ended；且 now-playing 仍并行监听。
 * 定时到点的提示改由本模块统一发一次 notice('timer_stop')；dock 自己的 audioTimer
 * 订阅只负责复位 UI（currentId/胶囊），不再单独弹 toast。
 *
 * 不负责：解锁广告、搜索/收藏/分类、抽屉与迷你条的展开态、定时档位的 UI。
 */

const storage = require('./storage')
const cache = require('./audio-cache')
const playerState = require('./player-state')
// audio-timer 依赖 audio-session，而 audio-session 又 require 本模块：顶层 require 会形成
// 循环依赖（先加载的一方拿到空对象）。定时器改为调用点解析。
function timer() {
  return require('./audio-timer')
}
const { resolvePlayerSurface } = require('./player-surface')
const { nextInQueue, nextTrackManual, prevTrackManual, normalizeQueueMode, resolveQueueIds } = require('./player-queue')
const { getConfig } = require('./config')

// audio-session 也 require 本模块（取实例）；互相 require 时不能在模块顶层取它的导出，
// 否则先加载的一方会拿到空对象。这里在调用点解析。
function session() {
  return require('./audio-session')
}

const SRC_SETTLE_MS = 1500
const DEFAULT_TTL_DAYS = 7
const TOGGLE_GUARD_MS = 220
const LOADING_GUARD_MS = 12000
const BUFFERING_WINDOW_MS = 30000
const PAUSE_RETRY_MS = 3000
const PAUSE_RETRY_LIMIT = 2
const WAIT_RETRY_MS = 4000
const ENTITLEMENT_CHECK_MS = 15000
const ERROR_TRACK_DEDUPE_MS = 1000
const TIMER_JUST_EXPIRED_MS = 2000

let manager = null
let expectedSrc = ''
let expectedAt = 0
let initialized = false
let toggleAt = 0
let lastErrorAt = 0
let entitlementAt = 0
let recovering = false

const state = {
  playing: false,
  loading: false,
  currentId: '',
  currentTitle: '',
  currentCategory: '',
  fromCache: false,
  stopRequested: false,
  timerMinutes: 0,
  waitingAt: 0,
  pauseRetry: 0
}

let loadingTimer = null
let waitRetryTimer = null
let pauseRetryTimer = null
// 自动缓存定时器：所有起播入口（点播/自动连播/下一首/继续上次）共用一份，
// 切歌或停止时必须清掉，否则会把上一首在后台下完（白耗流量）。
let autoCacheTimer = null
let lastNetType = ''
let listeners = []
let notices = []

/* ---------------- 实例 ---------------- */

/** 全局唯一的 BackgroundAudioManager（取不到时为 null，调用方需自行降级） */
function audio() {
  if (manager) return manager
  if (typeof wx === 'undefined' || !wx.getBackgroundAudioManager) return null
  try {
    manager = wx.getBackgroundAudioManager()
  } catch (e) {
    manager = null
  }
  return manager
}

/** 仅供单测/组件注入：不传参数时返回当前实例 */
function setManager(next) {
  manager = next || null
  return manager
}

/* ---------------- 配置与曲目 ---------------- */

function ttlDays() {
  const cfg = getConfig() || {}
  return (cfg.cache && cfg.cache.ttlDays) || DEFAULT_TTL_DAYS
}

/* ---------------- 自动缓存 ---------------- */

function clearAutoCacheTimer() {
  if (autoCacheTimer) {
    clearTimeout(autoCacheTimer)
    autoCacheTimer = null
  }
}

/**
 * 起播后的自动缓存：所有入口共用（抽屉点播、列表循环自动切歌、迷你条下一首、继续上次）。
 * 小程序无法复用 BackgroundAudioManager 的流缓存，所以首次会与流式播放并行
 * （约多耗 1 倍流量），换来之后每次播放都走本地；Wi-Fi 8s、移动网络 20s 后才开始，
 * 避免“点开听两秒”也下整首。
 */
function scheduleAutoCache(track) {
  clearAutoCacheTimer()
  if (!track || !track.id || !playableUrl(track)) return
  if (!audio()) return
  const url = track.url
  const trackId = track.id
  if (cache.peek(url, ttlDays(), url)) return
  const arm = (netType) => {
    // 取网络类型期间可能已经切歌/停止：只给“仍在播的这一首”排队
    if (state.currentId !== trackId || state.stopRequested) return
    if (netType === 'none') return
    clearAutoCacheTimer()
    autoCacheTimer = setTimeout(() => {
      autoCacheTimer = null
      // 定时期间切歌/停止：不再下载旧曲（旧实现会把上一首下完，白耗流量）
      if (state.currentId !== trackId || state.stopRequested) return
      const cfg = getConfig() || {}
      // 容量上限此前只靠每天一次 maybePrune 收敛；自动缓存不能把占用推过 maxMB
      if (!cache.canAutoCache(cfg.cache)) return
      cache.ensure(url, null, ttlDays()).catch(() => {})
    }, cache.autoCacheDelay(netType))
  }
  if (typeof wx === 'undefined' || !wx.getNetworkType) {
    arm(lastNetType)
    return
  }
  wx.getNetworkType({
    success: (res) => {
      lastNetType = (res && res.networkType) || ''
      arm(lastNetType)
    },
    fail: () => arm(lastNetType)
  })
}

function trackOf(trackId) {
  const id = String(trackId || '')
  if (!id) return null
  const list = (getConfig() || {}).audio || []
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] && list[i].id === id) return list[i]
  }
  return null
}

/** 只接受 https 源：非 https 会让 BAM 静默失败，形成看不到原因的 onError 循环 */
function playableUrl(track) {
  if (!track || !track.url || track.url.indexOf('https://') !== 0) return ''
  return track.url
}

function timerEnabled() {
  const cfg = getConfig() || {}
  return !cfg.features || cfg.features.timer !== false
}

function sessionLive() {
  try {
    const app = getApp()
    return !!(app && app.globalData && app.globalData.audioSession)
  } catch (e) {
    return false
  }
}

/* ---------------- 期望源 ---------------- */

function setExpectedSrc(url) {
  expectedSrc = url || ''
  expectedAt = Date.now()
}

function expected() {
  return expectedSrc
}

function srcAge(now) {
  if (!expectedAt) return Infinity
  return Math.max(0, (now || Date.now()) - expectedAt)
}

/**
 * 缓冲窗口：BAM 缓冲时会自动 pause，这与用户主动暂停不是一回事。
 * 统一由本模块判定，两个视图（audio-dock / now-playing）不得各自推算。
 */
function isBuffering() {
  return !!state.waitingAt && Date.now() - state.waitingAt < BUFFERING_WINDOW_MS
}

/* ---------------- 对外状态 ---------------- */

function snapshot() {
  return {
    playing: state.playing,
    loading: state.loading,
    currentId: state.currentId,
    currentTitle: state.currentTitle,
    currentCategory: state.currentCategory,
    fromCache: state.fromCache,
    stopRequested: state.stopRequested
  }
}

function broadcast() {
  const view = snapshot()
  listeners.slice().forEach((fn) => {
    try {
      fn(view)
    } catch (e) {}
  })
}

/** 只有真的变了才广播，避免 timeupdate 每秒刷视图 */
function patch(next) {
  let changed = false
  Object.keys(next).forEach((key) => {
    if (state[key] !== next[key]) {
      state[key] = next[key]
      changed = true
    }
  })
  if (changed) broadcast()
}

function subscribe(fn) {
  if (typeof fn !== 'function') return function noop() {}
  // 订阅前先按磁盘上的 meta 补一次状态：用户可能在首页/统计页先播了歌
  // （那边由 now-playing 处理事件），再进入入睡页才第一次 init 本模块。
  if (!state.currentId) hydrate()
  if (listeners.indexOf(fn) < 0) listeners.push(fn)
  fn(snapshot())
  return function unsubscribe() {
    listeners = listeners.filter((item) => item !== fn)
  }
}

/**
 * 从 meta + 播放器真实状态补一次内存态。
 * 本模块的事件监听只有在第一个组件 init 之后才存在；在此之前发生的播放/暂停
 * 只留在 meta 与 BAM 上，所以首次 init / 新订阅都要补这一次。
 */
function hydrate() {
  const meta = storage.getMeta()
  const a = audio()
  const live = !!(a && a.src && a.paused === false)
  patch({
    currentId: meta.lastTrackId || '',
    currentTitle: meta.lastTrackTitle || '',
    currentCategory: meta.lastTrackCategory || '',
    playing: live,
    loading: false
  })
}

function setNotice(fn) {
  if (typeof fn !== 'function') return
  if (notices.indexOf(fn) < 0) notices.push(fn)
}

function notice(code, extra) {
  notices.slice().forEach((fn) => {
    try {
      fn(code, extra || {})
    } catch (e) {}
  })
}

/* ---------------- 可见性 ---------------- */

/**
 * 读一次真实播放状态，交给视图决定“显示什么”。
 * 返回 { surface, meta, coldPatch }；coldPatch 非空时必须写入（只归零播放态），
 * **不得**改成 markStopped()——那会让用户重进小程序时迷你条消失。
 */
function surfaceOf(options) {
  const opts = options || {}
  const a = opts.audio !== undefined ? opts.audio : audio()
  const meta = storage.getMeta()
  const hasSrc = !!(a && a.src)
  const surface = resolvePlayerSurface({
    lastTrackId: meta.lastTrackId,
    lastTrackActive: meta.lastTrackActive,
    lastTrackPlaying: meta.lastTrackPlaying,
    hasSrc,
    playingNow: hasSrc && a.paused === false,
    sessionLive: sessionLive()
  })
  const coldPatch = surface.cold && meta.lastTrackPlaying !== false ? { lastTrackPlaying: false } : null
  return { surface, meta, coldPatch }
}

/* ---------------- 音源 ---------------- */

/**
 * 设置音源：标题三元组 + 缓存优先 + 记录期望源与赋值时刻。
 * 用户点播 / 自动回环 / 错误回退 / 重建续播都必须走这里，
 * 否则 onError 无从判断“这条错误是不是已经切走的旧源”。
 */
function attach(track, options) {
  const opts = options || {}
  const a = opts.audio !== undefined ? opts.audio : audio()
  const remote = playableUrl(track)
  if (!a || !remote) return null
  const cached =
    opts.cached !== undefined ? opts.cached || '' : cache.peek(remote, ttlDays(), remote) || ''
  a.title = '睡点 · ' + track.title
  a.epname = '环境音'
  a.singer = '睡点'
  const url = cached || remote
  a.src = url
  setExpectedSrc(url)
  return { url, fromCache: !!cached }
}

/** 按 lastTrackId 重建音源（系统 stop 会清空 src；续播前必须重建） */
function rebuild(trackId, options) {
  const meta = storage.getMeta()
  const track = trackOf(trackId || meta.lastTrackId)
  if (!track) return null
  return attach(track, options)
}

/* ---------------- 错误归属 ---------------- */

/**
 * 一条 onError 该怎么处理：
 * - ignore / playing / too_soon / fallback / terminal
 */
function errorPlan(options) {
  const opts = options || {}
  const a = opts.audio !== undefined ? opts.audio : audio()
  const now = opts.now || Date.now()
  const expectedNow = opts.expected !== undefined ? opts.expected : expectedSrc
  if (!expectedNow) return { action: 'ignore', reason: 'no_expected' }
  if (!playerState.isCurrentSourceError(a && a.src, expectedNow)) {
    return { action: 'ignore', reason: 'stale_source' }
  }
  const hasSrc = !!(a && a.src)
  if (hasSrc && a.paused === false) return { action: 'playing' }
  if (srcAge(now) < SRC_SETTLE_MS) return { action: 'too_soon' }
  const track = opts.track || trackOf(storage.getMeta().lastTrackId)
  if (opts.fromCache && track && playableUrl(track)) {
    return { action: 'fallback', badUrl: track.url, track }
  }
  return { action: 'terminal', track }
}

/**
 * 把一条源标记为坏源：磁盘文件确实不可用才删，但本会话一律拉黑。
 * 删文件的判据必须分开——网络/解码错误时文件是好的，删了会误伤健康缓存
 * （切歌竞态下还可能删到正在读的在播文件）。
 */
function markBadSource(url) {
  if (!url) return false
  if (!cache.isUsable(url)) cache.remove(url)
  cache.markBad(url)
  return true
}

/* ---------------- 起播兜底 ---------------- */

function disarmLoadingGuard() {
  if (loadingTimer) {
    clearTimeout(loadingTimer)
    loadingTimer = null
  }
}

/**
 * 起播兜底：弱网/坏源时 BAM 可能既不给 play 也不给 error，
 * 没有这个定时器“正在连接音频…”会永久挂着，也没有重试出口。
 */
function armLoadingGuard() {
  disarmLoadingGuard()
  loadingTimer = setTimeout(() => {
    loadingTimer = null
    const a = audio()
    if (!state.loading) return
    if (a && a.src && a.paused === false) {
      patch({ playing: true, loading: false })
      return
    }
    patch({ playing: false, loading: false })
    storage.patchMeta({ lastTrackPlaying: false })
    session().onPlayFailed()
    try {
      if (a) a.pause()
    } catch (e) {}
    notice('load_timeout')
  }, LOADING_GUARD_MS)
  if (loadingTimer && typeof loadingTimer.unref === 'function') loadingTimer.unref()
}

function clearRetryTimers() {
  if (waitRetryTimer) {
    clearTimeout(waitRetryTimer)
    waitRetryTimer = null
  }
  if (pauseRetryTimer) {
    clearTimeout(pauseRetryTimer)
    pauseRetryTimer = null
  }
}

/* ---------------- 定时偏好 ---------------- */

/** 定时档位由视图写入（0 = 关）；只有 >0 才起表 */
function setTimerMinutes(minutes) {
  state.timerMinutes = Number(minutes) || 0
}

function applyTimerPreference() {
  if (!timerEnabled()) return
  const value = Number(state.timerMinutes) || 0
  if (value > 0) timer().arm(value)
  else timer().clear()
}

/* ---------------- 命令 ---------------- */

function safePlay() {
  const a = audio()
  if (!a) return false
  try {
    a.play()
    return true
  } catch (e) {
    disarmLoadingGuard()
    patch({ playing: false, loading: false })
    storage.patchMeta({ lastTrackPlaying: false })
    session().onPlayFailed()
    notice('play_failed')
    return false
  }
}

/**
 * 起播：校验源 → 清停止意图 → 清黑名单 → 缓存优先 → 写 meta → 赋 src → play → 起表。
 * @returns {boolean} 是否已发起起播
 */
function play(track, options) {
  const opts = options || {}
  const a = audio()
  if (!playableUrl(track)) {
    notice('bad_url')
    return false
  }
  if (!a) {
    notice('unsupported')
    return false
  }
  if (!session().canPlay()) {
    stop()
    notice('expired')
    return false
  }
  clearRetryTimers()
  // 切歌即停掉上一首还没下完的缓存：后台两条连接抢带宽会把新曲起播拖成“播几秒暂停”
  const prevTrack = trackOf(state.currentId)
  if (prevTrack && prevTrack.id !== track.id && prevTrack.url) cache.cancel(prevTrack.url)
  state.stopRequested = false
  state.waitingAt = 0
  state.pauseRetry = 0
  playerState.clearFallback()
  patch({
    currentId: track.id,
    currentTitle: track.title,
    currentCategory: track.category || '',
    playing: true,
    loading: true
  })
  // 用户主动点播即视为重试：先解黑名单再取缓存，否则上一轮失败拉黑后会一直走远程
  cache.clearBad(track.url)
  const attached = attach(track, { cached: opts.cached })
  state.fromCache = !!(attached && attached.fromCache)
  armLoadingGuard()
  // 用户主动点播：允许后续中断自动恢复，并重置 10s/8 次的重播预算。
  // 自动连播（列表循环切歌）不能走这条——它是自动重建音源，必须保留预算，
  // 否则极短音源队列会绕过熔断无限重建（AGENTS.md §5.6）。
  if (opts.auto) session().markAutoReplay()
  else session().markUserPlay()
  const saved = storage.patchMeta({
    lastTrackId: track.id,
    lastTrackTitle: track.title,
    lastTrackCategory: track.category || '',
    lastTrackActive: true,
    lastTrackPlaying: true
  })
  if (!saved) notice('meta_save_failed')
  safePlay()
  applyTimerPreference()
  // 起播埋点：与解锁/中断同一套事件队列（后台「今日播放」用）
  const events = require('./events')
  if (events && events.track) events.track('audio_play', track.id)
  // 起播即排队缓存：自动连播/迷你条下一首也走这里，缓存覆盖不再只限手动点播
  scheduleAutoCache(track)
  return true
}

function pause() {
  const a = audio()
  if (!a) return false
  session().markUserPause()
  storage.patchMeta({ lastTrackPlaying: false })
  try {
    a.pause()
  } catch (e) {}
  timer().pause()
  patch({ playing: false })
  return true
}

/** 小程序内续播：系统 stop 后 src 会被清空，先按 currentId 重建 */
function resume() {
  const a = audio()
  if (!a) return false
  if (!state.currentId) return false
  if (!session().canPlay()) {
    stop()
    notice('expired')
    return false
  }
  const track = trackOf(state.currentId)
  if (!track) {
    stop()
    return false
  }
  if (!a.src) {
    const attached = attach(track)
    state.fromCache = !!(attached && attached.fromCache)
  }
  armLoadingGuard()
  patch({ playing: true })
  session().markUserPlay()
  storage.patchMeta({ lastTrackPlaying: true })
  applyTimerPreference()
  safePlay()
  // 续播也是起播入口：未缓存的曲目同样要排自动缓存
  scheduleAutoCache(track)
  return true
}

/**
 * 迷你条/抽屉的播放暂停切换（含 220ms 防抖，睡前连点不该来回抖）。
 * @returns {'played'|'paused'|'noop'|'blocked'}
 */
function toggle() {
  const now = Date.now()
  if (now - toggleAt < TOGGLE_GUARD_MS) return 'noop'
  toggleAt = now
  const a = audio()
  if (!a || !state.currentId) return 'noop'
  // 以 BAM 的真实 paused 为准：页面隐藏期间系统侧暂停时 state.playing 可能滞后
  if (a.src && a.paused === false) {
    pause()
    return 'paused'
  }
  if (!session().canPlay()) {
    stop()
    notice('expired')
    return 'blocked'
  }
  resume()
  return 'played'
}

/**
 * 显式终止会话（用户停止 / 清除数据）。这是唯一允许把 lastTrackActive 写 false 的路径。
 */
function stop() {
  state.stopRequested = true
  state.waitingAt = 0
  state.pauseRetry = 0
  state.fromCache = false
  clearRetryTimers()
  // 主动停止后不再启动新的后台缓存；已开始的下载保留（下次可命中）
  clearAutoCacheTimer()
  disarmLoadingGuard()
  // 停止本次播放即结束这一段会话：定时偏好回到“关”，下次播放需明确重新选择。
  // 只清 audioTimer 不够——起播时按 state.timerMinutes 重新起表，漏清会让用户
  // “停止/到点后再点一首”时静默又跑一遍上一轮的定时。
  state.timerMinutes = 0
  timer().clear(undefined, true)
  session().markStopped()
  const a = audio()
  if (a) {
    try {
      a.stop()
    } catch (e) {}
  }
  patch({ currentId: '', currentTitle: '', currentCategory: '', playing: false, loading: false })
}

// 列表循环在曲末前多少秒换下一首：必须早于 ended，否则重设 src 会丢微信浮窗
const LIST_TAIL_SECONDS = 0.8

function queueMode() {
  return normalizeQueueMode(storage.getMeta().audioQueueMode)
}

/** 到点窗口：timeupdate 每秒一次，容差与无缝回环同口径（tail + 0.5s） */
function nearTail(a, tail) {
  if (!a) return false
  const duration = Number(a.duration)
  const current = Number(a.currentTime)
  if (!isFinite(duration) || duration <= 0) return false
  if (!isFinite(current) || current < 0) return false
  return duration - current <= tail + 0.5
}

/**
 * 曲末动作（列表循环）：在 ended 之前换成队列快照里的下一首。
 * 返回 true = 已接管（调用方不要再 seek 回环）；false = 仍按单曲循环处理。
 * 队列不足 2 首 / 取不到下一首时回退单曲，不会停播。
 */
function tailTick(a) {
  if (!a || queueMode() !== 'list') return false
  if (!nearTail(a, LIST_TAIL_SECONDS)) return false
  // 用户已在小程序内暂停/停止：排队中的 timeupdate 不得把下一首切出来
  if (!session().canAutoStart()) return true
  const meta = storage.getMeta()
  const list = (getConfig() || {}).audio || []
  const next = nextInQueue(
    list,
    state.currentId || meta.lastTrackId,
    resolveQueueIds(list, meta.audioQueueIds)
  )
  // 没有下一首：不消耗本轮 claim，交给 seamlessLoop 原样回环
  if (!next) return false
  // 同一轮曲末可能被 timeupdate 与 armLoop 定时器同时命中：只有一个能换曲
  if (!playerState.claimLoop()) return true
  // 自动切歌同样是重建音源：极短音源队列必须受 10s/8 次熔断约束（AGENTS.md §5.6）。
  // 超限时本轮既不切也不 seek，让音频自然走到 ended，由 ended 的既有熔断停下并提示。
  if (!session().allowReplay()) return true
  play(next, { auto: true })
  return true
}

/**
 * 列表循环的曲末回调必须是**稳定引用**：armLoop 靠它判断“要不要重建定时器”，
 * 每次 timeupdate 现造一个箭头函数会让定时器每秒重建一次。
 */
function handleListTail() {
  return tailTick(audio())
}

/** 按播放模式排曲末动作：单曲=无缝回环；列表=到点前换下一首 */
function armTail(a) {
  if (!a) return false
  if (queueMode() !== 'list') return playerState.armLoop(a)
  return playerState.armLoop(a, LIST_TAIL_SECONDS, handleListTail)
}

/**
 * 播放模式刚被切换：立即按新模式重排曲末定时器。
 * 不能只等下一次 timeupdate —— 锁屏后没有 timeupdate，旧定时器会按旧模式到点。
 */
function refreshTail() {
  playerState.clearLoopTimer()
  return armTail(audio())
}

/**
 * 曲末推进（ended 兜底）：单曲重播；列表循环取队列快照的下一首。
 * 正常路径下 tailTick 已在 ended 之前换曲，这里只兜住“没赶上”的情况。
 */
function advance() {
  // 用户已在小程序内暂停/停止：迟到的 ended 不得把播放拉起来（铁律 §5.5）。
  // 这一条同时覆盖 audio-dock 与 now-playing 两个 ended 监听方。
  if (!session().canAutoStart()) return ''
  const meta = storage.getMeta()
  if (queueMode() !== 'list') return replay() ? 'replay' : ''
  const list = (getConfig() || {}).audio || []
  const next = nextInQueue(
    list,
    state.currentId || meta.lastTrackId,
    resolveQueueIds(list, meta.audioQueueIds)
  )
  if (next) {
    play(next, { auto: true })
    return 'next'
  }
  return replay() ? 'replay' : ''
}

/** 回环续播：重新确认会话存活，按 currentId 重建音源（自动续播不清回环预算） */
function replay() {
  if (state.stopRequested || !state.currentId || !session().isActive()) return false
  if (!session().canPlay()) {
    stop()
    notice('expired')
    return false
  }
  const track = trackOf(state.currentId)
  if (!track) return false
  const attached = attach(track)
  state.fromCache = !!(attached && attached.fromCache)
  patch({ playing: true, loading: true })
  armLoadingGuard()
  // markAutoReplay：自动续播不能清空回环限流预算（否则 8 次上限永远打不满）
  session().markAutoReplay()
  storage.patchMeta({ lastTrackActive: true, lastTrackPlaying: true })
  safePlay()
  return true
}

/** 手动下一首：列表循环在队列快照里前进，其余按配置列表循环 */
function next() {
  const meta = storage.getMeta()
  const list = (getConfig() || {}).audio || []
  const track = nextTrackManual(
    list,
    state.currentId || meta.lastTrackId,
    resolveQueueIds(list, meta.audioQueueIds),
    meta.audioQueueMode
  )
  if (!track) {
    notice('only_one_track')
    return false
  }
  return play(track)
}

/**
 * 上一首：锁屏 / 耳机线控的“上一首”与手动下一首同一套队列口径。
 * 与 next() 对称——单曲模式也会在配置列表里向前切，避免线控按键看起来失灵。
 */
function prev() {
  const meta = storage.getMeta()
  const list = (getConfig() || {}).audio || []
  const track = prevTrackManual(
    list,
    state.currentId || meta.lastTrackId,
    resolveQueueIds(list, meta.audioQueueIds),
    meta.audioQueueMode
  )
  if (!track) {
    notice('only_one_track')
    return false
  }
  return play(track)
}

/* ---------------- 事件 ---------------- */

function handlePlay() {
  if (!session().canPlay()) {
    try {
      const a = audio()
      if (a) a.pause()
    } catch (e) {}
    storage.patchMeta({ lastTrackPlaying: false })
    patch({ playing: false, loading: false })
    notice('expired')
    return
  }
  disarmLoadingGuard()
  state.waitingAt = 0
  state.pauseRetry = 0
  clearRetryTimers()
  playerState.clearFallback()
  // 任何来源的起播都算会话存活（含系统通知栏/锁屏续播）
  session().onPlay()
  storage.patchMeta({ lastTrackPlaying: true })
  patch({ playing: true, loading: false })
  // 系统侧恢复与首次起播都走这里：暂停事件已冻结倒计时，这里续剩余
  applyTimerPreference()
  armTail(audio())
}

function handlePause() {
  // BAM 缓冲时会自动 pause：这不是用户暂停，不能冻结定时、也不能收成“已暂停”条
  const buffering = isBuffering()
  const userPaused = session().isUserPaused()
  disarmLoadingGuard()
  // 缓冲期内且不是用户暂停：保持“连接中”，3s 后补一次 play（最多 2 次）
  const retry =
    buffering && !userPaused && !state.stopRequested && !!state.currentId && state.pauseRetry < PAUSE_RETRY_LIMIT
  if (retry) {
    state.pauseRetry += 1
    patch({ playing: false, loading: true })
    armLoadingGuard()
    if (pauseRetryTimer) clearTimeout(pauseRetryTimer)
    pauseRetryTimer = setTimeout(() => {
      pauseRetryTimer = null
      if (state.stopRequested) return
      // 3 秒窗口内用户可能已经点了暂停/停止：自动重试不得把播放拉起来
      if (!session().canAutoStart()) return
      const a = audio()
      if (a && a.src && a.paused === false) return
      safePlay()
    }, PAUSE_RETRY_MS)
    if (pauseRetryTimer && typeof pauseRetryTimer.unref === 'function') pauseRetryTimer.unref()
    return
  }
  // 走到这里说明不是“缓冲中自动重试”（用户已暂停 / 无当前曲目 / 重试已耗尽）：
  // 冻结倒计时并收成“已暂停”。不能继续显示“正在连接”，否则用户点了暂停还会看到
  // 连接态，并在 12s 后收到一条“连接超时”的假提示。
  timer().pause()
  // 只有用户在小程序内暂停才阻止自动恢复；来电/其他 App 造成的暂停留给会话层续播
  session().onPause()
  storage.patchMeta({ lastTrackPlaying: false })
  patch({ playing: false, loading: false })
}

function handleWaiting() {
  if (state.stopRequested) return
  // 加载中（弱网/首次播放）：只进“连接中”，不要把 playing 置 false
  state.waitingAt = Date.now()
  patch({ loading: true })
  armLoadingGuard()
  if (waitRetryTimer) clearTimeout(waitRetryTimer)
  waitRetryTimer = setTimeout(() => {
    waitRetryTimer = null
    if (state.stopRequested) return
    const a = audio()
    if (!a || !state.currentId) return
    if (a.src && a.paused === false) {
      patch({ playing: true, loading: false })
      return
    }
    // 缓冲的这 4 秒里用户可能点了暂停/停止：自动重试不得把播放拉起来
    if (!session().canAutoStart()) return
    // 个别基础库缓冲结束后不自动续播：补一次 play
    safePlay()
  }, WAIT_RETRY_MS)
  if (waitRetryTimer && typeof waitRetryTimer.unref === 'function') waitRetryTimer.unref()
}

function handleCanplay() {
  disarmLoadingGuard()
  const a = audio()
  const live = !!(a && a.src && a.paused === false)
  if (state.loading || (live && !state.playing)) {
    patch({ loading: false, playing: live || state.playing })
  }
  armTail(a)
}

function handleTimeUpdate() {
  if (state.stopRequested) return
  const a = audio()
  if (!a) return
  // play 事件早到/丢失时，按真实出声状态自愈
  if (!state.playing && a.src && a.paused === false) {
    patch({ playing: true, loading: false })
    storage.patchMeta({ lastTrackPlaying: true })
  }
  // 无缝回环绕过 ended，而 60s 的到期巡检只在页面可见时跑；低频复检一次权益
  const now = Date.now()
  if (now - entitlementAt > ENTITLEMENT_CHECK_MS) {
    entitlementAt = now
    if (state.currentId && !session().canPlay()) {
      stop()
      // 从“配置没拉到”的免费兜底恢复到真实配置时，用户并没有做过到期操作
      notice(recovering ? 'network_back' : 'expired')
      return
    }
  }
  // 曲末动作：列表循环在 ended 前换下一首（保住微信悬浮音符）；单曲才无缝回环
  if (!tailTick(a)) playerState.seamlessLoop(a)
  // 前台每秒校准曲末定时器；锁屏后没有 timeupdate 时由它独立兜底
  armTail(a)
}

function handleStop() {
  disarmLoadingGuard()
  clearRetryTimers()
  const stoppedByUser = state.stopRequested
  state.stopRequested = false
  // 系统 stop（浮窗 X / 系统回收）不结束会话，只取消“应继续播放”的意图
  session().onStop()
  storage.patchMeta({ lastTrackPlaying: false })
  if (stoppedByUser) {
    patch({ currentId: '', currentTitle: '', currentCategory: '', playing: false, loading: false })
  } else {
    patch({ playing: false, loading: false })
  }
}

function handleEnded() {
  // 会话已被显式终止（用户停止 / 定时到点）：迟到的 ended 不能重新起播
  if (!session().isActive()) {
    storage.patchMeta({ lastTrackPlaying: false })
    patch({ playing: false })
    return
  }
  if (!playerState.claimEnded()) return
  // 坏源/极短源可能在 10s 内反复 ended：打满上限后停在“已暂停”，交给用户手动重试
  if (!session().allowReplay()) {
    session().onPlayFailed()
    storage.patchMeta({ lastTrackPlaying: false })
    patch({ playing: false })
    notice('replay_limited')
    return
  }
  // 锁屏期间 JS 可能被挂起；重新播放前先按墙钟检查定时是否已到点
  timer().restore()
  const expiredAt = timer().lastExpiredAt()
  const justExpired = expiredAt && Date.now() - expiredAt < TIMER_JUST_EXPIRED_MS
  if (timer().shouldStop() || justExpired) {
    stop()
    notice('timer_stop')
    return
  }
  advance()
}

function handleError(err) {
  const a = audio()
  // 旧源的 onError 可能在新源起播后到达：处理它会把新曲缓存删掉、甚至清掉会话
  const expectedNow = expectedSrc || session().getExpectedSrc()
  if (!expectedNow) return
  if (!playerState.isCurrentSourceError(a && a.src, expectedNow)) return
  // 错误码此前被丢弃，线上无法判断是网络、解码还是文件损坏；同一轮 1s 内只报一条
  const now = Date.now()
  if (now - lastErrorAt > ERROR_TRACK_DEDUPE_MS) {
    lastErrorAt = now
    const code = (err && (err.errCode || err.code)) || 'unknown'
    const events = require('./events')
    if (events && events.track) {
      events.track('audio_error', (state.currentId || 'unknown') + '|' + code)
    }
  }
  disarmLoadingGuard()
  const plan = errorPlan({ audio: a, expected: expectedNow, fromCache: state.fromCache, now })
  if (plan.action === 'ignore' || plan.action === 'playing' || plan.action === 'too_soon') {
    patch({ loading: false })
    return
  }
  if (plan.action === 'fallback') {
    state.fromCache = false
    markBadSource(plan.badUrl)
    patch({ loading: false })
    // 用户已在小程序内暂停：只把坏源拉黑，不得重新赋源起播
    // （给 BAM 赋 src 会自动出声，表现为“暂停后又自己响”）
    if (!session().canAutoStart()) {
      storage.patchMeta({ lastTrackPlaying: false })
      return
    }
    // 同一轮错误只允许一次远程回退
    if (playerState.isFallbacking(plan.badUrl)) return
    playerState.markFallback(plan.badUrl)
    armLoadingGuard()
    attach(plan.track, { cached: '' })
    safePlay()
    return
  }
  // 终态失败：**保留会话**，迷你条以“已暂停”留在三页，用户可点按重试
  playerState.clearFallback()
  session().onPlayFailed()
  patch({ playing: false, loading: false })
  storage.patchMeta({ lastTrackPlaying: false })
  // 失败后冻结倒计时：否则到点会 stop()，把“用户没停”变成业务终止
  timer().pause()
  notice('audio_failed')
}

/* ---------------- 初始化 ---------------- */

/** 幂等：只在第一次拿到实例时注册事件；重复调用只追加订阅者 */
function init(options) {
  const opts = options || {}
  if (opts.onState) subscribe(opts.onState)
  if (opts.notice) setNotice(opts.notice)
  if (opts.timerMinutes !== undefined) setTimerMinutes(opts.timerMinutes)
  if (initialized) return true
  const a = audio()
  if (!a) return false
  // 单测里的假实例可能只实现 play/pause/stop：逐个判断，注册缺一个不该整块失败
  initialized = true
  // 注册后先补一次状态：可能在别的页面已经播过，此时 meta 才是真相
  hydrate()
  if (a.onPlay) a.onPlay(handlePlay)
  if (a.onPause) a.onPause(handlePause)
  if (a.onStop) a.onStop(handleStop)
  if (a.onEnded) a.onEnded(handleEnded)
  if (a.onError) a.onError(handleError)
  if (a.onWaiting) a.onWaiting(handleWaiting)
  if (a.onCanplay) a.onCanplay(handleCanplay)
  if (a.onTimeUpdate) a.onTimeUpdate(handleTimeUpdate)
  // 锁屏/耳机线控的上/下一首：不注册时按键完全无响应（睡前戴耳机切歌是强习惯）。
  // 走与手动切歌同一套队列口径，避免系统按键和界面按钮切出不同结果。
  if (a.onNext) a.onNext(() => next())
  if (a.onPrev) a.onPrev(() => prev())
  return true
}

/** 从降级配置恢复时调用：决定到期提示说“解锁到期”还是“网络已恢复” */
function setRecovering(value) {
  recovering = !!value
}

function _resetForTest() {
  manager = null
  expectedSrc = ''
  expectedAt = 0
  initialized = false
  toggleAt = 0
  lastErrorAt = 0
  entitlementAt = 0
  recovering = false
  state.playing = false
  state.loading = false
  state.currentId = ''
  state.currentTitle = ''
  state.currentCategory = ''
  state.fromCache = false
  state.stopRequested = false
  state.timerMinutes = 0
  state.waitingAt = 0
  state.pauseRetry = 0
  disarmLoadingGuard()
  clearRetryTimers()
  clearAutoCacheTimer()
  lastNetType = ''
  listeners = []
  notices = []
}

module.exports = {
  init,
  audio,
  setManager,
  subscribe,
  setNotice,
  snapshot,
  play,
  pause,
  resume,
  toggle,
  stop,
  next,
  prev,
  advance,
  tailTick,
  armTail,
  refreshTail,
  scheduleAutoCache,
  replay,
  isBuffering,
  trackOf,
  playableUrl,
  ttlDays,
  attach,
  rebuild,
  surfaceOf,
  errorPlan,
  markBadSource,
  setExpectedSrc,
  expected,
  srcAge,
  setTimerMinutes,
  setRecovering,
  SRC_SETTLE_MS,
  _resetForTest
}
