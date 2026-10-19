const test = require('node:test')
const assert = require('node:assert/strict')

const T = require('../miniprogram/utils/time')
const { buildRealisticRecords, mulberry32, SEED } = require('../miniprogram/utils/dev-seed')

const NOW = Date.parse('2026-10-19T21:00:00+08:00')

test('记录口径：day 等于 bedAt 的睡眠日，wake 晚于 bed，时长 ≤ 20h', () => {
  const records = buildRealisticRecords(NOW, 120)
  const days = Object.keys(records)
  assert.ok(days.length > 0)
  days.forEach((day) => {
    const r = records[day]
    assert.equal(r.day, day)
    assert.equal(r.day, T.dateKey(T.sleepDayOf(r.bedAt)))
    assert.ok(r.wakeAt > r.bedAt)
    assert.ok(Math.round((r.wakeAt - r.bedAt) / 60000) === r.durationMin)
    assert.ok(r.durationMin > 0 && r.durationMin <= 20 * 60)
  })
})

test('真实感：存在漏打卡日，漏卡率在 5%~30% 之间', () => {
  const records = buildRealisticRecords(NOW, 120)
  const marked = Object.keys(records).length
  const missRatio = 1 - marked / 120
  assert.ok(missRatio > 0.05 && missRatio < 0.3, '漏卡率 ' + missRatio)
})

test('真实感：时长深浅不一（≥10 种不同值），全部落在 4h~11h', () => {
  const records = buildRealisticRecords(NOW, 120)
  const durations = Object.keys(records).map((d) => records[d].durationMin)
  const distinct = new Set(durations)
  assert.ok(distinct.size >= 10, 'distinct=' + distinct.size)
  durations.forEach((m) => {
    assert.ok(m >= 240 && m <= 660)
  })
})

test('可复现：同种子两次生成完全一致', () => {
  const a = buildRealisticRecords(NOW, 60, mulberry32(SEED))
  const b = buildRealisticRecords(NOW, 60, mulberry32(SEED))
  assert.deepEqual(a, b)
})

test('分布：平均时长落在 6.5h~8.5h（贴近真实人群）', () => {
  const records = buildRealisticRecords(NOW, 120)
  const list = Object.keys(records).map((d) => records[d].durationMin)
  const avg = list.reduce((s, m) => s + m, 0) / list.length
  assert.ok(avg > 6.5 * 60 && avg < 8.5 * 60, 'avg=' + avg)
})
