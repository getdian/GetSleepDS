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

let fallbackUrl = ''
let fallbackAt = 0
let endedClaimAt = 0

/** 抢占本轮 ended 的处理权；窗口内只有一个调用方拿到 true */
function claimEnded() {
  const now = Date.now()
  if (now - endedClaimAt < ENDED_CLAIM_MS) return false
  endedClaimAt = now
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

module.exports = { markFallback, clearFallback, isFallbacking, claimEnded }
