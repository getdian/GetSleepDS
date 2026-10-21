const test = require('node:test')
const assert = require('node:assert/strict')

const S = require('../miniprogram/utils/stats')

function local(year, month, day, hour, minute) {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

function record(day, bedAt, wakeAt) {
  return {
    day,
    bedAt,
    wakeAt,
    durationMin: Math.round((wakeAt - bedAt) / 60000),
    nightDurationMin: Math.round((wakeAt - bedAt) / 60000),
    totalDurationMin: Math.round((wakeAt - bedAt) / 60000),
    updatedAt: wakeAt
  }
}

function sessionRecord(day, bedAt, wakeAt, extraSessions) {
  const all = [{ startAt: bedAt, endAt: wakeAt }].concat(extraSessions || [])
  const total = all.reduce((sum, item) => sum + Math.round((item.endAt - item.startAt) / 60000), 0)
  return {
    day,
    bedAt,
    wakeAt,
    durationMin: Math.round((wakeAt - bedAt) / 60000),
    nightDurationMin: Math.round((wakeAt - bedAt) / 60000),
    totalDurationMin: total,
    sessions: all.map((item) => ({
      id: 's-' + item.startAt,
      startAt: item.startAt,
      endAt: item.endAt
    })),
    updatedAt: wakeAt
  }
}

// 2026-10-21 周三 18:50
const NOW = local(2026, 10, 21, 18, 50)

test('日历 4 档色阶边界：短睡区间拆开，长睡不塌档', () => {
  assert.equal(S.heatLevelOf(0), 0)
  assert.equal(S.heatLevelOf(239), 1)
  assert.equal(S.heatLevelOf(240), 2)
  assert.equal(S.heatLevelOf(359), 2)
  assert.equal(S.heatLevelOf(360), 3)
  assert.equal(S.heatLevelOf(479), 3)
  assert.equal(S.heatLevelOf(480), 4)
  assert.equal(S.heatLevelOf(600), 4)
})

test('当月日历：周一起、补齐整行、今天与未来标记', () => {
  const records = {
    '2026-10-20': record('2026-10-20', local(2026, 10, 19, 23, 41), local(2026, 10, 20, 3, 20))
  }
  const cal = S.calendarCells(records, NOW, 0)
  // 2026-10-01 是周四：前补 3 格；3 + 31 = 34，再补 1 格凑满 5 行
  assert.equal(cal.cells.filter((cell) => cell.pad).length, 4)
  assert.equal(cal.cells.length, 35)
  assert.equal(cal.rows, 5)
  assert.equal(cal.monthLabel, '2026年10月')
  const first = cal.cells[3]
  assert.equal(first.day, '2026-10-01')
  const today = cal.cells.find((cell) => cell.day === '2026-10-21')
  assert.equal(today.isToday, true)
  assert.equal(today.future, false)
  const future = cal.cells.find((cell) => cell.day === '2026-10-22')
  assert.equal(future.future, true)
  const marked = cal.cells.find((cell) => cell.day === '2026-10-20')
  assert.equal(marked.has, true)
  assert.equal(marked.durationMin, 219)
  assert.equal(marked.level, 1)
  assert.equal(cal.marked, 1)
})

test('日历支持跨年切月，2 月天数按真实年份', () => {
  const jan = local(2027, 1, 15, 9, 0)
  const dec = S.calendarCells({}, jan, -1)
  assert.equal(dec.monthLabel, '2026年12月')
  assert.equal(dec.daysInMonth, 31)

  const feb2026 = S.calendarCells({}, local(2026, 2, 10, 9, 0), 0)
  assert.equal(feb2026.daysInMonth, 28)
  const feb2028 = S.calendarCells({}, local(2028, 2, 10, 9, 0), 0)
  assert.equal(feb2028.daysInMonth, 29)

  assert.equal(S.monthLabelOf(jan, -12), '2026年1月')
  assert.equal(S.monthLabelOf(jan, 1), '2027年2月')
})

test('结构化事实：0 天不生成，1 天也能给出可读结果', () => {
  assert.equal(S.factsOf({}, NOW).has, false)

  const one = {
    '2026-10-20': record('2026-10-20', local(2026, 10, 19, 23, 41), local(2026, 10, 20, 3, 20))
  }
  const facts = S.factsOf(one, NOW)
  assert.equal(facts.has, true)
  assert.equal(facts.count, 1)
  assert.equal(facts.items.length, 3)
  assert.equal(facts.items[0].value, '3 小时 39 分')
  assert.equal(facts.items[1].value, '23:41')
  assert.match(facts.items[2].value, /1 天 · 连续 1 天/)
  // 上周没有记录时明确说明不可对比，而不是空白
  assert.match(facts.items[0].note, /上周没有记录/)
})

test('结构化事实：总睡眠含午休，且与上周对比按总睡眠算', () => {
  const records = {
    // 本周：夜间 7h + 午休 40m = 7h40m
    '2026-10-20': sessionRecord(
      '2026-10-20',
      local(2026, 10, 19, 23, 0),
      local(2026, 10, 20, 6, 0),
      [{ startAt: local(2026, 10, 20, 13, 0), endAt: local(2026, 10, 20, 13, 40) }]
    ),
    // 上周：6h
    '2026-10-13': record('2026-10-13', local(2026, 10, 12, 23, 30), local(2026, 10, 13, 5, 30))
  }
  const facts = S.factsOf(records, NOW)
  assert.equal(facts.compare, true)
  assert.equal(facts.items[0].value, '7 小时 40 分')
  assert.match(facts.items[0].note, /比上周多 1 小时 40 分/)
})

test('3 列核心指标：大数字 + 短标签 + 一行变化，说明卡固定 3 行', () => {
  const records = {
    '2026-10-20': record('2026-10-20', local(2026, 10, 19, 23, 41), local(2026, 10, 20, 3, 20)),
    '2026-10-21': record('2026-10-21', local(2026, 10, 20, 23, 41), local(2026, 10, 21, 3, 20)),
    // 上周同样 3h39，用于验证持平文案
    '2026-10-14': record('2026-10-14', local(2026, 10, 13, 23, 41), local(2026, 10, 14, 3, 20)),
    '2026-10-15': record('2026-10-15', local(2026, 10, 14, 23, 41), local(2026, 10, 15, 3, 20))
  }
  const result = S.metricsOf(records, NOW)
  assert.equal(result.has, true)
  assert.deepEqual(
    result.metrics.map((item) => item.key),
    ['duration', 'bed', 'wake']
  )
  assert.equal(result.metrics[0].label, '平均睡眠')
  assert.equal(result.metrics[0].value, '3h39')
  assert.equal(result.metrics[0].sub, '持平')
  assert.equal(result.metrics[2].label, '平均起床')
  // 只记录 2 天：仍给常见区间陈述，但明确标注样本不足
  assert.match(result.durationNote, /比常见 7.5–8 小时少 3 小时 51 分/)
  assert.match(result.durationHint, /按已记录的 2 天算/)
  result.metrics.forEach((item) => {
    assert.equal(item.detail.length, 3)
    assert.ok(item.detail.every((line) => typeof line === 'string' && line.length > 0))
  })
  assert.match(result.metrics[1].detail[2], /按醒来日归档/)
  assert.match(result.metrics[2].detail[2], /不是闹钟/)
  assert.match(result.metrics[0].detail[2], /每天都是|最长/)
})

test('指标在 1 天记录时也给全 3 列；上周无记录不编造对比', () => {
  const one = {
    '2026-10-20': record('2026-10-20', local(2026, 10, 19, 23, 41), local(2026, 10, 20, 3, 20))
  }
  const result = S.metricsOf(one, NOW)
  assert.equal(result.has, true)
  assert.equal(result.metrics.length, 3)
  assert.equal(result.metrics[0].value, '3h39')
  assert.equal(result.metrics[0].sub, '')
  assert.match(result.metrics[0].detail[1], /比常见 7.5–8 小时少 3 小时 51 分/)
  assert.match(result.durationHint, /按已记录的 1 天算/)
  assert.equal(S.metricsOf({}, NOW).has, false)
})

test('满 3 天后按常见 7.5–8 小时给事实陈述', () => {
  const inRange = {
    '2026-10-19': record('2026-10-19', local(2026, 10, 18, 23, 0), local(2026, 10, 19, 6, 50)),
    '2026-10-20': record('2026-10-20', local(2026, 10, 19, 23, 0), local(2026, 10, 20, 6, 50)),
    '2026-10-21': record('2026-10-21', local(2026, 10, 20, 23, 0), local(2026, 10, 21, 6, 50))
  }
  assert.match(S.metricsOf(inRange, NOW).durationNote, /在常见 7.5–8 小时内/)

  const short = {
    '2026-10-19': record('2026-10-19', local(2026, 10, 18, 23, 0), local(2026, 10, 19, 5, 0)),
    '2026-10-20': record('2026-10-20', local(2026, 10, 19, 23, 0), local(2026, 10, 20, 5, 0)),
    '2026-10-21': record('2026-10-21', local(2026, 10, 20, 23, 0), local(2026, 10, 21, 5, 0))
  }
  assert.match(S.metricsOf(short, NOW).durationNote, /比常见 7.5–8 小时少 1 小时 30 分/)
  assert.equal(S.metricsOf(short, NOW).durationHint, '')
})

test('连续多月日历：数量、顺序、精简字段与跨年', () => {
  const three = S.calendarMonths({}, NOW, 3, '')
  assert.equal(three.length, 3)
  assert.equal(three[three.length - 1].key, '2026-10')
  assert.equal(three[0].key, '2026-08')
  // 长周期只带状态字段，控制一次 setData 的体积
  assert.equal('durationMin' in three[0].cells[0], false)

  const year = S.calendarMonths({}, NOW, 12, '')
  assert.equal(year.length, 12)
  assert.equal(year[0].key, '2025-11')

  const jan = local(2027, 1, 15, 9, 0)
  assert.deepEqual(
    S.calendarMonths({}, jan, 3, '').map((month) => month.key),
    ['2026-11', '2026-12', '2027-01']
  )
})

test('结构化事实不含评价/建议类禁词', () => {
  const records = {
    '2026-10-19': record('2026-10-19', local(2026, 10, 18, 23, 30), local(2026, 10, 19, 6, 30)),
    '2026-10-20': record('2026-10-20', local(2026, 10, 19, 23, 50), local(2026, 10, 20, 6, 10)),
    '2026-10-21': record('2026-10-21', local(2026, 10, 20, 23, 40), local(2026, 10, 21, 6, 20))
  }
  const text = JSON.stringify(S.factsOf(records, NOW))
  assert.equal(/建议|应该|必须|注意|尽量|改善|提升|治疗|疾病|诊断|评估|质量|健康/.test(text), false)
})
