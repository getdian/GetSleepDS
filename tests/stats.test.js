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

test('总结请求只带最近 14 天', () => {
  const payload = S.summaryPayload(RECORDS, NOW, 14)
  assert.equal(payload.length, 3)
  assert.deepEqual(Object.keys(payload[0]).sort(), ['bedAt', 'day', 'updatedAt', 'wakeAt'])
})
