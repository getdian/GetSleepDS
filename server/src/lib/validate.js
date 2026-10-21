const { invalidBody, payloadTooLarge } = require('./errors')
const { sleepDayOf, calendarDayOf } = require('./time')

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const MAX_RECORDS = 62
const MAX_DELETIONS = 400
const MAX_SLEEP_MS = 24 * 60 * 60 * 1000
const MAX_SESSIONS = 8
const MAX_DAY_SLEEP_MS = 24 * 60 * 60 * 1000
const MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000
const MAX_FUTURE_MS = 24 * 60 * 60 * 1000

function inWindow(value, now) {
  return value >= now - MAX_AGE_MS && value <= now + MAX_FUTURE_MS
}

function normalizeSession(raw) {
  if (!raw || typeof raw !== 'object') return null
  const startAt = Number(raw.startAt)
  const endAt = Number(raw.endAt)
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) return null
  if (endAt <= startAt || endAt - startAt > MAX_SLEEP_MS) return null
  const id = String(raw.id || 's-' + startAt + '-' + endAt).slice(0, 64)
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null
  return {
    id,
    startAt,
    endAt,
    durationMin: Math.max(1, Math.round((endAt - startAt) / 60000)),
    source: String(raw.source || 'manual').slice(0, 16),
    editedAt: Number(raw.editedAt) || endAt
  }
}

function validSessions(list, now) {
  if (!Array.isArray(list) || !list.length || list.length > MAX_SESSIONS) return null
  const sessions = []
  for (let i = 0; i < list.length; i += 1) {
    const session = normalizeSession(list[i])
    if (!session) return null
    if (!inWindow(session.startAt, now) || !inWindow(session.endAt, now)) return null
    sessions.push(session)
  }
  sessions.sort((a, b) => a.startAt - b.startAt)
  let total = 0
  for (let i = 0; i < sessions.length; i += 1) {
    total += sessions[i].durationMin
    if (i > 0 && sessions[i - 1].endAt > sessions[i].startAt) return null
  }
  if (total * 60000 > MAX_DAY_SLEEP_MS) return null
  return sessions
}

/** 校验真实日历日，避免 2026-02-30 之类在 PG 触发 503。 */
function isRealDay(day) {
  const match = DAY_PATTERN.exec(String(day || ''))
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const date = Number(match[3])
  const parsed = new Date(Date.UTC(year, month - 1, date))
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === date
  )
}

/**
 * 校验并归一化打卡记录。
 *
 * 设计变化（2026-10-19）：
 * - day 一律由 bedAt 重算，客户端时区不再影响云同步；
 * - 单条脏记录丢弃并计数，不再让一条坏数据毒死整批；
 * - 时间戳限定在 [now-400d, now+1d]，避免极端值触发 Date RangeError 或毒化 LWW。
 */
function validateRecords(input, options) {
  if (!Array.isArray(input)) throw invalidBody('records 必须是数组')
  if (input.length > MAX_RECORDS) throw payloadTooLarge('记录最多 ' + MAX_RECORDS + ' 条')

  const now = (options && options.now) || Date.now()
  const normalized = []
  let dropped = 0

  for (let i = 0; i < input.length; i += 1) {
    const item = input[i]
    if (!item || typeof item !== 'object') {
      dropped += 1
      continue
    }

    const rawUpdatedAt = Number(item.updatedAt)
    const isV2 = Number(item.schemaVersion) === 2 && Array.isArray(item.sessions)

    if (isV2) {
      const sessions = validSessions(item.sessions, now)
      if (!sessions) {
        dropped += 1
        continue
      }
      const primary = sessions.reduce((best, current) => {
        if (!best) return current
        if (current.durationMin > best.durationMin) return current
        if (current.durationMin === best.durationMin && current.endAt > best.endAt) return current
        return best
      }, null)
      const day = calendarDayOf(primary.endAt)
      // 一条记录只装同一天醒来的段；跨天段由客户端拆到各自醒来日
      if (sessions.some((session) => calendarDayOf(session.endAt) !== day)) {
        dropped += 1
        continue
      }
      const updatedAt = Number.isFinite(rawUpdatedAt) && rawUpdatedAt > 0 ? rawUpdatedAt : primary.endAt
      if (!inWindow(updatedAt, now)) {
        dropped += 1
        continue
      }
      normalized.push({
        day,
        dayRule: 'wake-v1',
        schemaVersion: 2,
        bedAt: primary.startAt,
        wakeAt: primary.endAt,
        durationMin: primary.durationMin,
        nightDurationMin: primary.durationMin,
        totalDurationMin: sessions.reduce((sum, session) => sum + session.durationMin, 0),
        sessions,
        updatedAt
      })
      continue
    }

    const bedAt = Number(item.bedAt)
    const wakeAt = Number(item.wakeAt)
    if (!Number.isFinite(bedAt) || !Number.isFinite(wakeAt)) {
      dropped += 1
      continue
    }
    if (!inWindow(bedAt, now) || !inWindow(wakeAt, now)) {
      dropped += 1
      continue
    }
    if (wakeAt <= bedAt || wakeAt - bedAt > MAX_SLEEP_MS) {
      dropped += 1
      continue
    }

    const updatedAt = Number.isFinite(rawUpdatedAt) && rawUpdatedAt > 0 ? rawUpdatedAt : wakeAt
    if (!inWindow(updatedAt, now)) {
      dropped += 1
      continue
    }

    normalized.push({
      // 旧记录保持“入睡日”口径，避免历史统计被重排
      day: sleepDayOf(bedAt),
      dayRule: 'bed-v1',
      schemaVersion: 1,
      bedAt,
      wakeAt,
      durationMin: Math.round((wakeAt - bedAt) / 60000),
      nightDurationMin: Math.round((wakeAt - bedAt) / 60000),
      totalDurationMin: Math.round((wakeAt - bedAt) / 60000),
      sessions: [{
        id: 'legacy-' + wakeAt,
        startAt: bedAt,
        endAt: wakeAt,
        durationMin: Math.round((wakeAt - bedAt) / 60000),
        source: 'legacy',
        editedAt: wakeAt
      }],
      updatedAt
    })
  }

  // 同一天只保留最新的一条
  const byDay = new Map()
  normalized.forEach((record) => {
    const previous = byDay.get(record.day)
    if (!previous || record.updatedAt >= previous.updatedAt) byDay.set(record.day, record)
  })

  return { records: Array.from(byDay.values()), dropped }
}

/**
 * 删除墓碑：只接受最近 400 天内的日期；同一 day 取最大的 deletedAt。
 * 客户端撤销/后台按日删除都走这里。
 */
function validateDeletions(input, options) {
  if (input === undefined || input === null) return []
  if (!Array.isArray(input)) throw invalidBody('deletedDays 必须是数组')
  if (input.length > MAX_DELETIONS) throw payloadTooLarge('删除记录最多 ' + MAX_DELETIONS + ' 条')

  const now = (options && options.now) || Date.now()
  const byDay = new Map()

  for (let i = 0; i < input.length; i += 1) {
    const item = input[i]
    if (!item || typeof item !== 'object') continue
    const day = String(item.day || '')
    if (!isRealDay(day)) continue
    const deletedAt = Number(item.deletedAt)
    if (!Number.isFinite(deletedAt) || !inWindow(deletedAt, now)) continue
    const previous = byDay.get(day)
    if (!previous || deletedAt > previous.deletedAt) {
      byDay.set(day, { day, deletedAt })
    }
  }

  return Array.from(byDay.values())
}

module.exports = {
  validateRecords,
  validateDeletions,
  MAX_RECORDS,
  MAX_SLEEP_MS
}
