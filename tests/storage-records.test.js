const test = require('node:test')
const assert = require('node:assert/strict')

const store = {}
global.wx = {
  getStorageSync(key) {
    return store[key] === undefined ? '' : store[key]
  },
  setStorageSync(key, value) {
    store[key] = JSON.parse(JSON.stringify(value))
  },
  removeStorageSync(key) {
    delete store[key]
  }
}

const storage = require('../miniprogram/utils/storage')
const KEY = storage.KEYS.records

test('saveRecord 基于原始表浅合并，不丢缺 day 的旧条目', () => {
  store[KEY] = {
    // 旧结构/脏数据：有 bedAt/wakeAt 但没有 day，getRecords() 会把它过滤掉
    legacy: { bedAt: 1, wakeAt: 2 }
  }
  const ok = storage.saveRecord({ day: '2026-10-20', bedAt: 3, wakeAt: 4, updatedAt: 5 })
  assert.equal(ok, true)
  assert.ok(store[KEY].legacy, '未知/旧结构条目必须保留')
  assert.equal(store[KEY]['2026-10-20'].day, '2026-10-20')
  // 过滤视图仍然只暴露合法记录
  assert.deepEqual(Object.keys(storage.getRecords()), ['2026-10-20'])
})

test('removeRecord 只删目标睡眠日，其余条目原样保留', () => {
  store[KEY] = {
    legacy: { bedAt: 1, wakeAt: 2 },
    '2026-10-20': { day: '2026-10-20', bedAt: 3, wakeAt: 4, updatedAt: 5 }
  }
  assert.equal(storage.removeRecord('2026-10-20', 1000), true)
  assert.ok(store[KEY].legacy)
  assert.equal(store[KEY]['2026-10-20'], undefined)
})

test('removeRecord 的墓碑时间必须晚于记录 updatedAt（防云端回填）', () => {
  const future = Date.now() + 60 * 60 * 1000
  store[KEY] = {
    '2026-10-20': { day: '2026-10-20', bedAt: 1, wakeAt: 2, updatedAt: future }
  }
  store[storage.KEYS.deleted] = {}
  assert.equal(storage.removeRecord('2026-10-20'), true)
  assert.ok(
    store[storage.KEYS.deleted]['2026-10-20'] > future,
    '墓碑早于 updatedAt 时云端按 updated_at <= deleted_at 删不掉，记录会被回填'
  )
})

