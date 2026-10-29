const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')

const { createApp } = require('../src/app')
const { loadConfig } = require('../src/config')
const { createMemoryDb } = require('../src/db')
const { createConfigStore } = require('../src/services/config-store')

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

test('audio_error 在事件白名单内，target 保留 trackId|错误码', async () => {
  const res = await post('/api/events', {
    code: 'dev-code',
    // 前面的 erase 用例写了 erasure 水位，事件时间必须晚于它才会被接受
    events: [{ type: 'audio_error', target: 'sleep-10001|10003', ts: FIXED_NOW + 60 * 1000 }]
  })
  assert.equal(res.status, 200)
  assert.equal(res.body.accepted, 1)
})

test('audio_unlock_fail 在事件白名单内，保留失败原因', async () => {
  const res = await post('/api/events', {
    code: 'dev-code',
    events: [{ type: 'audio_unlock_fail', target: 'unavailable|sleep-10001', ts: FIXED_NOW + 150 * 1000 }]
  })
  assert.equal(res.status, 200)
  assert.equal(res.body.accepted, 1)
})

test('一条脏事件只丢自己，不带走同批有效事件', async () => {
  const res = await post('/api/events', {
    code: 'dev-code',
    events: [
      { type: 'app_open', target: '1007|pages/index/index|other', ts: FIXED_NOW + 180 * 1000 },
      { type: 'hack', ts: FIXED_NOW + 180 * 1000 },
      { type: 'checkin', target: '', ts: FIXED_NOW + 180 * 1000 }
    ]
  })
  assert.equal(res.status, 200)
  assert.equal(res.body.accepted, 2, '有效事件必须仍然入库')
  assert.equal(res.body.dropped, 1)
})

test('add_tip 在事件白名单内（小程序引导的曝光与点击）', async () => {
  const res = await post('/api/events', {
    code: 'dev-code',
    events: [
      { type: 'add_tip', target: 'show', ts: FIXED_NOW + 210 * 1000 },
      { type: 'add_tip', target: 'tap', ts: FIXED_NOW + 211 * 1000 }
    ]
  })
  assert.equal(res.status, 200)
  assert.equal(res.body.accepted, 2)
})

test('audio_interrupt 在事件白名单内（外部中断可观测）', async () => {
  const res = await post('/api/events', {
    code: 'dev-code',
    events: [
      { type: 'audio_interrupt', target: 'begin|sleep-10001', ts: FIXED_NOW + 120 * 1000 },
      { type: 'audio_interrupt', target: 'end|12s|resume', ts: FIXED_NOW + 120 * 1000 }
    ]
  })
  assert.equal(res.status, 200)
  assert.equal(res.body.accepted, 2)
})

test('环境音收藏：同一人重复收藏不重复计数，取消后归零', async () => {
  const first = await fetch(base + '/api/audio/favorites')
  const firstBody = await first.json()
  assert.equal(first.status, 200)
  assert.equal(firstBody.real['sleep-10001'], 0)

  const add = await post('/api/audio/favorite', { code: 'dev-code', trackId: 'sleep-10001', on: true })
  assert.equal(add.status, 200)
  assert.equal(add.body.real, 1)

  const again = await post('/api/audio/favorite', { code: 'dev-code', trackId: 'sleep-10001', on: true })
  assert.equal(again.body.real, 1, '主键去重：同一 openid 只算一次')

  const listed = await fetch(base + '/api/audio/favorites')
  assert.equal((await listed.json()).real['sleep-10001'], 1)

  const remove = await post('/api/audio/favorite', { code: 'dev-code', trackId: 'sleep-10001', on: false })
  assert.equal(remove.body.real, 0)
})

test('环境音收藏：未知曲目与缺参数都被拒绝（不往统计表灌脏数据）', async () => {
  const unknown = await post('/api/audio/favorite', { code: 'dev-code', trackId: 'not-exist', on: true })
  assert.equal(unknown.status, 400)

  const noCode = await post('/api/audio/favorite', { trackId: 'sleep-10001', on: true })
  assert.equal(noCode.status, 400)
})

test('环境音人气接口只下发真实数：基数走 /api/config，由客户端合成展示值', async () => {
  const fileConfig = JSON.parse(JSON.stringify(require('../config/app.config.json')))
  fileConfig.audio[0].favBase = 713
  const favDb = createMemoryDb()
  const favApp = createApp({
    config: loadConfig({ NODE_ENV: 'test', ALLOW_DEV_LOGIN: '1', DB_MODE: 'memory' }),
    db: favDb,
    configStore: createConfigStore({
      db: favDb,
      fileConfig,
      logger: { log() {}, error() {} }
    }),
    logger: { log() {}, error() {} },
    now: () => FIXED_NOW
  })
  const favServer = favApp.listen(0)
  await new Promise((resolve) => favServer.once('listening', resolve))
  const favBase = 'http://127.0.0.1:' + favServer.address().port
  try {
    // 基数只经配置通道下发；real 不含基数，否则运营调低基数后旧展示值会压住新值
    const config = await (await fetch(favBase + '/api/config')).json()
    assert.equal(config.audio[0].favBase, 713)

    const before = await (await fetch(favBase + '/api/audio/favorites')).json()
    assert.equal(before.real['sleep-10001'], 0)

    const added = await (
      await fetch(favBase + '/api/audio/favorite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'dev-code', trackId: 'sleep-10001', on: true })
      })
    ).json()
    assert.equal(added.real, 1)

    const removed = await (
      await fetch(favBase + '/api/audio/favorite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'dev-code', trackId: 'sleep-10001', on: false })
      })
    ).json()
    assert.equal(removed.real, 0)
  } finally {
    await new Promise((resolve) => favServer.close(resolve))
  }
})

