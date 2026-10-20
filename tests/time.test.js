const test = require('node:test')
const assert = require('node:assert/strict')

const T = require('../miniprogram/utils/time')

function local(year, month, day, hour, minute) {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

test('睡眠日以中午 12 点为界', () => {
  assert.equal(T.sleepDayOf(local(2026, 10, 17, 23, 40)), '2026-10-17')
  assert.equal(T.sleepDayOf(local(2026, 10, 18, 1, 30)), '2026-10-17')
  assert.equal(T.sleepDayOf(local(2026, 10, 18, 8, 0)), '2026-10-17')
  assert.equal(T.sleepDayOf(local(2026, 10, 18, 13, 0)), '2026-10-18')
})

test('时间轮 scroll-top 吸附到最近循环行', () => {
  // 中间周期的 07:30：60 分钟周期 * 1 周期 + 7 点 + 30 分
  assert.deepEqual(T.snapWheelTop(42 * 30, 42, 12), { raw: 30, index: 6 })
  assert.deepEqual(T.snapWheelTop(42 * 72, 42, 60), { raw: 72, index: 12 })
  // 首尾周期折回单周期索引
  assert.equal(T.snapWheelTop(-10, 42, 12).index, 0)
  assert.equal(T.snapWheelTop(42 * 35, 42, 12).index, 11)
})

test('跨午夜的平均时间用圆均值', () => {
  assert.equal(T.circularMeanMinutes([23 * 60 + 50, 10]), 0)
  assert.equal(T.circularMeanMinutes([23 * 60 + 50, 23 * 60 + 55, 20]), 2)
  assert.equal(T.circularMeanMinutes([]), null)
})

test('时间差取最短方向', () => {
  assert.equal(T.clockDelta(20, 23 * 60 + 50), 30)
  assert.equal(T.clockDelta(23 * 60 + 50, 20), -30)
  assert.equal(T.clockDelta(600, 600), 0)
})

test('周一为一周起点', () => {
  assert.equal(T.dateKey(T.startOfWeek(local(2026, 10, 18, 10, 0))), '2026-10-12')
  assert.equal(T.dateKey(T.startOfWeek(local(2026, 10, 12, 0, 5))), '2026-10-12')
  assert.equal(T.dateKey(T.addDays(local(2026, 10, 31, 9, 0), 1)), '2026-11-01')
})
