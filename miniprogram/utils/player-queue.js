/**
 * 环境音播放队列（纯函数）。
 *
 * 产品口径（2026-10-30 与产品确认，替换此前的“收藏连播”）：
 * - 播放模式只有两种：`single` 单曲循环（默认）/ `list` 列表循环；
 * - 队列来源与模式**正交**：点哪首歌，就以“当时看到的列表”（全部 / 收藏 / 某分类）
 *   冻结一份队列快照（meta.audioQueueIds），曲末推进只认这份快照；
 * - 因此“在收藏分类下点播放”才播收藏，“在全部下点播放”就播全部——
 *   不再把收藏硬绑进模式，也不做全列表随机。
 * - 队列不足 2 首时列表循环等同单曲（调用方回退 replay），不弹拦截。
 */

function normalizeQueueMode(value) {
  // 'favorites' 是 2026-10-26 那版“收藏连播”的历史取值：升级用户按列表循环承接，
  // 避免开关被静默重置成单曲。
  return value === 'list' || value === 'favorites' ? 'list' : 'single'
}

/** 队列快照：只保留可播放的 id，去重且保持可见顺序（用户看到什么就播什么） */
function queueIdsOf(tracks) {
  const list = Array.isArray(tracks) ? tracks : []
  const seen = {}
  const ids = []
  list.forEach((track) => {
    const id = track && track.id
    if (!id || seen[id]) return
    seen[id] = true
    ids.push(id)
  })
  return ids
}

/**
 * 队列兜底：有快照用快照；没有快照时用当前配置的全部音源。
 * 老版本“收藏连播”升级、或用户从未在抽屉里点过歌时，列表循环必须仍有队列，
 * 否则在非入睡页（没有 audio-dock 补快照）会静默退回单曲循环。
 */
function resolveQueueIds(tracks, queueIds) {
  const ids = Array.isArray(queueIds) ? queueIds.filter(Boolean) : []
  return ids.length ? ids : queueIdsOf(tracks)
}

/** 有序列表里取下一首：定位当前曲、取模循环；当前曲不在列表时从第一首开始 */
function nextInOrderedList(list, currentId) {
  if (!list || list.length < 2) return null
  let index = -1
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].id === currentId) index = i
  }
  const next = index >= 0 ? list[(index + 1) % list.length] : list[0]
  if (!next || next.id === currentId) return null
  return next
}

/** 有序列表里取上一首：向前取模；当前曲不在列表时从最后一首开始 */
function prevInOrderedList(list, currentId) {
  if (!list || list.length < 2) return null
  let index = -1
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].id === currentId) index = i
  }
  const prev = index >= 0 ? list[(index - 1 + list.length) % list.length] : list[list.length - 1]
  if (!prev || prev.id === currentId) return null
  return prev
}

/** 队列快照 → 按快照顺序映射成曲目列表（快照里已下架的 id 自然被过滤） */
function queueListOf(tracks, queueIds) {
  const byId = {}
  ;(tracks || []).forEach((track) => {
    if (track && track.id) byId[track.id] = track
  })
  return (Array.isArray(queueIds) ? queueIds : []).map((id) => byId[id]).filter(Boolean)
}

/**
 * 列表循环：按队列快照取下一首。
 *
 * @param {Array<{id:string}>} tracks 配置里的全部音源
 * @param {string} currentId 当前曲目 id
 * @param {string[]} queueIds 点播时冻结的队列快照
 * @returns {object|null} 下一首；快照不足 2 首或取不到时返回 null（调用方回退单曲循环）
 */
function nextInQueue(tracks, currentId, queueIds) {
  const ids = Array.isArray(queueIds) ? queueIds : []
  if (ids.length < 2) return null
  // 顺序必须按快照（用户点播时看到的排序），不能按配置顺序重排；
  // 快照里已下架的 id 自然被过滤掉
  return nextInOrderedList(queueListOf(tracks, ids), currentId)
}

/**
 * 列表循环的“上一首”（锁屏/耳机线控用）：口径与 nextInQueue 对称。
 * @returns {object|null} 上一首；快照不足 2 首或取不到时返回 null（调用方回退配置列表）
 */
function prevInQueue(tracks, currentId, queueIds) {
  const ids = Array.isArray(queueIds) ? queueIds : []
  if (ids.length < 2) return null
  return prevInOrderedList(queueListOf(tracks, ids), currentId)
}

/**
 * 手动“下一首”的兜底：按配置里的音源顺序循环。
 * 队列快照里取不到下一首（例如只有 1 首收藏）时用它，避免按钮点了没反应。
 *
 * @param {Array<{id:string}>} tracks 配置里的全部音源（已过滤非法项）
 * @param {string} currentId 当前曲目 id
 * @returns {object|null} 下一首；不足 2 首时返回 null（调用方提示“只有一个音源”）
 */
function nextTrackInList(tracks, currentId) {
  const list = (tracks || []).filter((track) => track && track.id)
  return nextInOrderedList(list, currentId)
}

/**
 * 手动切歌的统一口径：列表循环优先队列快照，其余按配置列表。
 * 迷你条与抽屉两个入口都用它，避免切出不同结果。
 */
function nextTrackManual(tracks, currentId, queueIds, mode) {
  if (normalizeQueueMode(mode) === 'list') {
    const next = nextInQueue(tracks, currentId, queueIds)
    if (next) return next
  }
  return nextTrackInList(tracks, currentId)
}

/** 手动“上一首”的兜底：按配置顺序向前循环（与 nextTrackInList 对称） */
function prevTrackInList(tracks, currentId) {
  const list = (tracks || []).filter((track) => track && track.id)
  return prevInOrderedList(list, currentId)
}

/** 锁屏/耳机“上一首”的统一口径：列表循环优先队列快照，其余按配置列表 */
function prevTrackManual(tracks, currentId, queueIds, mode) {
  if (normalizeQueueMode(mode) === 'list') {
    const prev = prevInQueue(tracks, currentId, queueIds)
    if (prev) return prev
  }
  return prevTrackInList(tracks, currentId)
}

module.exports = {
  normalizeQueueMode,
  queueIdsOf,
  resolveQueueIds,
  nextInQueue,
  nextTrackInList,
  nextTrackManual,
  prevInQueue,
  prevTrackInList,
  prevTrackManual
}
