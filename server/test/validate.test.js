const test = require('node:test')
const assert = require('node:assert/strict')

const { validateDeletions } = require('../src/lib/validate')

test('删除墓碑拒绝未来日期，保留 1 天时区容差', () => {
  const now = Date.UTC(2026, 9, 21, 2, 0) // 北京时间 10-21 10:00
  const list = validateDeletions(
    [
      { day: '2099-01-01', deletedAt: now },
      { day: '2026-10-23', deletedAt: now }, // 后天：拒绝
      { day: '2026-10-22', deletedAt: now }, // 明天：容差内
      { day: '2026-10-21', deletedAt: now }
    ],
    { now }
  )
  assert.deepEqual(
    list.map((item) => item.day),
    ['2026-10-22', '2026-10-21']
  )
})

test('删除墓碑拒绝不存在的日历日，避免 PG 503', () => {
  const now = Date.now()
  const list = validateDeletions(
    [
      { day: '2026-02-30', deletedAt: now },
      { day: '2026-13-01', deletedAt: now },
      { day: '2026-10-18', deletedAt: now },
      { day: '2026-02-28', deletedAt: now }
    ],
    { now }
  )
  assert.deepEqual(
    list.map((item) => item.day),
    ['2026-10-18', '2026-02-28']
  )
})
