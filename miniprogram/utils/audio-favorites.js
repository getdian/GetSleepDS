/**
 * 环境音收藏人数：展示文案 + 排序快照。
 *
 * 抽成纯函数而不是写在 audio-dock 里，是因为组件依赖 wx / BackgroundAudioManager，
 * 单测跑不动；这里的规则（万位缩写、0 人回落、同分保持配置顺序）必须能被测试锁住。
 */

const FAV_SUFFIX = '人收藏和喜欢'

/**
 * 展示文案：`713 人收藏和喜欢`。
 * 0 人时退回「点击播放」——冷启动既没有人气基数也没有真实收藏时，
 * 让用户看到「0 人收藏」比不显示更伤信任，也顺带保留了可点性暗示。
 */
function formatFavText(count) {
  const num = Math.max(0, Math.floor(Number(count) || 0))
  if (!num) return '点击播放'
  if (num >= 10000) {
    const wan = Math.round(num / 1000) / 10
    return wan + ' 万' + FAV_SUFFIX
  }
  return num + ' ' + FAV_SUFFIX
}

/**
 * 合并服务端下发的计数（展示值已含后台人气基数）。
 * 某首歌没拿到计数时回落它自己的 favBase，而不是 0，否则网络一次抖动就把
 * 运营设的 713 显示成 0。
 */
function mergeFavCounts(tracks, counts) {
  const map = counts || {}
  return (tracks || []).map((track) => {
    const value = Number(map[track.id])
    const count = Number.isFinite(value) && value >= 0 ? value : Number(track.favBase) || 0
    return Object.assign({}, track, {
      favCount: count,
      favText: formatFavText(count)
    })
  })
}

/** 排序快照：id -> 收藏人数。收藏动作只改数字，不重建快照，避免刚点的那行当场跳走 */
function rankOf(tracks) {
  const map = {}
  ;(tracks || []).forEach((track) => {
    if (track && track.id) map[track.id] = Math.max(0, Math.floor(Number(track.favCount) || 0))
  })
  return map
}

/**
 * 按快照稳定降序。Array#sort 在 ES2019 起保证稳定，
 * 同收藏数的曲目保持运营在后台排的顺序。
 */
function sortByRank(tracks, rank) {
  const map = rank || {}
  return (tracks || []).slice().sort((a, b) => (map[b.id] || 0) - (map[a.id] || 0))
}

module.exports = { FAV_SUFFIX, formatFavText, mergeFavCounts, rankOf, sortByRank }
