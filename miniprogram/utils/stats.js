/**
 * 统计与聚合，纯函数，不依赖 wx。
 * 所有输入的 records 形如 { '2026-10-17': { day, bedAt, wakeAt, durationMin } }
 */

const T = require('./time')

const CYCLE_MIN = T.CYCLE_MIN

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

/**
 * 完成态是否允许开始新一次记录。
 * 原规则只看 18:00，导致下午小睡占用同一睡眠日后，00:00–12:00 无法记录当晚。
 * 现在：跨睡眠日直接允许；同睡眠日 18:00 后允许；或距上次起床已满 3 小时。
 */
function canStartNewSleep(record, now, todayKey) {
  if (!record || !record.wakeAt) return false
  const hour = new Date(now).getHours()
  const stale = now - record.wakeAt >= 3 * 60 * 60 * 1000
  // 跨睡眠日：仍只在晚上开放“再记今晚”，避免白天新增一条会被晚上覆盖的午睡。
  if (record.day !== todayKey) return hour >= 18
  if (hour >= 18) return true
  // 同一睡眠日的凌晨窗口：下午小睡后 00:00–12:00 仍能开始新记录；
  // 12:00 之后不放开，避免把任何白天小睡都当成新的一晚。
  return hour < 12 && stale
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

function durationText(minutes) {
  const total = Math.max(0, Math.round(minutes))
  if (total < 60) return total + ' 分钟'
  return Math.floor(total / 60) + ' 小时 ' + T.pad2(total % 60) + ' 分'
}

/**
 * 本地事实回顾：与服务端模板同口径（ADR-007），未开启云备份时使用，零上传。
 * 只陈述均值、差值、0 点后入睡天数，不做任何评价或建议。
 */
/** 事实回顾缓存指纹：同周内新增记录也必须触发重新生成 */
function factSignature(weekly) {
  if (!weekly || !weekly.current) return ''
  const c = weekly.current
  return [
    weekly.weekStart,
    c.count,
    c.avgBedMin,
    c.avgWakeMin,
    c.avgDurationMin
  ].join(':')
}

function localFact(records, now) {
  const w = weekly(records, now)
  const cur = w.current
  if (!cur || cur.count < 3 || cur.avgBedMin === null || cur.avgWakeMin === null) {
    return { available: false, text: '', stats: cur }
  }

  const avgBed = T.pad2(Math.floor(cur.avgBedMin / 60)) + ':' + T.pad2(cur.avgBedMin % 60)
  const avgWake = T.pad2(Math.floor(cur.avgWakeMin / 60)) + ':' + T.pad2(cur.avgWakeMin % 60)
  const avgDurationText = durationText(cur.avgDurationMin)
  const sentences = [
    '本周你记录了 ' + cur.count + ' 次睡眠，平均 ' + avgBed + ' 入睡、' + avgWake + ' 起床，平均 ' + avgDurationText + '。',
    '本周 ' + cur.count + ' 次记录里，平均 ' + avgBed + ' 入睡、' + avgWake + ' 起床，平均 ' + avgDurationText + '。',
    '本周共 ' + cur.count + ' 次打卡：平均 ' + avgBed + ' 入睡、' + avgWake + ' 起床，平均 ' + avgDurationText + '。'
  ]

  let second = ''
  if (w.delta.bed !== null) {
    if (w.delta.bed === 0) second = '平均入睡时间与上周持平'
    else second = '平均入睡时间比上周' + (w.delta.bed > 0 ? '晚' : '早') + '了 ' + Math.abs(w.delta.bed) + ' 分钟'
  }
  if (cur.afterMidnightDays > 0) {
    second += (second ? '，' : '') + '有 ' + cur.afterMidnightDays + ' 天在 0 点后入睡'
  }

  return {
    available: true,
    text: sentences[cur.count % sentences.length] + (second ? second + '。' : ''),
    stats: cur
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
      isToday: day === todayKey,
      future: day > todayKey
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
 * 月对齐图板：monthsBack 个月前的 1 号 → (今天 + aheadDays) 所在周的周日。
 * 起点不做周一对齐，交给 heatmapCells 的 lead 补位，保证第一个真实日就是该月 1 号，
 * 月份标签不会出现上个月的碎列；末尾若干天是未来占位（虚线）。
 * 返回 { days, endOffsetDays }：days = 跨度天数；endOffsetDays = 图板末尾相对今天的偏移，
 * 供 heatmapCells 的第五参渲染未来板位。
 */
function monthsSpan(now, monthsBack, aheadDays) {
  const back = monthsBack || 2
  const ahead = aheadDays === undefined ? 21 : aheadDays
  const d = new Date(now)
  const anchorMonthFirst = new Date(d.getFullYear(), d.getMonth() - back, 1).getTime()
  const start = T.startOfDay(anchorMonthFirst)
  const end = T.startOfWeek(T.startOfDay(now + ahead * T.DAY_MS)) + 6 * T.DAY_MS
  const days = Math.round((end - start) / T.DAY_MS) + 1
  return { days, endOffsetDays: Math.round((end - T.startOfDay(now)) / T.DAY_MS) }
}

module.exports = {
  CYCLE_MIN,
  completedList,
  durationOf,
  levelOf,
  digest,
  weekly,
  localFact,
  factSignature,
  weekBounds,
  inRange,
  canStartNewSleep,
  streakDays,
  heatmapCells,
  monthsSpan,
  summaryPayload
}
