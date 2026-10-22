const test = require('node:test')
const assert = require('node:assert')
const { validateRecords } = require('../src/lib/validate')

// 东京 10/24 00:30 = UTC 10/23 15:30；北京口径下会落到 10/23，东京口径应落 10/24。
const wakeAt = Date.UTC(2026, 9, 23, 15, 30)
const bedAt = wakeAt - 450 * 60 * 1000

function record(tzOffsetMin) {
  return {
    schemaVersion: 2,
    sessions: [{ id: 's1', startAt: bedAt, endAt: wakeAt, durationMin: 450, source: 'web' }],
    updatedAt: wakeAt,
    tzOffsetMin
  }
}

test('记录级时区：东京跨午夜按 +540 归档到次日', () => {
  const out = validateRecords([record(540)], { now: wakeAt })
  assert.equal(out.dropped, 0)
  assert.equal(out.records.length, 1)
  assert.equal(out.records[0].day, '2026-10-24')
})

test('记录级时区：缺省时保持北京口径（10/23）', () => {
  const out = validateRecords([record(undefined)], { now: wakeAt })
  assert.equal(out.records[0].day, '2026-10-23')
})

test('记录级时区：非法值回退北京口径，不整条丢弃', () => {
  const out = validateRecords([record(9999)], { now: wakeAt })
  assert.equal(out.dropped, 0)
  assert.equal(out.records[0].day, '2026-10-23')
})
