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

test('07:30 起床 + 15 分钟入睡，推荐 23:45 / 01:15 / 02:45', () => {
  const now = local(2026, 10, 17, 20, 0)
  const plan = T.buildPlan(now, 7 * 60 + 30, 15)

  assert.equal(plan.rolled, false)
  assert.deepEqual(
    plan.slots.map((slot) => T.minutesOf(slot.at)),
    [23 * 60 + 45, 1 * 60 + 15, 2 * 60 + 45]
  )
  assert.equal(T.dateKey(plan.slots[2].at), '2026-10-18')
  assert.equal(plan.availableMin, 675)
  assert.equal(plan.cycles, 7)
  assert.equal(plan.remainder, 45)
})

test('凌晨 3:38 时推荐时间已过，自动滚动到明晚', () => {
  const now = local(2026, 10, 18, 3, 38)
  const plan = T.buildPlan(now, 7 * 60 + 30, 15)

  assert.equal(plan.rolled, true)
  assert.equal(T.dateKey(plan.nowWakeAt), '2026-10-18')
  assert.equal(plan.availableMin, 217)
  assert.equal(plan.cycles, 2)
  assert.equal(plan.remainder, 37)
  assert.equal(plan.slots[0].passed, false)
  assert.equal(T.dateKey(plan.slots[0].at), '2026-10-18')
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