test('环境音人气统计失败时降级为 0，不让列表接口 500', async () => {
  const failDb = createMemoryDb()
  failDb.countAudioFavorites = async () => {
    throw new Error('boom')
  }
  const fileConfig = JSON.parse(JSON.stringify(require('../config/app.config.json')))
  fileConfig.audio[0].favBase = 713
  const failApp = createApp({
    config: loadConfig({ NODE_ENV: 'test', ALLOW_DEV_LOGIN: '1', DB_MODE: 'memory' }),
    db: failDb,
    configStore: createConfigStore({
      db: failDb,
      fileConfig,
      logger: { log() {}, error() {} }
    }),
    logger: { log() {}, error() {} },
    now: () => FIXED_NOW
  })
  const failServer = failApp.listen(0)
  await new Promise((resolve) => failServer.once('listening', resolve))
  const failBase = 'http://127.0.0.1:' + failServer.address().port
  try {
    const res = await fetch(failBase + '/api/audio/favorites')
    assert.equal(res.status, 200, '统计挂掉也必须 200，客户端按基数展示')
    const body = await res.json()
    assert.equal(body.real['sleep-10001'], 0)
  } finally {
    await new Promise((resolve) => failServer.close(resolve))
  }
})

test('环境音收藏超过 openid 配额返回 429', async () => {
  const favDb = createMemoryDb()
  const favApp = createApp({
    config: loadConfig({ NODE_ENV: 'test', ALLOW_DEV_LOGIN: '1', DB_MODE: 'memory' }),
    db: favDb,
    logger: { log() {}, error() {} },
    now: () => FIXED_NOW
  })
  const favServer = favApp.listen(0)
  await new Promise((resolve) => favServer.once('listening', resolve))
  const favBase = 'http://127.0.0.1:' + favServer.address().port
  try {
    const body = JSON.stringify({ code: 'dev-code', trackId: 'sleep-10001', on: true })
    let lastStatus = 0
    // 配额 30/分钟/openid：第 31 次必须被限流（dev 模式恒为 dev_openid）
    for (let i = 0; i < 31; i += 1) {
      const res = await fetch(favBase + '/api/audio/favorite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body
      })
      lastStatus = res.status
    }
    assert.equal(lastStatus, 429)
  } finally {
    await new Promise((resolve) => favServer.close(resolve))
  }
})

test('背景人气接口只下发真实数：同一人多次使用算多次，基数走配置通道', async () => {
  const fileConfig = JSON.parse(JSON.stringify(require('../config/app.config.json')))
  fileConfig.backgrounds = [
    {
      id: 'bg-1',
      title: '湖面',
      category: '夜色',
      url: 'https://example.com/bg.jpg',
      enabled: true,
      useBase: 713
    }
  ]
  const bgDb = createMemoryDb()
  const bgApp = createApp({
    config: loadConfig({ NODE_ENV: 'test', ALLOW_DEV_LOGIN: '1', DB_MODE: 'memory' }),
    db: bgDb,
    configStore: createConfigStore({
      db: bgDb,
      fileConfig,
      logger: { log() {}, error() {} }
    }),
    logger: { log() {}, error() {} },
    now: () => FIXED_NOW
  })
  const bgServer = bgApp.listen(0)
  await new Promise((resolve) => bgServer.once('listening', resolve))
  const bgBase = 'http://127.0.0.1:' + bgServer.address().port
  try {
    // 基数只经配置通道下发；real 不含基数（与收藏同一套「基数+真实」客户端合成口径）
    const config = await (await fetch(bgBase + '/api/config')).json()
    assert.equal(config.backgrounds[0].useBase, 713)

    const before = await (await fetch(bgBase + '/api/backgrounds/uses')).json()
    assert.equal(before.real['bg-1'], 0)

    const use = async (bgId) =>
      fetch(bgBase + '/api/backgrounds/use', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'dev-code', bgId })
      })

    const first = await (await use('bg-1')).json()
    assert.equal(first.real, 1)

    // 与收藏不同：换用同一张背景多次是真实使用行为，每次都累加
    const second = await (await use('bg-1')).json()
    assert.equal(second.real, 2)

    const unknown = await use('not-exist')
    assert.equal(unknown.status, 400, '未上架的背景不能写入统计')
  } finally {
    await new Promise((resolve) => bgServer.close(resolve))
  }
})
