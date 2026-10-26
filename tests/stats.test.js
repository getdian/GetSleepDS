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
    updatedAt: wakeAt
  }
}

const RECORDS = {
  '2026-10-15': record('2026-10-15', local(2026, 10, 15, 23, 50), local(2026, 10, 16, 7, 0)),
  '2026-10-16': record('2026-10-16', local(2026, 10, 16, 23, 30), local(2026, 10, 17, 6, 30)),
  '2026-10-17': record('2026-10-17', local(2026, 10, 17, 23, 55), local(2026, 10, 18, 7, 30))
}

test('圆均值无解时不拼病句：说“算不出平均”，而不是“平均 --:-- 上床”', () => {
  // 同周两天恰好相隔 12 小时：向量抵消，circularMeanMinutes 返回 null
  const records = {
    '2026-10-19': record('2026-10-19', local(2026, 10, 19, 0, 0), local(2026, 10, 19, 8, 0)),
    '2026-10-20': record('2026-10-20', local(2026, 10, 20, 12, 0), local(2026, 10, 20, 20, 0))
  }
  const now = local(2026, 10, 21, 12, 0)

  const metrics = S.metricsOf(records, now)
  const bed = metrics.metrics.filter((item) => item.key === 'bed')[0]
  assert.equal(bed.value, '--:--')
  assert.match(bed.sub, /算不出平均/)
  assert.match(bed.detail[0], /算不出平均/)
  assert.ok(!/平均 --:--/.test(bed.detail[0]), '不能出现“平均 --:-- 上床”')
  assert.ok(!/平均 --:--/.test(bed.detail.join(' ')))

  const wake = metrics.metrics.filter((item) => item.key === 'wake')[0]
  assert.match(wake.detail[0], /算不出平均/)
  assert.ok(!/平均 --:--/.test(wake.detail.join(' ')))

  const facts = S.factsOf(records, now)
  const schedule = facts.items.filter((item) => item.key === 'schedule')[0]
  assert.match(schedule.note, /算不出平均上床/)
  assert.ok(!/平均 --:--/.test(schedule.note))
})

// 周日早上 8 点：睡眠日仍是 10-17
const NOW = local(2026, 10, 18, 8, 0)

test('只统计已完成的记录', () => {
  const mixed = Object.assign({}, RECORDS, {
    '2026-10-14': { day: '2026-10-14', bedAt: local(2026, 10, 14, 23, 0), wakeAt: null }
  })
  assert.equal(S.completedList(mixed).length, 3)
})

test('本周均值与连续天数', () => {
  const weekly = S.weekly(RECORDS, NOW)

  assert.equal(weekly.current.count, 3)
  assert.equal(weekly.current.avgBedMin, 23 * 60 + 45)
  assert.equal(weekly.current.avgDurationMin, 435)
  assert.equal(weekly.delta.bed, null)
  assert.equal(weekly.streak, 3)
})

test('上周对比取同期：周一不拿本周 1 天比上周 7 天', () => {
  const now = local(2026, 10, 19, 10, 0) // 周一 10:00
  const records = {
    '2026-10-19': record('2026-10-19', local(2026, 10, 18, 23, 0), local(2026, 10, 19, 7, 0)),
    '2026-10-12': record('2026-10-12', local(2026, 10, 11, 23, 0), local(2026, 10, 12, 7, 0)),
    '2026-10-13': record('2026-10-13', local(2026, 10, 12, 23, 0), local(2026, 10, 13, 7, 0)),
    '2026-10-14': record('2026-10-14', local(2026, 10, 13, 23, 0), local(2026, 10, 14, 7, 0)),
    '2026-10-15': record('2026-10-15', local(2026, 10, 14, 23, 0), local(2026, 10, 15, 7, 0)),
    '2026-10-16': record('2026-10-16', local(2026, 10, 15, 23, 0), local(2026, 10, 16, 7, 0))
  }
  const w = S.weekly(records, now)
  assert.equal(w.current.count, 1)
  assert.equal(w.previous.count, 1, '上一周只取同期（周一），不是完整 7 天')

  const metrics = S.metricsOf(records, now).metrics
  assert.match(metrics[0].sub, /上周同期/)
  assert.match(metrics[1].detail[1], /上周同期/)
})

