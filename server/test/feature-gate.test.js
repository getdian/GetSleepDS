const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')

const { createApp } = require('../src/app')
const { loadConfig } = require('../src/config')
const { createMemoryDb } = require('../src/db')

let server = null
let base = ''

before(async () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    DB_MODE: 'memory',
    ALLOW_DEV_LOGIN: '1',
    ADMIN_PASSWORD: 'test-admin-pass'
  })
  const store = {
    async get() {
      return {
        config: {
          features: { sync: false, events: false, summary: false },
          audio: [],
          unlock: { ttlHours: 24 }
        }
      }
    },
    async save() {
      throw new Error('not used')
    }
  }
  const app = createApp({
    config,
    db: createMemoryDb(),
    configStore: store,
    logger: { log() {}, error() {} }
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

test('服务端总闸关闭时 sync/events/summary 都返回 403 FEATURE_OFF', async () => {
  const sync = await post('/api/records/sync', { code: 'gate', records: [] })
  assert.equal(sync.status, 403)
  assert.equal(sync.body.error.code, 'FEATURE_OFF')

  const events = await post('/api/events', {
    code: 'gate',
    events: [{ type: 'app_open', ts: Date.now() }]
  })
  assert.equal(events.status, 403)
  assert.equal(events.body.error.code, 'FEATURE_OFF')

  const summary = await post('/api/summary', { records: [] })
  assert.equal(summary.status, 403)
  assert.equal(summary.body.error.code, 'FEATURE_OFF')
})

test('合规删除通道不受 sync 总闸影响', async () => {
  const erased = await post('/api/records/erase', { code: 'gate' })
  assert.equal(erased.status, 200)
  assert.ok(erased.body.erasedAt > 0)
})
