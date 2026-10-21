const test = require('node:test')
const assert = require('node:assert/strict')

const T = require('../miniprogram/utils/time')
const R = require('../miniprogram/utils/regularity')

function at(year, month, day, hour, minute) {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

function record(day, bedHour, bedMinute, wakeHour, wakeMinute) {
  const base = T.parseDateKey(day)
  const bedAt = T.clockTs(base, bedHour * 60 + bedMinute)
  let wakeAt = T.clockTs(base, wakeHour * 60 + wakeMinute)
  if (wakeAt <= bedAt) wakeAt += T.DAY_MS
  return { day, bedAt, wakeAt, durationMin: Math.round((wakeAt - bedAt) / 60000) }
}

test('近 7 天不足 4 晚时返回不足态', () => {
  const now = at(2026, 10, 21, 9, 0)
  const records = {
    '2026-10-20': record('2026-10-20', 23, 0, 7, 0),
    '2026-10-19': record('2026-10-19', 23, 30, 7, 10)
  }
  const result = R.analyze(records, now, 7)
  assert.equal(result.enough, false)
  assert.equal(result.count, 2)
})

test('跨午夜波动按圆周差计算，不把 23:50/00:10 算成 23 小时', () => {
  const now = at(2026, 10, 21, 9, 0)
  const records = {
    '2026-10-17': record('2026-10-17', 23, 50, 7, 0),
    '2026-10-18': record('2026-10-18', 0, 10, 7, 10),
    '2026-10-19': record('2026-10-19', 0, 0, 7, 5),
    '2026-10-20': record('2026-10-20', 23, 55, 7, 0)
  }
  const result = R.analyze(records, now, 7)
  assert.equal(result.enough, true)
  assert.equal(result.count, 4)
  assert.ok(result.bedSpreadMin <= 15, 'spread=' + result.bedSpreadMin)
  assert.equal(result.label, '较规律')
})