test('本地事实回顾：满 3 条生成模板文案，不出现建议类词', () => {
  const fact = S.localFact(RECORDS, NOW)
  assert.equal(fact.available, true)
  assert.match(fact.text, /本周你记录了 3 次睡眠/)
  assert.equal(/建议|应该|改善|治疗|健康|质量/.test(fact.text), false)
})

test('本地事实回顾：不足 3 条不生成', () => {
  const two = { '2026-10-15': RECORDS['2026-10-15'], '2026-10-16': RECORDS['2026-10-16'] }
  const fact = S.localFact(two, NOW)
  assert.equal(fact.available, false)
  assert.equal(fact.text, '')
})

test('热力图按周对齐且能标出打卡天数', () => {
  const heat = S.heatmapCells(RECORDS, NOW, 30, '2026-10-18')

  assert.equal(heat.cells.length % 7, 0)
  assert.equal(heat.marked, 3)
  assert.equal(heat.cells.filter((cell) => cell.level > 0).length, 3)
  assert.equal(heat.startKey, '2026-09-19')
  assert.equal(heat.endKey, '2026-10-18')
  // 2026-09-19 是周六，前面要补 5 个占位
  assert.equal(heat.cells.filter((cell) => cell.pad).length, 5)
  assert.equal(heat.colCount, 5)
  assert.ok(heat.months.length >= 2)
  const today = heat.cells.find((cell) => cell.day === '2026-10-18')
  assert.equal(today.isToday, true)
  assert.equal(today.partial, true)
})

test('时长分级边界', () => {
  assert.equal(S.levelOf(0), 0)
  assert.equal(S.levelOf(359), 1)
  assert.equal(S.levelOf(360), 2)
  assert.equal(S.levelOf(420), 3)
  assert.equal(S.levelOf(480), 4)
  assert.equal(S.levelOf(540), 5)
  assert.equal(S.levelOf(600), 5)
})

test('没有记录时不报错', () => {
  const weekly = S.weekly({}, NOW)
  assert.equal(weekly.current.count, 0)
  assert.equal(weekly.current.avgBedMin, null)
  assert.equal(weekly.streak, 0)
})

test('完成态可追加多段：跨天直接允许，同天满 3 小时允许', () => {
  // 周二 13:00-14:00 小睡
  const bed = local(2026, 10, 20, 13, 0)
  const wake = local(2026, 10, 20, 14, 0)
  const record = { day: '2026-10-20', bedAt: bed, wakeAt: wake, durationMin: 60 }
  // 周三凌晨已跨天，允许追加
  assert.equal(S.canStartNewSleep(record, local(2026, 10, 21, 0, 30), '2026-10-21'), true)
  // 同日刚醒 1 小时，不鼓励马上再记
  assert.equal(S.canStartNewSleep(record, local(2026, 10, 20, 15, 0), '2026-10-20'), false)
  // 同日已过 3 小时，可追加午休/第二段
  assert.equal(S.canStartNewSleep(record, local(2026, 10, 20, 17, 1), '2026-10-20'), true)
})

test('事实回顾指纹会随同周新增记录变化', () => {
  const weekly = S.weekly(RECORDS, NOW)
  const first = S.factSignature(weekly)
  const more = Object.assign({}, RECORDS, {
    '2026-10-18': record('2026-10-18', local(2026, 10, 18, 23, 0), local(2026, 10, 19, 7, 0))
  })
  const second = S.factSignature(S.weekly(more, NOW))
  assert.notEqual(first, second)
})

test('热力图未来板位带 future 标记', () => {
  const now = local(2026, 10, 19, 12, 0)
  const span = S.monthsSpan(now)
  const heat = S.heatmapCells({}, now, span.days, '', span.endOffsetDays)
  const future = heat.cells.filter((cell) => cell.future)
  assert.ok(future.length > 0)
  assert.ok(future.every((cell) => cell.day > '2026-10-19'))
})

