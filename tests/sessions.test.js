const test = require('node:test')
const assert = require('node:assert/strict')

const T = require('../miniprogram/utils/time')
const X = require('../miniprogram/utils/sessions')

function at(year, month, day, hour, minute) {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

test('一次睡眠归属醒来日：23:30 → 07:00 算次日', () => {
  const start = at(2026, 10, 20, 23, 30)
  const end = at(2026, 10, 21, 7, 0)
  assert.equal(X.sessionDay({ startAt: start, endAt: end }), '2026-10-21')
})

test('旧记录没有 sessions 时按 bedAt/wakeAt 合成一段', () => {
  const start = at(2026, 10, 20, 23, 0)
  const end = at(2026, 10, 21, 7, 0)
  const list = X.sessionsOf({ day: '2026-10-20', bedAt: start, wakeAt: end })
  assert.equal(list.length, 1)
  assert.equal(list[0].startAt, start)
  assert.equal(list[0].durationMin, 8 * 60)
})

test('一天多段聚合：主睡眠取最长，总睡眠求和', () => {
  const nightStart = at(2026, 10, 20, 23, 0)
  const nightEnd = at(2026, 10, 21, 6, 30)
  const napStart = at(2026, 10, 21, 13, 0)
  const napEnd = at(2026, 10, 21, 13, 25)
  const record = X.aggregate(
    '2026-10-21',
    [
      { id: 'night', startAt: nightStart, endAt: nightEnd },
      { id: 'nap', startAt: napStart, endAt: napEnd }
    ],
    nightEnd
  )
  assert.equal(record.schemaVersion, 2)
  assert.equal(record.dayRule, 'wake-v1')
  assert.equal(record.durationMin, 7 * 60 + 30)
  assert.equal(record.totalDurationMin, 7 * 60 + 55)
  assert.equal(record.sessions.length, 2)
})

test('同 id 的 session 编辑会替换而不是追加', () => {
  const base = X.aggregate('2026-10-21', [
    { id: 'a', startAt: at(2026, 10, 20, 23, 0), endAt: at(2026, 10, 21, 7, 0) }
  ])
  const next = X.upsert(base, {
    id: 'a',
    startAt: at(2026, 10, 20, 23, 30),
    endAt: at(2026, 10, 21, 7, 0)
  })
  assert.equal(next.length, 1)
  assert.equal(next[0].startAt, at(2026, 10, 20, 23, 30))
})

test('手动补记：同一天午休、跨午夜、未来时间', () => {
  const day = T.parseDateKey('2026-10-21')
  const now = at(2026, 10, 21, 22, 0)

  const nap = X.rangeForDay(day, 13 * 60, 13 * 60 + 25, now)
  assert.equal(nap.durationMin, 25)
  assert.equal(T.dateKey(nap.wakeAt), '2026-10-21')
  assert.equal(nap.error, '')

  const night = X.rangeForDay(day, 23 * 60, 7 * 60, now)
  assert.equal(T.dateKey(night.bedAt), '2026-10-20')
  assert.equal(T.dateKey(night.wakeAt), '2026-10-21')
  assert.equal(night.durationMin, 8 * 60)
  assert.equal(night.error, '')

  const future = X.rangeForDay(day, 22 * 60, 23 * 60, now)
  assert.equal(future.error, 'future')
})

test('同一天重叠段会被检出', () => {
  const a = { startAt: at(2026, 10, 20, 23, 0), endAt: at(2026, 10, 21, 7, 0) }
  const b = { startAt: at(2026, 10, 21, 6, 0), endAt: at(2026, 10, 21, 8, 0) }
  const c = { startAt: at(2026, 10, 21, 7, 0), endAt: at(2026, 10, 21, 8, 0) }
  assert.equal(X.hasOverlap([a, b]), true)
  assert.equal(X.hasOverlap([a, c]), false)
})
