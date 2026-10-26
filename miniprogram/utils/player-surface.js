/**
 * 播放条 / 迷你条 / 音符的可见性与播放态判定（纯函数，audio-dock 与 now-playing 共用）。
 *
 * 2026-10-26 与产品确认的口径：
 * 1. 只有“用户显式停止”（mini 条的停止 → markStopped → lastTrackActive=false）才隐藏入口；
 * 2. 只要有 lastTrackId 且未被显式停止，入口就一直在（含冷启动、退出微信、悬浮 X 停止），
 *    此时 playing=false 显示“已暂停”，点按可续播；
 * 3. 冷启动的“残影”只允许把 playing 归零，**不得清会话**——否则用户重进小程序后
 *    条子消失，违背“打开就能继续听”的诉求。
 *
 * 历史教训：旧实现把“无 src + 本进程未播 + 未出声”整段当成终止（markStopped），
 * 于是微信悬浮 X 停止或杀进程后，三个页面的入口全被清掉。
 */

/**
 * @param {object} input
 * @param {string} [input.lastTrackId]      meta.lastTrackId
 * @param {boolean|undefined} input.lastTrackActive  false 表示用户显式停止
 * @param {boolean|undefined} input.lastTrackPlaying meta 里最后一次播放态
 * @param {boolean} input.hasSrc            当前播放器是否还有 src
 * @param {boolean} input.playingNow        播放器真实状态（!paused）
 * @param {boolean} [input.sessionLive]     本进程是否起播过（globalData.audioSession）
 * @returns {{visible: boolean, playing: boolean, cold: boolean, reason: string}}
 */
function resolvePlayerSurface(input) {
  const options = input || {}
  const hasTrack = !!options.lastTrackId
  if (!hasTrack) {
    return { visible: false, playing: false, cold: false, reason: 'no_track' }
  }
  // 用户在我们的小程序里点过“停止”：这是唯一允许收起入口的路径
  if (options.lastTrackActive === false) {
    return { visible: false, playing: false, cold: false, reason: 'stopped' }
  }
  // 严格布尔：无 src 时 BAM 的 paused 是 undefined，调用方写 !paused 会得到 true，
  // 于是“没有音源”被显示成“正在播放”（体验版真机复现的根因）。
  const playingNow = options.playingNow === true
  const hasSrc = options.hasSrc === true
  // 只信播放器的真实状态，且必须真的有音源：
  // BAM 冷启动/杀进程重进会保留上次的 src，但 paused=true、并没有出声。
  const playing = hasSrc && playingNow
  // 冷启动/进程重启：没在出声，且本进程没有起播会话（有无残留 src 都算）
  const cold = !playing && !options.sessionLive
  return { visible: true, playing, cold, reason: '' }
}

module.exports = { resolvePlayerSurface }
