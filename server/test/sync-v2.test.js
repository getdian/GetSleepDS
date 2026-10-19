const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')

const { createApp } = require('../src/app')
const { loadConfig } = require('../src/config')
const { createMemoryDb } = require('../src/db')

function bj(year, month, day, hour, minute) {
  return Date.UTC(year, month - 1, day, hour - 8, minute)
}

const FIXED_NOW = bj(2026, 10, 15, 10, 0)
const OPENID = 'dev_openid'

let server = null
let base = ''
let db = null

async function post(path, body) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  return { status: res.status, body: await res.json() }
}

before(async () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    ALLOW_DEV_LOGIN: '1',
    DB_MODE: 'memory',
    ADMIN_PASSWORD: 'test-admin-pass'
  })
  db = createMemoryDb()
  const app = createApp({
    config,
    db,
    logger: { log() {}, error() {} },
    now: () => FIXED_NOW
  })
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = 'http://127.0.0.1:' + server.address().port
})

after(() => new Promise((resolve) => server.close(resolve)))

test('sync 以 bedAt 重算 day，并丢弃单条脏记录', async () => {
  const records = [
    {
      day: '2026-10-18',
      bedAt: bj(2026, 10, 14, 23, 50),
      wakeAt: bj(2026, 10, 15, 7, 30),
      updatedAt: FIXED_NOW
    },
    {
      day: '2026-10-14',
      bedAt: bj(2026, 10, 14, 23, 50),
      wakeAt: bj(2026, 10, 16, 7, 30),
      updatedAt: FIXED_NOW
    },
    {
      day: '2026-10-14',
      bedAt: 8.64e15 + 5 * 3600 * 1000,
      wakeAt: 8.64e15 + 5 * 3600 * 1000 + 1000,
      updatedAt: FIXED_NOW
    }
  ]

  const res = await post('/api/records/sync', { code: 'sync-v2', records })
  assert.equal(res.status, 200)
  assert.equal(res.body.synced, 1)
  assert.equal(res.body.dropped, 2)
  assert.equal(res.body.records.length, 1)
  assert.equal(res.body.records[0].day, '2026-10-14')
})

test('sync 删除墓碑会物理删除云端记录，且旧设备不能再写回', async () => {
  const old = {
    day: '2026-10-14',
    bedAt: bj(2026, 10, 14, 23, 50),
    wakeAt: bj(2026, 10, 15, 7, 30),
    updatedAt: FIXED_NOW
  }
  await post('/api/records/sync', { code: 'sync-v2', records: [old] })

  const removed = await post('/api/records/sync', {
    code: 'sync-v2',
    records: [],
    deletedDays: [{ day: '2026-10-14', deletedAt: FIXED_NOW + 1000 }]
  })
  assert.equal(removed.status, 200)
  assert.equal(removed.body.records.length, 0)
  assert.equal(removed.body.deletedDays[0].day, '2026-10-14')

  const replay = await post('/api/records/sync', { code: 'sync-v2', records: [old] })
  assert.equal(replay.status, 200)
  assert.equal(replay.body.synced, 0)
  assert.equal(replay.body.records.length, 0)
})

test('erase 后旧记录不能写回，新记录可以重新建立', async () => {
  const erased = await post('/api/records/erase', { code: 'sync-v2' })
  assert.equal(erased.status, 200)
  assert.ok(erased.body.erasedAt > 0)

  const old = {
    day: '2026-10-14',
    bedAt: bj(2026, 10, 14, 23, 50),
    wakeAt: bj(2026, 10, 15, 7, 30),
    updatedAt: FIXED_NOW - 1000
  }
  const rejected = await post('/api/records/sync', { code: 'sync-v2', records: [old] })
  assert.equal(rejected.status, 200)
  assert.equal(rejected.body.synced, 0)
  assert.equal(rejected.body.records.length, 0)

  const fresh = Object.assign({}, old, { updatedAt: FIXED_NOW + 2000 })
  const accepted = await post('/api/records/sync', { code: 'sync-v2', records: [fresh] })
  assert.equal(accepted.status, 200)
  assert.equal(accepted.body.synced, 1)
  assert.equal(accepted.body.records.length, 1)
})

test('sync 返回删除墓碑与 erasure 水位，供客户端清理本机旧记录', async () => {
  const res = await post('/api/records/sync', { code: 'sync-v2', records: [] })
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.deletedDays))
  assert.ok(res.body.erasedAt > 0)
})
