const test = require('node:test')
const assert = require('node:assert/strict')

const T = require('../miniprogram/utils/time')
const P = require('../miniprogram/utils/plan')

function local(year, month, day, hour, minute) {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

test('07:30 起床 + 15 分钟入睡，倒推 23:45 / 01:15 / 02:45', () => {
  const now = local(2026, 10, 17, 20, 0)
  const plan = P.bedtimesForWake(now, 7 * 60 + 30, 15)

  assert.deepEqual(
    plan.slots.map((slot) => T.minutesOf(slot.at)),
    [23 * 60 + 45, 1 * 60 + 15, 2 * 60 + 45]
  )
  assert.deepEqual(plan.slots.map((slot) => slot.dayLabel), ['今天', '明天', '明天'])
  assert.equal(plan.allPassed, false)
  assert.equal(plan.availableMin, 675)
})

test('凌晨 3:38 时三个入睡时刻都已过', () => {
  const now = local(2026, 10, 18, 3, 38)
  const plan = P.bedtimesForWake(now, 7 * 60 + 30, 15)

  assert.equal(plan.allPassed, true)
  assert.equal(plan.availableMin, 217)
  assert.equal(plan.slots[0].passed, true)
  assert.equal(plan.slots[2].passed, true)
})

test('23:00 上床 + 15 分钟，5 个周期 06:45 起床', () => {
  const now = local(2026, 10, 17, 22, 30)
  const plan = P.wakeTimesForSleep(now, 23 * 60, 15)

  assert.equal(T.minutesOf(plan.sleepAt), 23 * 60)
  assert.deepEqual(
    plan.slots.map((slot) => T.minutesOf(slot.at)),
    [6 * 60 + 45, 5 * 60 + 15, 3 * 60 + 45]
  )
  assert.deepEqual(plan.slots.map((slot) => slot.dayLabel), ['明天', '明天', '明天'])
})

test('选的入睡时间已过去很多时，按次日处理', () => {
  const now = local(2026, 10, 18, 14, 0)
  const plan = P.wakeTimesForSleep(now, 8 * 60, 15)

  assert.equal(T.dateKey(plan.sleepAt), '2026-10-19')
  assert.equal(plan.slots[0].dayLabel, '明天')
  assert.equal(T.minutesOf(plan.slots[0].at), 15 * 60 + 45)
})
