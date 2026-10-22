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

test('区间校验：与进行中的睡眠重叠被拦（pending 不在 records 里）', () => {
  const now = NOW
  const result = M.evaluateManualRange({
    records: {},
    // 凌晨 01:00 打卡、现在 10:00 仍在睡
    pending: { bedAt: local(2026, 10, 22, 1, 0) },
    dayTs: new Date(2026, 9, 22, 0, 0, 0, 0).getTime(),
    bedMinutes: 3 * 60,
    wakeMinutes: 9 * 60,
    now
  })
  assert.equal(result.code, 'pending')
  assert.match(result.error, /正在进行的睡眠/)
})

test('区间校验：进行中的段已结束（区间在它之前）时不误拦', () => {
  const result = M.evaluateManualRange({
    records: {},
    pending: { bedAt: local(2026, 10, 22, 1, 0) },
    dayTs: new Date(2026, 9, 21, 0, 0, 0, 0).getTime(),
    bedMinutes: 23 * 60,
    wakeMinutes: 23 * 60 + 30,
    now: NOW
  })
  assert.equal(result.code, '')
})

test('区间校验：pending 数据非法时忽略，不影响补记', () => {
  const result = M.evaluateManualRange({
    records: {},
    pending: { bedAt: 'bad' },
    dayTs: new Date(2026, 9, 18, 0, 0, 0, 0).getTime(),
    bedMinutes: 23 * 60,
    wakeMinutes: 7 * 60,
    now: NOW
  })
  assert.equal(result.code, '')
})

test('容量预检：当天已有 8 段时拒绝新增（第 9 段）', () => {
  const sessions = []
  for (let i = 0; i < 8; i += 1) {
    const start = local(2026, 10, 20, 0, 0) + i * 2 * 60 * 60 * 1000
    sessions.push({ id: 's' + i, startAt: start, endAt: start + 30 * 60 * 1000 })
  }
  const records = { '2026-10-20': { day: '2026-10-20', sessions } }
  assert.equal(M.capacityErrorOf({ records, dayKey: '2026-10-20', durationMin: 30 }), 'toomany')
  assert.match(M.errorTextOf('toomany'), /最多记录 8 段/)
})

test('容量预检：当天总时长超 24 小时被拦', () => {
  const records = {
    '2026-10-20': {
      day: '2026-10-20',
      sessions: [
        {
          id: 'long',
          startAt: local(2026, 10, 20, 0, 0),
          endAt: local(2026, 10, 20, 23, 0)
        }
      ]
    }
  }
  assert.equal(M.capacityErrorOf({ records, dayKey: '2026-10-20', durationMin: 120 }), 'dayfull')
  assert.match(M.errorTextOf('dayfull'), /不能超过 24 小时/)
})

test('容量预检：编辑时先扣掉旧段，不误报段数/时长', () => {
  const records = {
    '2026-10-20': {
      day: '2026-10-20',
      sessions: [
        { id: 'a', startAt: local(2026, 10, 20, 0, 0), endAt: local(2026, 10, 20, 20, 0) },
        { id: 'b', startAt: local(2026, 10, 20, 21, 0), endAt: local(2026, 10, 20, 22, 0) }
      ]
    }
  }
  // 编辑 a 为 2 小时：20 - 20 + 2 + 1 = 3 小时，合法
  assert.equal(
    M.capacityErrorOf({ records, dayKey: '2026-10-20', durationMin: 120, excludeId: 'a' }),
    ''
  )
})

test('区间校验：当天段数已满时给可行动文案（不再等到保存失败）', () => {
  const sessions = []
  for (let i = 0; i < 8; i += 1) {
    const start = local(2026, 10, 19, 0, 0) + i * 2 * 60 * 60 * 1000
    sessions.push({ id: 's' + i, startAt: start, endAt: start + 30 * 60 * 1000 })
  }
  const records = { '2026-10-20': { day: '2026-10-20', sessions } }
  const result = M.evaluateManualRange({
    records,
    dayTs: new Date(2026, 9, 20, 0, 0, 0, 0).getTime(),
    bedMinutes: 23 * 60,
    wakeMinutes: 23 * 60 + 30,
    now: NOW
  })
  assert.equal(result.code, 'toomany')
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
