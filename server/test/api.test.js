const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')

const { createApp } = require('../src/app')
const { loadConfig } = require('../src/config')
const { createMemoryDb } = require('../src/db')

function bj(year, month, day, hour, minute) {
  return Date.UTC(year, month - 1, day, hour - 8, minute)
}

const FIXED_NOW = bj(2026, 10, 15, 10, 0)

const RECORDS = [
  { day: '2026-10-12', bedAt: bj(2026, 10, 12, 23, 50), wakeAt: bj(2026, 10, 13, 7, 30) },
  { day: '2026-10-13', bedAt: bj(2026, 10, 13, 23, 50), wakeAt: bj(2026, 10, 14, 7, 30) },
  { day: '2026-10-14', bedAt: bj(2026, 10, 14, 23, 50), wakeAt: bj(2026, 10, 15, 7, 30) }
]

let server = null
let base = ''
let db = null

before(async () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    ALLOW_DEV_LOGIN: '1',
    DB_MODE: 'memory'
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

async function post(path, body) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  return { status: res.status, body: await res.json() }
}

test('health 返回进程与数据库状态，并带基础安全头', async () => {
  const res = await fetch(base + '/api/health')
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.db, 'ok')
  assert.equal(body.mode, 'memory')
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(res.headers.get('x-frame-options'), 'DENY')
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer')
  assert.ok(res.headers.get('x-request-id'))
})

test('ready 探针在数据库可用时返回 200', async () => {
  const res = await fetch(base + '/api/ready')
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.db, 'ok')
})

test('config 下发音频、广告位与开关，且不泄露密钥', async () => {
  const res = await fetch(base + '/api/config')
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.ok(body.audio.length >= 1)
  body.audio.forEach((item) => {
    assert.ok(item.id)
    assert.ok(item.title)
    assert.match(item.url, /^https:\/\//)
  })
  assert.equal(body.unlock.ttlHours, 24)
  assert.equal(body.features.summary, true)
  assert.equal(body.wx, undefined)
  assert.ok(!JSON.stringify(body).includes('secret'))
})

test('解锁写入 24 小时有效期', async () => {
  const res = await post('/api/audio/unlock', { code: 'test-code' })
  assert.equal(res.status, 200)
  assert.equal(res.body.expireAt, FIXED_NOW + 24 * 60 * 60 * 1000)
  assert.equal(res.body.ttlHours, 24)
  assert.equal(await db.getUnlock('dev_openid'), res.body.expireAt)
})

test('解锁缺少 code 返回 400', async () => {
  const res = await post('/api/audio/unlock', {})
  assert.equal(res.status, 400)
  assert.equal(res.body.error.code, 'INVALID_BODY')
})

test('summary 三条记录返回事实描述', async () => {
  const res = await post('/api/summary', { records: RECORDS })
  assert.equal(res.status, 200)
  assert.equal(res.body.available, true)
  assert.match(res.body.text, /^本周你记录了 3 次睡眠/)
  assert.equal(res.body.stats.avgBed, '23:50')
  assert.equal(res.body.generatedAt, FIXED_NOW)
})

test('summary 按 bedAt 归一化 day，并丢弃时间倒挂的单条记录', async () => {
  const wrongDay = [{ day: '2026-10-11', bedAt: RECORDS[0].bedAt, wakeAt: RECORDS[0].wakeAt }]
  const first = await post('/api/summary', { records: wrongDay })
  assert.equal(first.status, 200)
  assert.equal(first.body.available, false)
  assert.equal(first.body.dropped, 0)

  const backwards = [{ day: '2026-10-12', bedAt: 2000, wakeAt: 1000 }]
  const second = await post('/api/summary', { records: backwards })
  assert.equal(second.status, 200)
  assert.equal(second.body.dropped, 1)
})

test('sync 幂等写入记录', async () => {
  const first = await post('/api/records/sync', { code: 'test-code', records: RECORDS })
  assert.equal(first.status, 200)
  assert.equal(first.body.synced, 3)

  const updated = RECORDS.map((r) => ({ ...r, updatedAt: FIXED_NOW }))
  updated[2] = { ...updated[2], wakeAt: bj(2026, 10, 15, 8, 0), updatedAt: FIXED_NOW + 1 }
  const second = await post('/api/records/sync', { code: 'test-code', records: updated })
  assert.equal(second.status, 200)

  const stored = await db.getRecords('dev_openid')
  assert.equal(stored.length, 3)
  const last = stored.find((r) => r.day === '2026-10-14')
  assert.equal(last.wakeAt, bj(2026, 10, 15, 8, 0))

  // 响应带回云端记录，供换机回填
  assert.equal(second.body.records.length, 3)
  assert.equal(second.body.records[0].day, '2026-10-12')
})

test('erase 删除该用户全部云端记录', async () => {
  const res = await post('/api/records/erase', { code: 'test-code' })
  assert.equal(res.status, 200)
  assert.equal(res.body.deleted, 3)
  assert.deepEqual(await db.getRecords('dev_openid'), [])
})

test('erase 缺少 code 返回 400', async () => {
  const res = await post('/api/records/erase', {})
  assert.equal(res.status, 400)
  assert.equal(res.body.error.code, 'INVALID_BODY')
})

test('未知接口返回 404', async () => {
  const res = await fetch(base + '/api/nope')
  assert.equal(res.status, 404)
})
