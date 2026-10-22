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

test('结果面进度时钟：倒计时随真实时间走，推荐起床时间不漂移', () => {
  const anchor = local(2026, 10, 17, 23, 0)
  const later = local(2026, 10, 18, 0, 30)
  const plan = P.bedtimesForWake(anchor, 7 * 60 + 30, 15, later)

  // wakeAt 仍按锚点取“下一次 07:30”，不会因为过了午夜就变成今天已过的时间
  assert.equal(T.dateKey(plan.wakeAt), '2026-10-18')
  // 23:45 已错过，01:15 / 02:45 还在
  assert.deepEqual(plan.slots.map((slot) => slot.passed), [true, false, false])
  // 距离 07:30 还有 420 分钟，扣掉 15 分钟入睡
  assert.equal(plan.availableMin, 405)
})

test('起床上下文用 24h + 时段词，避免 12 小时制歧义', () => {
  const evening = local(2026, 10, 17, 20, 0)
  assert.equal(P.wakeContextText(evening, 23 * 60 + 26, 15), '今天 晚上 23:26 起床')
  assert.equal(P.wakeContextText(evening, 0 * 60 + 26, 15), '明天 凌晨 00:26 起床')
  assert.equal(P.wakeContextText(evening, 12 * 60 + 26, 15), '明天 中午 12:26 起床')

  const morning = local(2026, 10, 17, 6, 0)
  assert.equal(P.wakeContextText(morning, 7 * 60 + 30, 15), '今天 早晨 07:30 起床')
})

test('入睡上下文用 24h + 时段词，并与 30 分钟宽限同口径', () => {
  const afternoon = local(2026, 10, 18, 15, 31)
  assert.equal(P.sleepContextText(afternoon, 22 * 60 + 30), '今天 晚上 22:30 入睡')
  // 08:00 已过去超过 30 分钟 → 次日
  assert.equal(P.sleepContextText(afternoon, 8 * 60), '明天 早晨 08:00 入睡')

  // 宽限内仍算今天，过了宽限才翻日
  assert.equal(P.sleepContextText(local(2026, 10, 18, 8, 20), 8 * 60), '今天 早晨 08:00 入睡')
  assert.equal(P.sleepContextText(local(2026, 10, 18, 8, 31), 8 * 60), '明天 早晨 08:00 入睡')
})

test('入睡上下文的翻日与 wakeTimesForSleep 完全一致', () => {
  const now = local(2026, 10, 18, 15, 31)
  ;[0, 8 * 60, 22 * 60 + 30, 23 * 60 + 59].forEach((minutes) => {
    const plan = P.wakeTimesForSleep(now, minutes, 15)
    assert.equal(P.sleepAtOf(now, minutes), plan.sleepAt)
    assert.equal(P.dayLabel(plan.sleepAt, now), P.sleepContextText(now, minutes).split(' ')[0])
  })
})

test('nextWakeAt 只有留出入睡耗时后仍来得及才算今天', () => {
  const evening = local(2026, 10, 17, 21, 50)
  assert.equal(P.dayLabel(P.nextWakeAt(evening, 7 * 60 + 30, 15), evening), '明天')

  const morning = local(2026, 10, 18, 6, 0)
  assert.equal(P.dayLabel(P.nextWakeAt(morning, 7 * 60 + 30, 15), morning), '今天')

  const tooTight = local(2026, 10, 18, 7, 20)
  assert.equal(P.dayLabel(P.nextWakeAt(tooTight, 7 * 60 + 30, 15), tooTight), '明天')
})
