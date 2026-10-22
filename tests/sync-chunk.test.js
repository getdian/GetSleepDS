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
const manualSleep = require('../miniprogram/utils/manual-sleep')

// 补记可编辑窗口必须与云同步窗口一致：窗口外的补记永远上不了云（静默丢数据）。
// 任一侧单独调整都会让另一侧失真，这里用测试锁死。
test('补记可编辑窗口与云同步窗口一致', () => {
  assert.equal(manualSleep.EDIT_WINDOW_DAYS, sync.SPAN_DAYS)
})

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

test('chunkRecords：60 条 × 5 段 + 400 墓碑时按字节分片，首片为墓碑留空间', () => {
  const records = []
  const base = Date.UTC(2026, 0, 1, 23, 0, 0)
  for (let i = 0; i < 60; i += 1) {
    const sessions = []
    let at = base + i * 24 * 60 * 60 * 1000
    for (let k = 0; k < 5; k += 1) {
      sessions.push({
        id: 's-' + at + '-' + k,
        startAt: at,
        endAt: at + 30 * 60 * 1000,
        durationMin: 30,
        source: 'manual',
        editedAt: at
      })
      at += 60 * 60 * 1000
    }
    records.push({
      day: '2026-01-' + String(1 + (i % 28)).padStart(2, '0'),
      dayRule: 'wake-v1',
      schemaVersion: 2,
      bedAt: sessions[0].startAt,
      wakeAt: sessions[4].endAt,
      durationMin: 30,
      nightDurationMin: 30,
      totalDurationMin: 150,
      sessions,
      updatedAt: sessions[4].endAt
    })
  }
  const deletedDays = Array.from({ length: 400 }, (_, i) => ({
    day:
      '2025-' +
      String(1 + (Math.floor(i / 28) % 12)).padStart(2, '0') +
      '-' +
      String(1 + (i % 28)).padStart(2, '0'),
    deletedAt: base + i * 1000
  }))

  const batches = sync.chunkRecords(records, deletedDays)
  assert.ok(batches.length >= 2)
  assert.equal(
    batches.reduce((sum, batch) => sum + batch.length, 0),
    records.length
  )
  batches.forEach((batch, index) => {
    const body = {
      records: batch,
      deletedDays: index === 0 ? deletedDays : [],
      includeAll: index === 0
    }
    assert.ok(batch.length <= 60, '单片不超过 60 条')
    assert.ok(
      JSON.stringify(body).length <= 44 * 1024,
      '第 ' + index + ' 片超出字节预算：' + JSON.stringify(body).length
    )
  })
})