function ts(year, month, day, hour, minute) {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

test('saveSession 按醒来日聚合，并把同醒来日的旧 v1 记录并进来', () => {
  store[KEY] = {}
  store[storage.KEYS.deleted] = {}
  const nightStart = ts(2026, 10, 20, 23, 0)
  const nightEnd = ts(2026, 10, 21, 7, 0)
  store[KEY]['2026-10-20'] = {
    day: '2026-10-20',
    bedAt: nightStart,
    wakeAt: nightEnd,
    durationMin: 480,
    updatedAt: nightEnd
  }
  const napStart = ts(2026, 10, 21, 13, 0)
  const napEnd = ts(2026, 10, 21, 13, 25)
  const record = storage.saveSession({
    id: 'nap-1',
    startAt: napStart,
    endAt: napEnd,
    source: 'manual'
  })
  assert.ok(record)
  assert.equal(record.day, '2026-10-21')
  assert.equal(record.dayRule, 'wake-v1')
  assert.equal(record.sessions.length, 2)
  assert.equal(record.durationMin, 480)
  assert.equal(record.totalDurationMin, 505)
  assert.equal(store[KEY]['2026-10-20'], undefined)
  assert.ok(store[storage.KEYS.deleted]['2026-10-20'])
})

test('saveSession 拒绝跨天重叠（只查醒来日会漏）', () => {
  store[KEY] = {}
  store[storage.KEYS.deleted] = {}
  const earlyStart = ts(2026, 10, 23, 22, 0)
  const earlyEnd = ts(2026, 10, 23, 23, 30)
  store[KEY]['2026-10-23'] = {
    day: '2026-10-23',
    dayRule: 'wake-v1',
    schemaVersion: 2,
    bedAt: earlyStart,
    wakeAt: earlyEnd,
    durationMin: 90,
    nightDurationMin: 90,
    totalDurationMin: 90,
    sessions: [{ id: 'early', startAt: earlyStart, endAt: earlyEnd }],
    updatedAt: 1
  }
  const blocked = storage.saveSession({
    id: 'night',
    startAt: ts(2026, 10, 23, 22, 30),
    endAt: ts(2026, 10, 24, 7, 0)
  })
  assert.equal(blocked, false)
  assert.equal(store[KEY]['2026-10-24'], undefined)
  // 首尾相接（23:30 起床、23:30 再睡）允许
  const ok = storage.saveSession({
    id: 'night',
    startAt: earlyEnd,
    endAt: ts(2026, 10, 24, 7, 0)
  })
  assert.ok(ok)
  assert.equal(ok.day, '2026-10-24')
})

test('updateSession 迁移旧 v1 记录到已有醒来日时合并，不覆盖那天的段', () => {
  store[KEY] = {}
  store[storage.KEYS.deleted] = {}
  const bedAt = ts(2026, 10, 25, 23, 0)
  const wakeAt = ts(2026, 10, 26, 7, 0)
  store[KEY]['2026-10-25'] = {
    day: '2026-10-25',
    bedAt,
    wakeAt,
    durationMin: 480,
    updatedAt: 1
  }
  const napStart = ts(2026, 10, 26, 13, 0)
  const napEnd = ts(2026, 10, 26, 13, 30)
  store[KEY]['2026-10-26'] = {
    day: '2026-10-26',
    dayRule: 'wake-v1',
    schemaVersion: 2,
    bedAt: napStart,
    wakeAt: napEnd,
    durationMin: 30,
    nightDurationMin: 30,
    totalDurationMin: 30,
    sessions: [{ id: 'nap', startAt: napStart, endAt: napEnd }],
    updatedAt: 2
  }
  const next = storage.updateSession(
    '2026-10-25',
    'legacy-' + wakeAt,
    bedAt,
    ts(2026, 10, 26, 6, 30)
  )
  assert.ok(next)
  assert.equal(next.day, '2026-10-26')
  assert.equal(next.sessions.length, 2)
  assert.equal(next.totalDurationMin, 450 + 30)
  assert.equal(store[KEY]['2026-10-25'], undefined)
})

test('updateSession 拒绝与另一天已有段重叠的编辑', () => {
  store[KEY] = {}
  store[storage.KEYS.deleted] = {}
  const nightStart = ts(2026, 10, 27, 20, 0)
  const nightEnd = ts(2026, 10, 27, 23, 0)
  store[KEY]['2026-10-27'] = {
    day: '2026-10-27',
    dayRule: 'wake-v1',
    schemaVersion: 2,
    bedAt: nightStart,
    wakeAt: nightEnd,
    durationMin: 180,
    nightDurationMin: 180,
    totalDurationMin: 180,
    sessions: [{ id: 'night', startAt: nightStart, endAt: nightEnd }],
    updatedAt: 1
  }
  store[KEY]['2026-10-28'] = {
    day: '2026-10-28',
    dayRule: 'wake-v1',
    schemaVersion: 2,
    bedAt: ts(2026, 10, 28, 8, 0),
    wakeAt: ts(2026, 10, 28, 9, 0),
    durationMin: 60,
    nightDurationMin: 60,
    totalDurationMin: 60,
    sessions: [{ id: 'other', startAt: ts(2026, 10, 28, 8, 0), endAt: ts(2026, 10, 28, 9, 0) }],
    updatedAt: 2
  }
  const next = storage.updateSession(
    '2026-10-27',
    'night',
    nightStart,
    ts(2026, 10, 28, 8, 30)
  )
  assert.equal(next, false)
  assert.equal(store[KEY]['2026-10-28'].sessions.length, 1)
})

test('updateSession 修改同一天的一段并重算总时长', () => {
  const day = '2026-10-22'
  store[KEY] = {
    [day]: {
      day,
      dayRule: 'wake-v1',
      schemaVersion: 2,
      bedAt: ts(2026, 10, 21, 23, 0),
      wakeAt: ts(2026, 10, 22, 7, 0),
      durationMin: 480,
      nightDurationMin: 480,
      totalDurationMin: 510,
      sessions: [
        { id: 'night', startAt: ts(2026, 10, 21, 23, 0), endAt: ts(2026, 10, 22, 7, 0) },
        { id: 'nap', startAt: ts(2026, 10, 22, 13, 0), endAt: ts(2026, 10, 22, 13, 30) }
      ],
      updatedAt: 1
    }
  }
  const next = storage.updateSession(day, 'nap', ts(2026, 10, 22, 13, 0), ts(2026, 10, 22, 13, 20))
  assert.ok(next)
  assert.equal(next.totalDurationMin, 500)
  assert.equal(next.sessions.filter((item) => item.id === 'nap')[0].durationMin, 20)
})

test('removeSession 删除其中一段，剩余段与总时长保留', () => {
  const day = '2026-10-22'
  store[KEY] = {
    [day]: {
      day,
      dayRule: 'wake-v1',
      schemaVersion: 2,
      bedAt: ts(2026, 10, 21, 23, 0),
      wakeAt: ts(2026, 10, 22, 7, 0),
      durationMin: 480,
      nightDurationMin: 480,
      totalDurationMin: 510,
      sessions: [
        { id: 'night', startAt: ts(2026, 10, 21, 23, 0), endAt: ts(2026, 10, 22, 7, 0) },
        { id: 'nap', startAt: ts(2026, 10, 22, 13, 0), endAt: ts(2026, 10, 22, 13, 30) }
      ],
      updatedAt: 1
    }
  }
  store[storage.KEYS.deleted] = {}
  const next = storage.removeSession(day, 'nap')
  assert.ok(next)
  assert.equal(next.sessions.length, 1)
  assert.equal(next.totalDurationMin, 480)
  // 主睡眠（最长段）跟着重算：删掉午休后 bedAt/wakeAt 仍是夜间段
  assert.equal(next.bedAt, ts(2026, 10, 21, 23, 0))
  assert.equal(next.wakeAt, ts(2026, 10, 22, 7, 0))
  assert.equal(storage.getRecords()[day].totalDurationMin, 480)
})

test('removeSession 删除当天唯一一段时整条移除并写墓碑', () => {
  const day = '2026-10-22'
  store[KEY] = {
    [day]: {
      day,
      dayRule: 'wake-v1',
      schemaVersion: 2,
      bedAt: ts(2026, 10, 21, 23, 0),
      wakeAt: ts(2026, 10, 22, 7, 0),
      durationMin: 480,
      nightDurationMin: 480,
      totalDurationMin: 480,
      sessions: [{ id: 'night', startAt: ts(2026, 10, 21, 23, 0), endAt: ts(2026, 10, 22, 7, 0) }],
      updatedAt: 1
    }
  }
  store[storage.KEYS.deleted] = {}
  assert.equal(storage.removeSession(day, 'night'), true)
  assert.equal(store[KEY][day], undefined)
  // 删空整天 = 撤销当天：必须写墓碑，否则云端旧记录会在下次同步回填
  assert.ok(store[storage.KEYS.deleted][day])
})

test('removeSession 对不存在的段/天返回 false，不碰其他记录', () => {
  const day = '2026-10-22'
  store[KEY] = {
    other: { day: 'other', bedAt: 1, wakeAt: 2, updatedAt: 1 },
    [day]: {
      day,
      dayRule: 'wake-v1',
      schemaVersion: 2,
      bedAt: ts(2026, 10, 21, 23, 0),
      wakeAt: ts(2026, 10, 22, 7, 0),
      durationMin: 480,
      nightDurationMin: 480,
      totalDurationMin: 480,
      sessions: [{ id: 'night', startAt: ts(2026, 10, 21, 23, 0), endAt: ts(2026, 10, 22, 7, 0) }],
      updatedAt: 1
    }
  }
  store[storage.KEYS.deleted] = {}
  assert.equal(storage.removeSession(day, 'missing'), false)
  assert.equal(storage.removeSession('2099-01-01', 'night'), false)
  assert.ok(store[KEY][day])
  assert.ok(store[KEY].other)
  assert.equal(Object.keys(store[storage.KEYS.deleted]).length, 0)
})
