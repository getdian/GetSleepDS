/**
 * 统计与聚合，纯函数，不依赖 wx。
 * 所有输入的 records 形如 { '2026-10-17': { day, bedAt, wakeAt, durationMin } }
 */

const T = require('./time')

const CYCLE_MIN = 90

function completedList(records) {
  const source = records || {}
  const list = []
  Object.keys(source).forEach((key) => {
    const r = source[key]
    if (r && r.bedAt && r.wakeAt && r.wakeAt > r.bedAt) {
      list.push(r)
    }
  })
  list.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
  return list
}

function sum(list, pick) {
  let total = 0
  for (let i = 0; i < list.length; i += 1) total += pick(list[i])
  return total
}

function durationOf(record) {
  if (record.durationMin) return record.durationMin
  return Math.round((record.wakeAt - record.bedAt) / T.MINUTE_MS)
}

function levelOf(minutes) {
  if (!minutes) return 0
  if (minutes < 6 * 60) return 1
  if (minutes < 7 * 60) return 2
  if (minutes < 8 * 60) return 3
  if (minutes < 9 * 60) return 4
  return 5
}

function emptyDigest() {
  return {
    count: 0,
    avgBedMin: null,
    avgWakeMin: null,
    avgDurationMin: null,
    afterMidnightDays: 0,
    longestMin: null,
    shortestMin: null
  }
}

function digest(list) {
  if (!list.length) return emptyDigest()

  const bedValues = list.map((r) => T.minutesOf(r.bedAt))
  const wakeValues = list.map((r) => T.minutesOf(r.wakeAt))
  const durations = list.map(durationOf)

  return {
    count: list.length,
    avgBedMin: T.circularMeanMinutes(bedValues),
    avgWakeMin: T.circularMeanMinutes(wakeValues),
    avgDurationMin: Math.round(sum(list, durationOf) / list.length),
    // 0 点后入睡 = 入睡时刻在 [00:00, 06:00)
    afterMidnightDays: bedValues.filter((m) => m < 6 * 60).length,
    longestMin: Math.max.apply(null, durations),
    shortestMin: Math.min.apply(null, durations)
  }
}

function weekBounds(now) {
  const start = T.startOfWeek(now)
  return { start, end: T.addDays(start, 7) }
}

function inRange(list, start, end) {
  return list.filter((r) => {
    const ts = T.parseDateKey(r.day)
    return ts >= start && ts < end
  })
}

function streakDays(records, now) {
  const done = {}
  completedList(records).forEach((r) => {
    done[r.day] = true
  })

  let key = T.sleepDayOf(now)
  if (!done[key]) {
    // 今天还没打卡不算断，从昨天开始数
    key = T.sleepDayOf(T.addDays(now, -1))
    if (!done[key]) return 0
  }

  let count = 0
  let cursor = T.parseDateKey(key)
  while (done[T.dateKey(cursor)]) {
    count += 1
    cursor = T.addDays(cursor, -1)
  }
  return count
}

/**
 * 本周 / 上周同期对比。
 * 注意：周与周的比较用完整上一周，避免周一拿 1 天比 7 天。
 */
function weekly(records, now) {
  const list = completedList(records)
  const bounds = weekBounds(now)
  const prevStart = T.addDays(bounds.start, -7)

  const current = digest(inRange(list, bounds.start, bounds.end))
  const previous = digest(inRange(list, prevStart, bounds.start))

  const delta = {
    bed:
      current.avgBedMin === null || previous.avgBedMin === null
        ? null
        : T.clockDelta(current.avgBedMin, previous.avgBedMin),
    wake:
      current.avgWakeMin === null || previous.avgWakeMin === null
        ? null
        : T.clockDelta(current.avgWakeMin, previous.avgWakeMin),
    duration:
      current.avgDurationMin === null || previous.avgDurationMin === null
        ? null
        : current.avgDurationMin - previous.avgDurationMin
  }

  return {
    current,
    previous,
    delta,
    streak: streakDays(records, now),
    weekStart: bounds.start
  }
}

