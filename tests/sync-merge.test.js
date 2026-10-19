const test = require('node:test')
const assert = require('node:assert/strict')

const memory = {}
let failWrites = false

global.wx = {
  getStorageSync(key) {
    return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : ''
  },
  setStorageSync(key, value) {
    if (failWrites) throw new Error('storage full')
    memory[key] = value
  },
  removeStorageSync(key) {
    delete memory[key]
  }
}

const storage = require('../miniprogram/utils/storage')
const { mergeServerRecords } = require('../miniprogram/utils/sync')

function record(day, updatedAt) {
  return {
    day,
    bedAt: 1000,
    wakeAt: 2000,
    durationMin: 16,
    updatedAt
  }
}

test('云端删除墓碑会删除本机旧记录并留下墓碑', () => {
  storage.clearAll()
  storage.saveRecord(record('2026-10-18', 100))
  const changed = mergeServerRecords([], {
    deletedDays: [{ day: '2026-10-18', deletedAt: 200 }]
  })
  assert.equal(changed, 1)
  assert.equal(storage.getRecords()['2026-10-18'], undefined)
  assert.equal(storage.getDeleted()['2026-10-18'], 200)
})

test('erasure 水位只删除旧记录，不删除清除后新记录', () => {
  storage.clearAll()
  storage.saveRecord(record('2026-10-18', 100))
  mergeServerRecords([], { erasedAt: 300 })
  assert.equal(storage.getRecords()['2026-10-18'], undefined)

  storage.saveRecord(record('2026-10-18', 400))
  mergeServerRecords([], { erasedAt: 300 })
  assert.equal(storage.getRecords()['2026-10-18'].updatedAt, 400)
})

test('saveRecord 写入失败时返回 false，不清墓碑', () => {
  storage.clearAll()
  storage.saveRecord(record('2026-10-18', 100))
  storage.markDeleted('2026-10-18', 200)
  failWrites = true
  assert.equal(storage.saveRecord(record('2026-10-18', 300)), false)
  failWrites = false
  assert.equal(storage.getDeleted()['2026-10-18'], 200)
})
