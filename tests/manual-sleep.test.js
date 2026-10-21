/**
 * 补记共享编排：默认时间 / 错误文案 / 区间校验 / 保存入参。
 * 入睡页与统计页都依赖这份真源，两条入口的漂移会在这里先红。
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const M = require('../miniprogram/utils/manual-sleep')

function local(year, month, day, hour, minute) {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

const NOW = local(2026, 10, 22, 10, 0)

test('回溯范围：24 个月前那个月的 1 号', () => {
  assert.equal(M.MONTH_LOOKBACK, 24)
  assert.equal(M.minDayKey(NOW), '2024-10-01')
  // 1 月往前跨年
  assert.equal(M.minDayKey(local(2026, 1, 15, 9, 0)), '2024-01-01')
})

test('默认时间：过去日期是整夜 23:00 → 07:00', () => {
  const times = M.defaultTimesFor('2026-10-18', NOW)
  assert.equal(times.bedMinutes, 23 * 60)
  assert.equal(times.wakeMinutes, 7 * 60)
})

test('默认时间：当天默认仍是 07:00，只有 now 早于 07:10 才下压且至少 1 分钟', () => {
  // 上午 10:00：07:00 尚未到未来，保持整夜默认
  assert.equal(M.defaultTimesFor('2026-10-22', NOW).wakeMinutes, 7 * 60)
  // now 07:05 → 06:55，不会落在未来
  const early = M.defaultTimesFor('2026-10-22', local(2026, 10, 22, 7, 5))
  assert.equal(early.wakeMinutes, 6 * 60 + 55)
  // now 00:05 → 不能出现负数/0
  const midnight = M.defaultTimesFor('2026-10-22', local(2026, 10, 22, 0, 5))
  assert.equal(midnight.wakeMinutes, 1)
  assert.equal(midnight.bedMinutes, 23 * 60)
})

test('默认时间：入睡页「补记入睡」是 30 分钟前 → 现在（可跨午夜）', () => {
  const times = M.defaultTimesFor('2026-10-22', NOW, { preset: false })
  assert.equal(times.bedMinutes, 9 * 60 + 30)
  assert.equal(times.wakeMinutes, 10 * 60)

  const across = M.defaultTimesFor('2026-10-22', local(2026, 10, 22, 0, 10), { preset: false })
  assert.equal(across.bedMinutes, 23 * 60 + 40)
  assert.equal(across.wakeMinutes, 10)
})

test('错误文案：五类区间错误 + 重叠统一出口，未知码返回空串', () => {
  assert.match(M.errorTextOf('future'), /不能晚于现在/)
  assert.match(M.errorTextOf('short'), /至少 1 分钟/)
  assert.match(M.errorTextOf('order'), /检查醒来日/)
  assert.match(M.errorTextOf('long'), /不能超过 24 小时/)
  assert.match(M.errorTextOf('overlap'), /重叠/)
  assert.equal(M.errorTextOf(''), '')
  assert.equal(M.errorTextOf('whatever'), '')
})

test('区间校验：正常 23:00 → 07:00 得到 8 小时且无错误', () => {
  const result = M.evaluateManualRange({
    records: {},
    dayTs: new Date(2026, 9, 18, 0, 0, 0, 0).getTime(),
    bedMinutes: 23 * 60,
    wakeMinutes: 7 * 60,
    now: NOW
  })
  assert.equal(result.code, '')
  assert.equal(result.error, '')
  assert.equal(result.durationMin, 480)
  assert.equal(result.wakeAt - result.bedAt, 480 * 60000)
})

test('区间校验：未来时间被拦（future）', () => {
  const result = M.evaluateManualRange({
    records: {},
    dayTs: new Date(2026, 9, 23, 0, 0, 0, 0).getTime(),
    bedMinutes: 23 * 60,
    wakeMinutes: 7 * 60,
    now: NOW
  })
  assert.equal(result.code, 'future')
  assert.match(result.error, /不能晚于现在/)
})

test('区间校验：与已有段重叠被拦（跨天也要查全表）', () => {
  const records = {
    '2026-10-18': {
      day: '2026-10-18',
      sessions: [
        {
          id: 's-1',
          startAt: local(2026, 10, 17, 23, 0),
          endAt: local(2026, 10, 18, 7, 0)
        }
      ]
    }
  }
  const result = M.evaluateManualRange({
    records,
    dayTs: new Date(2026, 9, 18, 0, 0, 0, 0).getTime(),
    bedMinutes: 23 * 60,
    wakeMinutes: 6 * 60,
    now: NOW
  })
  assert.equal(result.code, 'overlap')
  assert.match(result.error, /重叠/)
})

test('保存入参：manual 来源、时长四舍五入、id 带时间戳', () => {
  const now = 1792600000000
  const args = M.buildSaveArgs(now - 8 * 3600 * 1000, now, now)
  assert.equal(args.source, 'manual')
  assert.equal(args.durationMin, 480)
  assert.equal(args.startAt, now - 8 * 3600 * 1000)
  assert.equal(args.endAt, now)
  assert.equal(args.editedAt, now)
  assert.equal(args.id, 'manual-' + now)
})