/**
 * 热力图格子：周一为一周起点，返回按周补齐的数组。
 * level: -1 占位, 0 未打卡, 1-5 时长分级
 */
function heatmapCells(records, now, days, partialDay, endOffsetDays) {
  const span = days || 120
  const todayKey = T.dateKey(T.startOfDay(now))
  // endOffsetDays > 0 时渲染未来板位（月对齐图板的"往后 3 周"）
  const end = T.addDays(T.startOfDay(now), endOffsetDays || 0)
  const endKey = T.dateKey(end)
  const start = T.addDays(end, -(span - 1))
  const lead = (new Date(start).getDay() + 6) % 7
  const cells = []

  for (let i = 0; i < lead; i += 1) {
    cells.push({ key: 'pad-head-' + i, level: -1, pad: true, day: '' })
  }

  let marked = 0
  for (let i = 0; i < span; i += 1) {
    const ts = T.addDays(start, i)
    const day = T.dateKey(ts)
    const record = records ? records[day] : null
    const minutes = record ? durationOf(record) : 0
    if (minutes) marked += 1
    cells.push({
      key: day,
      level: levelOf(minutes),
      pad: false,
      day,
      durationMin: minutes,
      partial: !minutes && day === partialDay,
      isToday: day === todayKey
    })
  }

  while (cells.length % 7 !== 0) {
    cells.push({ key: 'pad-tail-' + cells.length, level: -1, pad: true, day: '' })
  }

  const colCount = cells.length / 7
  const months = []
  let lastMonth = -1
  for (let col = 0; col < colCount; col += 1) {
    let firstDay = ''
    for (let row = 0; row < 7; row += 1) {
      const cell = cells[col * 7 + row]
      if (cell && !cell.pad && cell.day) {
        firstDay = cell.day
        break
      }
    }
    if (!firstDay) continue
    const month = Number(firstDay.slice(5, 7))
    if (month !== lastMonth) {
      months.push({ col, label: month + '月' })
      lastMonth = month
    }
  }

  return {
    cells,
    marked,
    colCount,
    months,
    startKey: T.dateKey(start),
    endKey
  }
}

/** 组装给 /api/summary 的记录（最近 N 天，仅已完成） */
function summaryPayload(records, now, days) {
  const span = days || 14
  const end = T.startOfDay(now)
  const start = T.addDays(end, -(span - 1))
  return completedList(records)
    .filter((r) => {
      const ts = T.parseDateKey(r.day)
      return ts >= start && ts <= end
    })
    .map((r) => ({
      day: r.day,
      bedAt: r.bedAt,
      wakeAt: r.wakeAt,
      updatedAt: r.updatedAt || r.wakeAt
    }))
}

/**
 * 「近 3 个月」月对齐图板：
 * 从"2 个月前的 1 号"开始（起点不做周一对齐，让 heatmapCells 的 lead 补位去对齐
 * 星期行，保证第一个真实日就是该月 1 号、月份标签不出现上个月的碎列），
 * 到"今天 + 21 天"所在周的周日结束（含约 3 周空板位）。
 * 返回 { days, endOffsetDays }：days = 跨度天数；endOffsetDays = 图板末尾相对今天的偏移，
 * 供 heatmapCells 的第五参渲染未来板位。
 */
function monthsSpan(now) {
  const d = new Date(now)
  const anchorMonthFirst = new Date(d.getFullYear(), d.getMonth() - 2, 1).getTime()
  const start = T.startOfDay(anchorMonthFirst)
  const end = T.startOfWeek(T.startOfDay(now + 21 * T.DAY_MS)) + 6 * T.DAY_MS
  const days = Math.round((end - start) / T.DAY_MS) + 1
  return { days, endOffsetDays: Math.round((end - T.startOfDay(now)) / T.DAY_MS) }
}

module.exports = {
  CYCLE_MIN,
  completedList,
  durationOf,
  levelOf,
  digest,
  weekBounds,
  inRange,
  streakDays,
  weekly,
  heatmapCells,
  monthsSpan,
  summaryPayload
}
