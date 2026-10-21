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
