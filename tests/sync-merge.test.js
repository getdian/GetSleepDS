const test = require('node:test')
const assert = require('node:assert/strict')

const memory = {}
let failWrites = false
let writes = 0

global.wx = {
  getStorageSync(key) {
    return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : ''
  },
  setStorageSync(key, value) {
    if (failWrites) throw new Error('storage full')
    writes += 1
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

test('erasure 合并遇到本地脏条目（null/字符串）不抛错', () => {
  storage.clearAll()
  global.wx.setStorageSync(storage.KEYS.records, {
    '2026-10-01': null,
    '2026-10-02': 'bad-row',
    '2026-10-03': record('2026-10-03', 100)
  })
  assert.doesNotThrow(() => mergeServerRecords([], { erasedAt: 300 }))
  // 合法的那条按水位删除，脏条目被忽略而不是中断整次合并
  assert.equal(storage.getRecords()['2026-10-03'], undefined)
})

test('本机没有对应记录时，云端墓碑也会落盘', () => {
  storage.clearAll()
  mergeServerRecords([], {
    deletedDays: [{ day: '2026-10-19', deletedAt: 500 }]
  })
  assert.equal(storage.getDeleted()['2026-10-19'], 500)
})

test('多条云端记录回填只写两次 Storage', () => {
  storage.clearAll()
  writes = 0
  const list = []
  for (let i = 1; i <= 30; i += 1) {
    const day = '2026-08-' + (i < 10 ? '0' : '') + i
    list.push(record(day, 100 + i))
  }
  const changed = mergeServerRecords(list, {})
  assert.equal(changed, 30)
  assert.equal(Object.keys(storage.getRecords()).length, 30)
  // records 一次 + deleted 一次，而不是每条记录各写一次
  assert.equal(writes, 2)
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

test('合并结果写入失败时通过 options.failed 暴露给调用方', () => {
  storage.clearAll()
  const options = {}
  failWrites = true
  try {
    mergeServerRecords([record('2026-10-20', 100)], options)
  } finally {
    failWrites = false
  }
  assert.equal(options.failed, true)
})
