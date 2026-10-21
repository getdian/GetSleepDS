/**
 * 统计与聚合，纯函数，不依赖 wx。
 * 所有输入的 records 形如 { '2026-10-17': { day, bedAt, wakeAt, durationMin } }
 */

const T = require('./time')
const X = require('./sessions')

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

/** 主睡眠（最长一段）：热力图/周均值/连续天数使用 */
function durationOf(record) {
  if (record && record.nightDurationMin) return record.nightDurationMin
  if (record && record.durationMin) return record.durationMin
  return record ? Math.round((record.wakeAt - record.bedAt) / T.MINUTE_MS) : 0
}

/** 当天总睡眠（夜间 + 午休/间断段）：详情/总时长使用 */
function totalDurationOf(record) {
  if (!record) return 0
  if (record.totalDurationMin) return record.totalDurationMin
  if (Array.isArray(record.sessions) && record.sessions.length) {
    return X.totalDurationOf(X.sessionsOf(record))
  }
  return durationOf(record)
}

function sessionsOf(record) {
  return X.sessionsOf(record)
}

function levelOf(minutes) {
  if (!minutes) return 0
  if (minutes < 6 * 60) return 1
  if (minutes < 7 * 60) return 2
  if (minutes < 8 * 60) return 3
  if (minutes < 9 * 60) return 4
  return 5
}

/**
 * 日历/热力图的 4 档色阶。
 * 原 5 档把「6 小时以下」全部塞进同一档，短睡用户看不出深浅；
 * 这里把常见短睡区间拆开，档位减少后也更容易在图例里讲清楚。
 */
function heatLevelOf(minutes) {
  if (!minutes) return 0
  if (minutes < 4 * 60) return 1
  if (minutes < 6 * 60) return 2
  if (minutes < 8 * 60) return 3
  return 4
}

function emptyDigest() {
  return {
    count: 0,
    avgBedMin: null,
    avgWakeMin: null,
    avgDurationMin: null,
    avgTotalMin: null,
    afterMidnightDays: 0,
    longestMin: null,
    shortestMin: null
  }
}

