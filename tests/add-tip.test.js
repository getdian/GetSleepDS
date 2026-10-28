const test = require('node:test')
const assert = require('node:assert/strict')

const A = require('../miniprogram/utils/add-tip')

/** 设备本地时间（夜间判断按本地时区，用本地构造才能在任何机器上成立） */
function local(year, month, day, hour, minute) {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

/** 北京时间（周/月切分固定 +8，与归档口径一致） */
function beijing(iso) {
  return Date.parse(iso)
}

const OK = {
  hasRecord: true,
  state: null
}

test('没有任何记录时不出现', () => {
  const gate = A.shouldShow({ now: local(2026, 10, 28, 10, 0), hasRecord: false })
  assert.deepEqual(gate, { show: false, reason: 'no-record' })
})

test('有记录 + 白天 + 本周未弹 → 出现', () => {
  const gate = A.shouldShow({
    now: local(2026, 10, 28, 10, 0),
    hasRecord: true,
    state: {}
  })
  assert.deepEqual(gate, { show: true, reason: 'ok' })
})

test('已确认添加则永久不出现', () => {
  const gate = A.shouldShow({
    now: local(2026, 10, 28, 10, 0),
    hasRecord: true,
    added: true
  })
  assert.equal(gate.show, false)
  assert.equal(gate.reason, 'added')
})

test('夜间 23:00–05:59 不出现，06:00 起恢复', () => {
  const at = (h, m) => local(2026, 10, 28, h, m)
  assert.equal(A.shouldShow({ now: at(23, 0), hasRecord: true }).reason, 'night')
  assert.equal(A.shouldShow({ now: at(23, 30), hasRecord: true }).reason, 'night')
  assert.equal(A.shouldShow({ now: at(0, 30), hasRecord: true }).reason, 'night')
  assert.equal(A.shouldShow({ now: at(5, 59), hasRecord: true }).reason, 'night')
  assert.equal(A.shouldShow({ now: at(6, 0), hasRecord: true }).show, true)
  assert.equal(A.shouldShow({ now: at(22, 59), hasRecord: true }).show, true)
})

test('入睡中（含熄灯）不打断', () => {
  const gate = A.shouldShow({ now: local(2026, 10, 28, 10, 0), hasRecord: true, busy: true })
  assert.deepEqual(gate, { show: false, reason: 'busy' })
})

test('同一自然周只弹一次，下周恢复', () => {
  const monday = local(2026, 10, 26, 10, 0)
  const shown = A.markShown(null, monday)
  assert.equal(A.shouldShow({ now: monday + 60 * 60 * 1000, hasRecord: true, state: shown }).reason, 'week-done')
  // 次周一
  const nextMonday = local(2026, 11, 2, 10, 0)
  assert.equal(A.shouldShow({ now: nextMonday, hasRecord: true, state: shown }).show, true)
})

test('每周至少一次：周界前后两天可以各弹一次（月上限兜底）', () => {
  // 周日 10:00 弹过 → 周一 10:00 属于新的一周，仍可弹
  const sunday = local(2026, 10, 25, 10, 0)
  const state = A.markShown(null, sunday)
  assert.equal(A.shouldShow({ now: local(2026, 10, 26, 10, 0), hasRecord: true, state }).show, true)
})

test('每自然月最多 5 次，第 6 次被挡', () => {
  const now = local(2026, 10, 28, 10, 0)
  const state = { monthKey: '2026-10', monthCount: 5, weekKey: '' }
  assert.deepEqual(A.shouldShow({ now, hasRecord: true, state }), { show: false, reason: 'month-cap' })
  const four = { monthKey: '2026-10', monthCount: 4, weekKey: '' }
  assert.equal(A.shouldShow({ now, hasRecord: true, state: four }).show, true)
})

test('换月后次数从 1 重新计', () => {
  const nov = local(2026, 11, 3, 10, 0)
  const octFull = { monthKey: '2026-10', monthCount: 5, weekKey: '2026-W43' }
  assert.equal(A.shouldShow({ now: nov, hasRecord: true, state: octFull }).show, true)

  const marked = A.markShown(octFull, nov)
  assert.equal(marked.monthKey, '2026-11')
  assert.equal(marked.monthCount, 1)
})

test('本月内展示后次数累加', () => {
  const a = A.markShown(null, local(2026, 10, 12, 10, 0))
  assert.equal(a.monthCount, 1)
  const b = A.markShown(a, local(2026, 10, 19, 10, 0))
  assert.equal(b.monthCount, 2)
  assert.equal(b.weekKey, A.weekKeyOf(local(2026, 10, 19, 10, 0)))
})

test('「×」只是关闭：本周已记账，本周内不再出现', () => {
  const monday = local(2026, 10, 26, 10, 0)
  const state = A.markShown(null, monday)
  assert.equal(A.shouldShow({ now: local(2026, 10, 28, 10, 0), hasRecord: true, state }).reason, 'week-done')
})

test('周键按北京时间切分（周日 23:30 仍属上周，周一 00:30 进入新周）', () => {
  assert.equal(A.weekKeyOf(beijing('2026-10-25T23:30:00+08:00')), '2026-W43')
  assert.equal(A.weekKeyOf(beijing('2026-10-26T00:30:00+08:00')), '2026-W44')
})

test('月键按北京时间切分（北京时间月末 23:30 仍属当月）', () => {
  assert.equal(A.monthKeyOf(beijing('2026-10-31T23:30:00+08:00')), '2026-10')
  assert.equal(A.monthKeyOf(beijing('2026-11-01T00:30:00+08:00')), '2026-11')
})

test('脏状态被收敛成固定形状', () => {
  assert.deepEqual(A.normalizeState(null), A.EMPTY_STATE)
  assert.deepEqual(A.normalizeState('x'), A.EMPTY_STATE)
  assert.deepEqual(A.normalizeState({ monthCount: -3, muted: '1' }), {
    lastShownAt: 0,
    weekKey: '',
    monthKey: '',
    monthCount: 0
  })
})

test('只要有任一记录日就算完成过记录', () => {
  assert.equal(A.hasAnyRecord(null), false)
  assert.equal(A.hasAnyRecord({}), false)
  assert.equal(A.hasAnyRecord({ '2026-10-27': { day: '2026-10-27', sessions: [] } }), true)
})
