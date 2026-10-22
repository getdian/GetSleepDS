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

test('2 份循环在首尾缓冲行无缝回中，1 分钟粒度仍连续', () => {
  // 分钟：0 行回到第二份的 60 行（同为 00 分），119 行回到第一份的 59 行
  assert.equal(T.recenterWheelRow(0, 60, 2, 5), 60)
  assert.equal(T.recenterWheelRow(119, 60, 2, 5), 59)
  assert.equal(T.recenterWheelRow(60, 60, 2, 5), 60)
  // 小时：首尾同理
  assert.equal(T.recenterWheelRow(0, 12, 2, 5), 12)
  assert.equal(T.recenterWheelRow(23, 12, 2, 5), 11)
  // 初始选中优先放在上下都有余量的那一份
  assert.equal(T.pickWheelRow(0, 60, 2, 5), 60)
  assert.equal(T.pickWheelRow(59, 60, 2, 5), 59)
  assert.equal(T.pickWheelRow(28, 60, 2, 5), 88)
  assert.equal(T.snapWheelTop(42 * 119, 42, 60, 2).raw, 119)
})

test('任意分钟/小时初始位置都留有上下滚动余量', () => {
  for (let m = 0; m < 60; m += 1) {
    const raw = T.pickWheelRow(m, 60, 2, 5)
    assert.equal(raw % 60, m)
    assert.ok(raw >= 5 && raw < 115, 'minute ' + m + ' -> ' + raw)
  }
  for (let h = 0; h < 12; h += 1) {
    const raw = T.pickWheelRow(h, 12, 2, 5)
    assert.equal(raw % 12, h)
    assert.ok(raw >= 5 && raw < 19, 'hour ' + h + ' -> ' + raw)
  }
})

test('归档日固定北京时间：UTC 时间戳换算不随设备时区变', () => {
  // 北京时间 2026-10-22 01:30 / 23:59 / 次日 00:00
  assert.equal(T.calendarDayKey(Date.UTC(2026, 9, 21, 17, 30)), '2026-10-22')
  assert.equal(T.calendarDayKey(Date.UTC(2026, 9, 22, 15, 59)), '2026-10-22')
  assert.equal(T.calendarDayKey(Date.UTC(2026, 9, 22, 16, 0)), '2026-10-23')
  // 睡眠日（v1 兼容）= 入睡时刻往前推 12 小时：北京时间 10-22 01:00 入睡 → 10-21
  assert.equal(T.sleepDayOf(Date.UTC(2026, 9, 21, 17, 0)), '2026-10-21')
  // 北京时间 10-22 20:00 入睡 → 10-22
  assert.equal(T.sleepDayOf(Date.UTC(2026, 9, 22, 12, 0)), '2026-10-22')
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
