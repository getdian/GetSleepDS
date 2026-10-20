const test = require('node:test')
const assert = require('node:assert/strict')

const memory = {}
let loginSeq = 0

global.wx = {
  getStorageSync(key) {
    return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : ''
  },
  setStorageSync(key, value) {
    memory[key] = JSON.parse(JSON.stringify(value))
  },
  removeStorageSync(key) {
    delete memory[key]
  },
  login({ success }) {
    loginSeq += 1
    success({ code: 'code-' + loginSeq })
  }
}

const storage = require('../miniprogram/utils/storage')
const api = require('../miniprogram/utils/api')
const sync = require('../miniprogram/utils/sync')

function makeRecords(count) {
  const now = Date.now()
  const out = {}
  for (let i = 0; i < count; i += 1) {
    const wakeAt = now - i * 24 * 60 * 60 * 1000 - 8 * 60 * 60 * 1000
    const bedAt = wakeAt - 8 * 60 * 60 * 1000
    const day = require('../miniprogram/utils/time').sleepDayOf(bedAt)
    out[day] = { day, bedAt, wakeAt, durationMin: 480, updatedAt: wakeAt }
  }
  return out
}

test('collect 覆盖 400 天，不再截断 60 天', () => {
  storage.clearAll()
  const records = makeRecords(100)
  storage.replaceRecords(records)
  const list = sync.collect(Date.now(), 400)
  assert.ok(list.length >= 99)
  assert.ok(sync.collect(Date.now(), 60).length <= 61)
  assert.equal(sync.chunk(list, 60).every((part) => part.length <= 60), true)
  assert.equal(sync.chunk(list, 60).length, 2)
})

test('syncNow 分片上传，每片不超过 60 条且使用独立 code', async () => {
  storage.clearAll()
  storage.setSyncEnabled(true)
  storage.replaceRecords(makeRecords(100))
  const calls = []
  const original = api.syncRecords
  api.syncRecords = (code, records, deletedDays) => {
    calls.push({ code, count: records.length, deletedDays })
    return Promise.resolve({
      synced: records.length,
      dropped: 0,
      records: [],
      deletedDays: [],
      erasedAt: 0
    })
  }
  try {
    const res = await sync.syncNow(true)
    assert.equal(res.chunks, 2)
    assert.equal(calls.length, 2)
    assert.ok(calls.every((call) => call.count <= 60))
    assert.notEqual(calls[0].code, calls[1].code)
    assert.ok(storage.getMeta().lastSyncAt > 0)
  } finally {
    api.syncRecords = original
  }
})

test('cloudPendingErase 时同步直接跳过，避免云端旧记录复活', async () => {
  storage.clearAll()
  storage.setSyncEnabled(true)
  storage.patchMeta({ cloudPendingErase: true, lastSyncAt: Date.now() })
  const res = await sync.syncNow(true)
  assert.equal(res.skipped, 'cloud_pending')
})
