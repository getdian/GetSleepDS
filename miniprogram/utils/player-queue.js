/**
 * 环境音播放队列（纯函数）。
 *
 * 产品口径（2026-10-26 与产品确认）：
 * - 默认 `single`：只循环当前这一首，最简、最不打扰睡前场景；
 * - `favorites`：用户显式切到“收藏连播”才按收藏列表循环；
 * - 刻意不做“全列表自动顺序播放”——半夜自动换音色容易吵醒用户，
 *   想听别的由用户主动点选即可。
 *
 * 解锁是**全局 24 小时**（与曲目数量无关），所以连播多首不会额外消耗解锁，
 * 不存在“多首播放与 24h 解锁冲突”的问题。
 */

function normalizeQueueMode(value) {
  return value === 'favorites' ? 'favorites' : 'single'
}

/**
 * @param {Array<{id:string}>} tracks 配置里的全部音源
 * @param {string} currentId 当前曲目 id
 * @param {string[]} favorites 收藏 id 列表
 * @param {string} mode 'single' | 'favorites'
 * @returns {object|null} 下一首；不适用时返回 null（调用方回退单曲循环）
 */
function nextTrackInQueue(tracks, currentId, favorites, mode) {
  if (normalizeQueueMode(mode) !== 'favorites') return null
  const ids = Array.isArray(favorites) ? favorites : []
  if (ids.length < 2) return null
  const list = (tracks || []).filter((track) => track && ids.indexOf(track.id) >= 0)
  if (list.length < 2) return null
  let index = -1
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].id === currentId) index = i
  }
  // 当前曲目不在收藏里（用户刚取消了收藏）：从第一首开始
  const next = index >= 0 ? list[(index + 1) % list.length] : list[0]
  if (!next || next.id === currentId) return null
  return next
}

module.exports = { normalizeQueueMode, nextTrackInQueue }
