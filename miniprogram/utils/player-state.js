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

let fallbackUrl = ''
let fallbackAt = 0

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

module.exports = { markFallback, clearFallback, isFallbacking }
