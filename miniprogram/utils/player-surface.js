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
  const playingNow = !!options.playingNow
  const hasSrc = !!options.hasSrc
  // paused 优先；只有“有 src 但 pause 事件丢失”时才用持久化标记兜底
  const playing = playingNow || (hasSrc && options.lastTrackPlaying !== false)
  // 冷启动/进程重启：没有 src、本进程没播过、也没出声
  const cold = !hasSrc && !playingNow && !options.sessionLive
  return { visible: true, playing, cold, reason: '' }
}

module.exports = { resolvePlayerSurface }