test('总结请求只带最近 14 天', () => {
  const payload = S.summaryPayload(RECORDS, NOW, 14)
  assert.equal(payload.length, 3)
  assert.deepEqual(Object.keys(payload[0]).sort(), ['bedAt', 'day', 'updatedAt', 'wakeAt'])
})

test('月对齐图板：2026-10-19 覆盖 8/9/10/11 月，含往后 3 周板位', () => {
  const now = local(2026, 10, 19, 12, 0) // 周一
  const span = S.monthsSpan(now)
  // 8月1日 ~ 11月15日（今天+21 天所在周的周日），未来板位 27 天
  assert.equal(span.days, 107)
  assert.equal(span.endOffsetDays, 27)
  const heat = S.heatmapCells({}, now, span.days, '', span.endOffsetDays)
  assert.deepEqual(
    heat.months.map((m) => m.label),
    ['8月', '9月', '10月', '11月']
  )
  // 2 个 lead 补位（8月1日是周三）+ 107 天 = 109 → 16 列
  assert.equal(heat.colCount, 16)
  // 最后一格是 11-15（未来板位，无记录为灰）
  const last = heat.cells[heat.cells.length - 1]
  assert.equal(last.day, '2026-11-15')
  assert.equal(last.level, 0)
  // 今天（10-19）在板内且有高亮标记
  const todayCell = heat.cells.find((c) => c.day === '2026-10-19')
  assert.ok(todayCell && todayCell.isToday)
})

test('月对齐图板：今天在月中时同样覆盖前 2 个整月', () => {
  const now = local(2026, 10, 7, 12, 0) // 周三
  const span = S.monthsSpan(now)
  const heat = S.heatmapCells({}, now, span.days, '', span.endOffsetDays)
  // 末列从 10-31 开始，11-1 不独占一列，故无 11 月标签
  assert.deepEqual(
    heat.months.map((m) => m.label),
    ['8月', '9月', '10月']
  )
  const todayCell = heat.cells.find((c) => c.day === '2026-10-07')
  assert.ok(todayCell && todayCell.isToday)
})

test('月对齐图板：3 个月前（当前 10 月即 7 月 1 日）起，11 月为未来占位', () => {
  const now = local(2026, 10, 20, 12, 0) // 周二
  const span = S.monthsSpan(now, 3)
  const heat = S.heatmapCells({}, now, span.days, '', span.endOffsetDays)

  // 7 月 1 日 ~ 11 月 15 日，恰好 20 列铺满
  assert.equal(heat.startKey, '2026-07-01')
  assert.equal(heat.endKey, '2026-11-15')
  assert.equal(heat.colCount, 20)
  assert.equal(heat.cells.length, 140)
  // 7/1 是周三，前面补 2 个占位
  assert.equal(heat.cells.filter((cell) => cell.pad).length, 2)
  assert.deepEqual(
    heat.months.map((m) => m.label),
    ['7月', '8月', '9月', '10月', '11月']
  )

  // 11 月整月都是未来板位（今天 10-20 之后）
  const future = heat.cells.filter((cell) => cell.future)
  assert.equal(future.length, 26)
  assert.ok(future.some((cell) => cell.day.indexOf('2026-11') === 0))
  const today = heat.cells.find((cell) => cell.day === '2026-10-20')
  assert.equal(today.isToday, true)
  assert.equal(today.future, false)
})

test('月对齐图板：起点恒为 3 个月前的 1 号（跨年同样成立）', () => {
  const jan = local(2027, 1, 15, 9, 0)
  const janSpan = S.monthsSpan(jan, 3)
  const janHeat = S.heatmapCells({}, jan, janSpan.days, '', janSpan.endOffsetDays)
  assert.equal(janHeat.startKey, '2026-10-01')

  const mar = local(2027, 3, 1, 9, 0)
  const marSpan = S.monthsSpan(mar, 3)
  const marHeat = S.heatmapCells({}, mar, marSpan.days, '', marSpan.endOffsetDays)
  assert.equal(marHeat.startKey, '2026-12-01')
})

