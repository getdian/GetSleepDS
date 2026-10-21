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

/** 兼容 v1：旧记录没有 sessions，用 bedAt/wakeAt 合成一段 */
function sessionsOf(record) {
  if (!record) return []
  if (Array.isArray(record.sessions)) {
    return record.sessions
      .map(normalizeSession)
      .filter(Boolean)
      .sort((a, b) => a.startAt - b.startAt)
  }
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

module.exports = {
  MAX_SESSION_MS,
  normalizeSession,
  sessionsOf,
  sessionDay,
  primaryOf,
  totalDurationOf,
  aggregate,
  upsert,
  hasOverlap
}
