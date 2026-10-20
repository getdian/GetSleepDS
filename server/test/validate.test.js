const test = require('node:test')
const assert = require('node:assert/strict')

const { validateDeletions } = require('../src/lib/validate')

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
