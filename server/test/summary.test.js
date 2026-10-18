const { test } = require('node:test')
const assert = require('node:assert/strict')

const { summarize, assertClean } = require('../src/services/summary')

// 北京时间转时间戳
function bj(year, month, day, hour, minute) {
  return Date.UTC(year, month - 1, day, hour - 8, minute)
}

function record(day, bedAt, wakeAt) {
  return { day, bedAt, wakeAt, durationMin: Math.round((wakeAt - bedAt) / 60000) }
}

// 2026-10-15 周四 10:00，本周为 10-12 周一 ~ 10-18 周日
const NOW = bj(2026, 10, 15, 10, 0)

const CURRENT = [
  record('2026-10-12', bj(2026, 10, 12, 23, 50), bj(2026, 10, 13, 7, 30)),
  record('2026-10-13', bj(2026, 10, 13, 23, 55), bj(2026, 10, 14, 7, 20)),
  record('2026-10-14', bj(2026, 10, 15, 0, 20), bj(2026, 10, 15, 7, 40))
]

const LAST_WEEK = [
  record('2026-10-05', bj(2026, 10, 5, 23, 30), bj(2026, 10, 6, 6, 30))
]

test('三条记录生成不超过两句的客观描述', () => {
  const result = summarize(CURRENT.concat(LAST_WEEK), NOW)

  assert.equal(result.available, true)
  assert.match(result.text, /^本周你记录了 3 次睡眠/)
  assert.equal(result.stats.count, 3)
  // 23:50 / 23:55 / 00:20 的圆均值应落在 00:02 附近，而不是 12:00
  assert.equal(result.stats.avgBed, '00:02')
  assert.equal(result.stats.avgWake, '07:30')
  assert.equal(result.stats.afterMidnightDays, 1)
  assert.equal(result.stats.bedDeltaMin, 32)
  assert.ok(result.text.includes('有 1 天在 0 点后入睡'))
  assert.ok(result.text.includes('比上周晚了 32 分钟'))

  const sentences = result.text.split('。').filter(Boolean)
  assert.ok(sentences.length <= 2)
})

test('不足三条时不出结论', () => {
  const result = summarize(CURRENT.slice(0, 2), NOW)
  assert.equal(result.available, false)
  assert.equal(result.text, null)
  assert.equal(result.stats.count, 2)
})

test('禁词校验会拦截指导性文案', () => {
  assert.throws(() => assertClean('你应该早点睡'), /命中禁词/)
  assert.throws(() => assertClean('注意睡眠质量'), /命中禁词/)
  assert.doesNotThrow(() => assertClean('本周你记录了 3 次睡眠。'))
})

test('模板输出不含任何禁词', () => {
  const result = summarize(CURRENT.concat(LAST_WEEK), NOW)
  assert.doesNotThrow(() => assertClean(result.text))
})

test('跨周的旧记录不会被算进本周', () => {
  const result = summarize(CURRENT.concat(LAST_WEEK), NOW)
  assert.equal(result.stats.count, 3)
})
