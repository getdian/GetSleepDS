/**
 * 睡眠段（session）与按天聚合的纯函数。
 *
 * 归属规则：一次睡眠归到“醒来那一天”（dateKey(endAt)）。
 * 一天可以有多段（夜间睡眠 + 午休/间断睡眠）；主睡眠取最长的一段，
 * 用于热力图/周均值的“夜间”口径，总睡眠为所有段之和。
 */

const T = require('./time')

const MAX_SESSION_MS = 24 * 60 * 60 * 1000

function sessionId(session) {
  if (session && session.id) return String(session.id)
  const start = Number(session && session.startAt) || 0
  const end = Number(session && session.endAt) || 0
  return 's-' + start + '-' + end
}

function normalizeSession(session) {
  if (!session || typeof session !== 'object') return null
  const startAt = Number(session.startAt)
  const endAt = Number(session.endAt)
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) return null
  if (endAt <= startAt || endAt - startAt > MAX_SESSION_MS) return null
  const durationMin = Math.max(1, Math.round((endAt - startAt) / T.MINUTE_MS))
  return {
    id: sessionId(session),
    startAt,
    endAt,
    durationMin,
    source: session.source || 'manual',
    editedAt: Number(session.editedAt) || endAt
  }
}

/**
 * 以“醒来日”为基准，把两个 HH:MM 组合成一段睡眠。
 * 入睡时间 >= 起床时间时自动落到前一天，处理 23:00→07:00 的跨午夜补记。
 */
function rangeForDay(dayTs, bedMinutes, wakeMinutes, now) {
  let wakeAt = T.clockTs(dayTs, wakeMinutes)
  let bedAt = T.clockTs(dayTs, bedMinutes)
  if (bedAt >= wakeAt) bedAt -= T.DAY_MS
  const durationMin = Math.round((wakeAt - bedAt) / T.MINUTE_MS)
  let error = ''
  if (wakeAt > (Number(now) || Date.now()) + T.MINUTE_MS) error = 'future'
  else if (durationMin < 1) error = 'short'
  else if (wakeAt - bedAt > MAX_SESSION_MS) error = 'long'
  return { bedAt, wakeAt, durationMin, error }
}

/**
 * 精确指定“入睡日 + 醒来日”的组合。
 * 结束一次忘记关掉的 pending 时不能再用 rangeForDay 的“回退一天”：
 * 两天前 23:00 入睡会被压成昨天 23:00，时长和归属都错。
 * 这里不做任何猜测，时间顺序不对直接返回 order，交给用户改日期。
 */
function rangeBetween(startDayTs, bedMinutes, wakeDayTs, wakeMinutes, now) {
  const bedAt = T.clockTs(startDayTs, bedMinutes)
  const wakeAt = T.clockTs(wakeDayTs, wakeMinutes)
  const durationMin = Math.round((wakeAt - bedAt) / T.MINUTE_MS)
  let error = ''
  if (wakeAt > (Number(now) || Date.now()) + T.MINUTE_MS) error = 'future'
  else if (durationMin < 1) error = 'order'
  else if (wakeAt - bedAt > MAX_SESSION_MS) error = 'long'
  return { bedAt, wakeAt, durationMin, error }
}

/**
 * 兼容 v1：旧记录没有 sessions，用 bedAt/wakeAt 合成一段。
 *
 * 注意 sessions 存在但为空/全部非法时也要回退 v1 字段：
 * 同步合并（sync.js 写回 sessionsOf 的结果）或历史脏数据都可能落下 sessions: []，
 * 此时若不回退，完成态会直接取 sessions[0] 抛错、整页无法渲染。
 */
function sessionsOf(record) {
  if (!record) return []
  const list = Array.isArray(record.sessions)
    ? record.sessions
        .map(normalizeSession)
        .filter(Boolean)
        .sort((a, b) => a.startAt - b.startAt)
    : []
  if (list.length) return list
  if (Number.isFinite(Number(record.bedAt)) && Number.isFinite(Number(record.wakeAt))) {
    const legacy = normalizeSession({
      id: 'legacy-' + record.wakeAt,
      startAt: record.bedAt,
      endAt: record.wakeAt,
      source: 'legacy'
    })
    return legacy ? [legacy] : []
  }
  return []
}

function sessionDay(session) {
  const endAt = Number(session && session.endAt)
  return Number.isFinite(endAt) ? T.dateKey(endAt) : ''
}

function primaryOf(list) {
  let primary = null
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i]
    if (
      !primary ||
      item.durationMin > primary.durationMin ||
      (item.durationMin === primary.durationMin && item.endAt > primary.endAt)
    ) {
      primary = item
    }
  }
  return primary
}

function totalDurationOf(list) {
  let total = 0
  for (let i = 0; i < list.length; i += 1) total += list[i].durationMin
  return total
}

/** 把同一天的多段聚合成一条兼容旧字段的 record */
function aggregate(day, list, updatedAt) {
  const sessions = (Array.isArray(list) ? list : [])
    .map(normalizeSession)
    .filter(Boolean)
    .sort((a, b) => a.startAt - b.startAt)
  if (!sessions.length) return null
  const primary = primaryOf(sessions)
  return {
    day,
    dayRule: 'wake-v1',
    schemaVersion: 2,
    sessions,
    bedAt: primary.startAt,
    wakeAt: primary.endAt,
    durationMin: primary.durationMin,
    nightDurationMin: primary.durationMin,
    totalDurationMin: totalDurationOf(sessions),
    updatedAt: Number(updatedAt) || Date.now()
  }
}

/** 新增/替换一段；同 id 视为编辑 */
function upsert(record, session) {
  const next = normalizeSession(session)
  if (!next) return null
  const list = sessionsOf(record).filter((item) => item.id !== next.id)
  list.push(next)
  list.sort((a, b) => a.startAt - b.startAt)
  return list
}

function overlaps(a, b) {
  return a.startAt < b.endAt && b.startAt < a.endAt
}

/** 同一天内是否有重叠段（首尾相接不算重叠） */
function hasOverlap(list) {
  const sorted = (Array.isArray(list) ? list : [])
    .slice()
    .sort((a, b) => a.startAt - b.startAt)
  for (let i = 1; i < sorted.length; i += 1) {
    if (overlaps(sorted[i - 1], sorted[i])) return true
  }
  return false
}

/**
 * 跨天重叠检测：一段睡眠只归一个醒来日，但可能和相邻两天的段相交。
 * 例：3/4 22:00–23:30 已存在，再补记 3/4 22:30 → 3/5 07:00，
 * 按醒来日只会查 3/5，查不到 3/4 那段，两段就会分别计入两天。
 * exclude 传入 { id } 时跳过正在编辑的那一段。
 */
function findOverlap(records, startAt, endAt, exclude) {
  if (!records || typeof records !== 'object') return null
  const start = Number(startAt)
  const end = Number(endAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  const skipId = exclude && exclude.id ? String(exclude.id) : ''
  const keys = Object.keys(records)
  for (let i = 0; i < keys.length; i += 1) {
    const record = records[keys[i]]
    if (!record) continue
    const list = sessionsOf(record)
    for (let j = 0; j < list.length; j += 1) {
      const item = list[j]
      if (skipId && item.id === skipId) continue
      if (overlaps(item, { startAt: start, endAt: end })) return item
    }
  }
  return null
}

module.exports = {
  MAX_SESSION_MS,
  rangeForDay,
  rangeBetween,
  normalizeSession,
  sessionsOf,
  sessionDay,
  primaryOf,
  totalDurationOf,
  aggregate,
  upsert,
  overlaps,
  hasOverlap,
  findOverlap
}