// 指标周期口径：默认本周，本周 0 天时回退最近 7 天 → 全部记录
test('周一还没打卡：回退最近 7 天，不把首屏做成空白', () => {
  const now = local(2026, 10, 26, 9, 0) // 周一 09:00，本周必然 0 天
  const records = {
    '2026-10-25': record('2026-10-25', local(2026, 10, 24, 23, 0), local(2026, 10, 25, 7, 0)),
    '2026-10-24': record('2026-10-24', local(2026, 10, 23, 23, 0), local(2026, 10, 24, 7, 0))
  }
  assert.equal(S.weekly(records, now).current.count, 0, '本周口径仍是 0 天')

  const result = S.metricsOf(records, now)
  assert.equal(result.has, true, '有历史记录时首屏不应该空白')
  assert.equal(result.count, 2)
  assert.equal(result.periodKey, 'last_7')
  assert.equal(result.isFallback, true)
  assert.equal(result.periodLabel, '最近 7 天')
  assert.equal(result.rangeText, '10.20–10.26')
  assert.match(result.metrics[0].detail[0], /^最近 7 天共 2 天/)
  assert.ok(!/本周/.test(result.metrics[0].detail[0]), '回退后不能再说本周')
})

test('最近 7 天的对比基线是前 7 天，不是上周同期', () => {
  const now = local(2026, 10, 26, 9, 0)
  const records = {
    '2026-10-20': record('2026-10-20', local(2026, 10, 19, 23, 0), local(2026, 10, 20, 5, 0)), // 6h
    '2026-10-13': record('2026-10-13', local(2026, 10, 12, 23, 0), local(2026, 10, 13, 7, 0)) // 8h
  }
  const result = S.metricsOf(records, now)
  assert.equal(result.periodKey, 'last_7')
  assert.equal(result.baselineLabel, '前 7 天')
  assert.equal(result.metrics[0].value, '6h')
  assert.equal(result.metrics[0].sub, '比前 7 天少 2h')
})

test('本周有记录时仍按本周口径，行为与改动前一致', () => {
  const result = S.metricsOf(RECORDS, NOW)
  assert.equal(result.periodKey, 'this_week')
  assert.equal(result.isFallback, false)
  assert.equal(result.periodLabel, '本周')
  assert.equal(result.rangeText, '10.12–10.18')
  assert.equal(result.count, 3)
  assert.match(result.metrics[0].detail[0], /^本周 3 天平均/)
})

test('最近 7 天也没有记录时回退全部记录，且不编造对比', () => {
  const now = local(2026, 10, 26, 9, 0)
  const records = {
    // 一个月前的一条：本周与最近 7 天都没有
    '2026-09-01': record('2026-09-01', local(2026, 9, 1, 9, 0), local(2026, 9, 1, 17, 0))
  }
  const result = S.metricsOf(records, now)
  assert.equal(result.periodKey, 'all')
  assert.equal(result.isFallback, true)
  assert.equal(result.baselineLabel, '')
  assert.equal(result.rangeText, '09.01–10.26')
  // 三项副标都为空：走的是同一个 subOf，不能只挡住 duration 一项
  result.metrics.forEach((item) => assert.equal(item.sub, '', item.key + ' 不应有对比副标'))
  assert.match(result.metrics[0].detail[1], /全部记录平均/)
  assert.match(result.metrics[1].detail[1], /没有可对比的上一段/)
})

test('显式指定周期时不算回退（后续做周期切换的接口）', () => {
  const result = S.metricsOf(RECORDS, NOW, { period: 'last_7' })
  assert.equal(result.periodKey, 'last_7')
  assert.equal(result.periodLabel, '最近 7 天')
  assert.equal(result.baselineLabel, '前 7 天')
  assert.equal(result.isFallback, false, '显式指定不是自动回退，页面不该加注脚')
  assert.ok(result.count > 0)
})

test('区间文案跨年正确：本周起点在去年 12 月', () => {
  // 2027-01-02 是周六，本周起点 2026-12-28（周一）
  const now = local(2027, 1, 2, 9, 0)
  const records = {
    '2026-12-29': record('2026-12-29', local(2026, 12, 28, 23, 0), local(2026, 12, 29, 7, 0))
  }
  const result = S.metricsOf(records, now)
  assert.equal(result.periodKey, 'this_week')
  assert.equal(result.rangeText, '12.28–01.03')
})
