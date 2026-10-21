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