function digest(list) {
  if (!list.length) return emptyDigest()

  const bedValues = list.map((r) => T.minutesOf(r.bedAt))
  const wakeValues = list.map((r) => T.minutesOf(r.wakeAt))
  const totals = list.map(totalDurationOf)

  return {
    count: list.length,
    avgBedMin: T.circularMeanMinutes(bedValues),
    avgWakeMin: T.circularMeanMinutes(wakeValues),
    avgDurationMin: Math.round(sum(list, durationOf) / list.length),
    // 统计页主口径：当天总睡眠（夜间 + 午休/间断段），与用户“我睡了多久”一致
    avgTotalMin: Math.round(sum(list, totalDurationOf) / list.length),
    // 0 点后入睡 = 入睡时刻在 [00:00, 06:00)
    afterMidnightDays: bedValues.filter((m) => m < 6 * 60).length,
    longestMin: Math.max.apply(null, totals),
    shortestMin: Math.min.apply(null, totals)
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
  // 新口径允许一天多段：完成态即可追加，不再用“睡眠日名额”限制午休
  return record.day !== todayKey || now - record.wakeAt >= 3 * 60 * 60 * 1000
}

function streakDays(records, now) {
  const done = {}
  completedList(records).forEach((r) => {
    done[r.day] = true
  })

  let key = T.dateKey(now)
  if (!done[key]) {
    // 今天还没打卡不算断，从昨天开始数
    key = T.dateKey(T.addDays(now, -1))
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
        : current.avgDurationMin - previous.avgDurationMin,
    // 统计页主口径：总睡眠均值差（含午休）
    total:
      current.avgTotalMin === null || previous.avgTotalMin === null
        ? null
        : current.avgTotalMin - previous.avgTotalMin
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

function clockText(minutes) {
  if (minutes === null || minutes === undefined) return '--:--'
  const m = T.wrapMinutes(minutes)
  return T.pad2(Math.floor(m / 60)) + ':' + T.pad2(m % 60)
}

/**
 * 本周结构化事实（统计页主内容）。
 * 与旧 localFact 的区别：不再锁“满 3 天”，只要本周有记录就给出可读结果；
 * 对比项在“上周无记录”时明确说无法对比，而不是整块空白。
 */
function factsOf(records, now) {
  const w = weekly(records, now)
  const cur = w.current
  if (!cur.count) return { count: 0, has: false, items: [] }

  const bounds = weekBounds(now)
  const list = completedList(records).filter((r) => {
    const ts = T.parseDateKey(r.day)
    return ts >= bounds.start && ts < bounds.end
  })
  const delta = w.delta.total
  const durationNote =
    delta === null
      ? '上周没有记录，暂时无法对比'
      : delta === 0
        ? '与上周持平'
        : delta > 0
          ? '比上周多 ' + durationText(delta)
          : '比上周少 ' + durationText(-delta)

  const items = [
    {
      key: 'duration',
      label: '平均睡眠',
      value: durationText(cur.avgTotalMin || 0),
      note: durationNote
    },
    {
      key: 'schedule',
      label: '平均入睡',
      value: clockText(cur.avgBedMin),
      note:
        cur.afterMidnightDays > 0
          ? '有 ' + cur.afterMidnightDays + ' 天在 0 点后入睡'
          : '没有 0 点后入睡的记录'
    },
    {
      key: 'record',
      label: '记录',
      value: cur.count + ' 天 · 连续 ' + w.streak + ' 天',
      note:
        list.length > 1
          ? '最短 ' + durationText(cur.shortestMin) + ' · 最长 ' + durationText(cur.longestMin)
          : '再记录 1 天可看最短与最长'
    }
  ]

  return { count: cur.count, has: true, items, compare: delta !== null }
}

/** 紧凑时长：3h39 / 1h / 45m；用于 4 列指标卡 */
function compactDuration(minutes) {
  const total = Math.max(0, Math.round(minutes || 0))
  if (!total) return '--'
  const h = Math.floor(total / 60)
  if (!h) return total + 'm'
  const m = total % 60
  return m ? h + 'h' + T.pad2(m) : h + 'h'
}

function deltaAmount(minutes) {
  const abs = Math.abs(Math.round(minutes || 0))
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return h ? (m ? h + 'h' + T.pad2(m) : h + 'h') : m + ' 分'
}

// 统计页的「常见睡眠时长」参照：7.5–8 小时，只做事实陈述，不评价好坏
const REFERENCE_LOW_MIN = 7.5 * 60
const REFERENCE_HIGH_MIN = 8 * 60

function durationNoteOf(cur) {
  const total = cur.avgTotalMin || 0
  let note
  if (total < REFERENCE_LOW_MIN) {
    note = '本周平均比常见 7.5–8 小时少 ' + durationText(REFERENCE_LOW_MIN - total)
  } else if (total > REFERENCE_HIGH_MIN) {
    note = '本周平均比常见 7.5–8 小时多 ' + durationText(total - REFERENCE_HIGH_MIN)
  } else {
    note = '本周平均在常见 7.5–8 小时内'
  }
  // 样本不足时仍给事实陈述，但明确标注“按已记录天数算”，并引导补记
  const hint =
    cur.count < 3 ? '按已记录的 ' + cur.count + ' 天算，补记后会更接近真实' : ''
  return { note, hint }
}

/**
 * 统计页首屏的 3 个核心指标：平均睡眠 / 平均入睡 / 平均起床。
 * 每项只给「大数字 + 短标签 + 一行变化」，细节事实放在点击后的 detail 里。
 */
function metricsOf(records, now) {
  const w = weekly(records, now)
  const cur = w.current
  if (!cur.count) {
    return {
      has: false,
      count: 0,
      streak: 0,
      metrics: [],
      durationNote: '',
      durationHint: ''
    }
  }

  const prev = w.previous
  const d = w.delta
  const total = cur.avgTotalMin || 0
  const reference = durationNoteOf(cur)

  const clockCompare = (diff) => {
    if (diff === null) return '上周没有记录，暂时无法对比'
    if (diff === 0) return '与上周持平'
    return '比上周' + (diff > 0 ? '晚 ' : '早 ') + durationText(Math.abs(diff))
  }

  const metrics = [
    {
      key: 'duration',
      label: '平均睡眠',
      value: compactDuration(total),
      sub: d.total === null ? '' : d.total === 0 ? '持平' : (d.total > 0 ? '多 ' : '少 ') + deltaAmount(d.total),
      detail: [
        '本周 ' + cur.count + ' 天平均 ' + durationText(total) + '，含午休与间断段',
        reference.note,
        cur.longestMin === cur.shortestMin
          ? '每天都是 ' + durationText(cur.longestMin)
          : '最长 ' + durationText(cur.longestMin) + ' · 最短 ' + durationText(cur.shortestMin)
      ]
    },
    {
      key: 'bed',
      label: '平均入睡',
      value: clockText(cur.avgBedMin),
      sub: d.bed === null ? '' : d.bed === 0 ? '持平' : (d.bed > 0 ? '晚 ' : '早 ') + deltaAmount(d.bed),
      detail: [
        '本周 ' + cur.count + ' 天平均 ' + clockText(cur.avgBedMin) + ' 入睡',
        clockCompare(d.bed),
        (cur.afterMidnightDays > 0
          ? '有 ' + cur.afterMidnightDays + ' 天在 0 点后入睡'
          : '没有 0 点后入睡的记录') + ' · 按醒来日归档'
      ]
    },
    {
      key: 'wake',
      label: '平均起床',
      value: clockText(cur.avgWakeMin),
      sub: d.wake === null ? '' : d.wake === 0 ? '持平' : (d.wake > 0 ? '晚 ' : '早 ') + deltaAmount(d.wake),
      detail: [
        '本周 ' + cur.count + ' 天平均 ' + clockText(cur.avgWakeMin) + ' 起床（主睡眠）',
        clockCompare(d.wake),
        '这是你记录起床的时刻，不是闹钟'
      ]
    }
  ]

  return {
    has: true,
    count: cur.count,
    streak: w.streak,
    metrics,
    durationNote: reference.note,
    durationHint: reference.hint
  }
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
 * level: -1 占位, 0 未打卡, 1-4 时长分级（heatLevelOf，总睡眠口径）
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
    const minutes = record ? totalDurationOf(record) : 0
    if (minutes) marked += 1
    cells.push({
      key: day,
      level: heatLevelOf(minutes),
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

/**
 * 当月日历：7 列（周一起），格内可直接显示日号与时长。
 * 比横向热力图更适合手指点选：每格 ≥ 88rpx，且默认只画当月，不靠横向滚动。
 */
function calendarCells(records, now, monthOffset, partialDay) {
  const offset = Number(monthOffset) || 0
  const base = new Date(now)
  const first = new Date(base.getFullYear(), base.getMonth() + offset, 1)
  const year = first.getFullYear()
  const month = first.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const lead = (first.getDay() + 6) % 7
  const todayKey = T.dateKey(T.startOfDay(now))
  const cells = []

  for (let i = 0; i < lead; i += 1) {
    cells.push({ key: 'pad-head-' + i, pad: true, day: '', level: 0 })
  }

  let marked = 0
  for (let d = 1; d <= daysInMonth; d += 1) {
    const ts = new Date(year, month, d).getTime()
    const day = T.dateKey(ts)
    const record = records ? records[day] : null
    const total = record ? totalDurationOf(record) : 0
    const night = record ? durationOf(record) : 0
    if (total) marked += 1
    cells.push({
      key: day,
      pad: false,
      day,
      dayNum: d,
      has: total > 0,
      durationMin: total,
      nightMin: night,
      napMin: Math.max(0, total - night),
      bedMin: record && record.bedAt ? T.minutesOf(record.bedAt) : null,
      wakeMin: record && record.wakeAt ? T.minutesOf(record.wakeAt) : null,
      level: heatLevelOf(total),
      // 进行中的一段：今天即使已有完成记录也要标出来（午休/第二段）
      partial: !!partialDay && day === partialDay,
      isToday: day === todayKey,
      future: day > todayKey
    })
  }

  while (cells.length % 7 !== 0) {
    cells.push({ key: 'pad-tail-' + cells.length, pad: true, day: '', level: 0 })
  }

  return {
    cells,
    rows: cells.length / 7,
    marked,
    monthKey: year + '-' + T.pad2(month + 1),
    monthLabel: year + '年' + (month + 1) + '月',
    firstDayNum: 1,
    daysInMonth
  }
}

/** 某个月份的标题，供“上月/下月”按钮使用 */
function monthLabelOf(now, monthOffset) {
  const base = new Date(now)
  const first = new Date(base.getFullYear(), base.getMonth() + (Number(monthOffset) || 0), 1)
  return first.getFullYear() + '年' + (first.getMonth() + 1) + '月'
}

/**
 * 连续 N 个月的月历（旧→新），用于 3/6/12 个月视图。
 * 与单月视图共用 calendarCells，只是格子更紧凑、横向滑动查看。
 */
function calendarMonths(records, now, spanMonths, partialDay) {
  const span = Math.max(2, Math.min(12, Number(spanMonths) || 3))
  const months = []
  for (let i = span - 1; i >= 0; i -= 1) {
    const cal = calendarCells(records, now, -i, partialDay)
    months.push({
      key: cal.monthKey,
      label: Number(cal.monthKey.slice(5, 7)) + '月',
      title: cal.monthLabel,
      // 长周期只渲染状态，不携带详情字段，控制一次 setData 的体积
      cells: cal.cells.map((cell) => ({
        key: cell.key,
        pad: cell.pad,
        day: cell.day,
        dayNum: cell.dayNum,
        level: cell.level,
        isToday: cell.isToday,
        future: cell.future,
        partial: cell.partial
      })),
      marked: cal.marked
    })
  }
  return months
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
  totalDurationOf,
  sessionsOf,
  levelOf,
  heatLevelOf,
  digest,
  weekly,
  metricsOf,
  factsOf,
  localFact,
  factSignature,
  weekBounds,
  inRange,
  canStartNewSleep,
  streakDays,
  heatmapCells,
  calendarCells,
  calendarMonths,
  monthLabelOf,
  monthsSpan,
  summaryPayload
}
