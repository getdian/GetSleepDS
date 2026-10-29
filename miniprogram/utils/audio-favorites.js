/**
 * 环境音收藏人数：展示文案 + 真实计数合成 + 排序快照。
 *
 * 抽成纯函数而不是写在 audio-dock 里，是因为组件依赖 wx / BackgroundAudioManager，
 * 单测跑不动；这里的规则（万位缩写、0 人回落、同分保持配置顺序）必须能被测试锁住。
 */

const { compactWan } = require('./format')

const FAV_SUFFIX = '人收藏和喜欢'

/**
 * 展示文案：`713 人收藏和喜欢`。
 * 0 人时退回「点击播放」——冷启动既没有人气基数也没有真实收藏时，
 * 让用户看到「0 人收藏」比不显示更伤信任，也顺带保留了可点性暗示。
 */
function formatFavText(count) {
  const num = Math.max(0, Math.floor(Number(count) || 0))
  if (!num) return '点击播放'
  const wan = compactWan(num)
  if (wan) return wan + ' 万' + FAV_SUFFIX
  return num + ' ' + FAV_SUFFIX
}

/**
 * 展示值 = 后台人气基数（track.favBase）+ 真实收藏（服务端 real）。
 * 真实数缺失/非法按 0：网络一次抖动不会把运营设的 713 显示成 0，
 * 运营调低基数后也不会被旧的展示值压住（基数永远取当前配置）。
 */
function withRealCounts(tracks, realMap) {
  const map = realMap || {}
  return (tracks || []).map((track) => {
    const real = Math.max(0, Math.floor(Number(map[track.id]) || 0))
    const count = (Number(track.favBase) || 0) + real
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

module.exports = { FAV_SUFFIX, formatFavText, withRealCounts, rankOf, sortByRank }
