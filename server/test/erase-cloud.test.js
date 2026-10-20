const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')

const { createApp } = require('../src/app')
const { loadConfig } = require('../src/config')
const { createMemoryDb } = require('../src/db')

const PASSWORD = 'test-admin-pass'

let server = null
let base = ''

async function call(path, options) {
  const init = Object.assign({}, options || {})
  init.headers = Object.assign({ 'content-type': 'application/json' }, init.headers || {})
  if (init.body !== undefined) init.body = JSON.stringify(init.body)
  const res = await fetch(base + path, init)
  let body = null
  try {
    body = await res.json()
  } catch (e) {
    body = null
  }
  return { status: res.status, body }
}

before(async () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    ALLOW_DEV_LOGIN: '1',
    DB_MODE: 'memory',
    ADMIN_PASSWORD: PASSWORD
  })
  const db = createMemoryDb()
  const app = createApp({
    config,
    db,
    logger: { log() {}, error() {} }
  })
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = 'http://127.0.0.1:' + server.address().port
})

after(() => new Promise((resolve) => server.close(resolve)))

test('cloudOnly 必须是布尔值，字符串不能触发全量 erasure', async () => {
  const wakeAt = Date.now()
  const bedAt = wakeAt - 8 * 60 * 60 * 1000
  const record = { bedAt, wakeAt, updatedAt: wakeAt }
  const first = await call('/api/records/sync', {
    method: 'POST',
    body: { code: 'cloud-only-bool', records: [record] }
  })
  assert.equal(first.status, 200)

  const bad = await call('/api/records/erase', {
    method: 'POST',
    body: { code: 'cloud-only-bool', cloudOnly: 'true' }
  })
  assert.equal(bad.status, 400)
  assert.equal(bad.body.error.code, 'INVALID_BODY')

  const after = await call('/api/records/sync', {
    method: 'POST',
    body: { code: 'cloud-only-bool', records: [] }
  })
  assert.equal(after.status, 200)
  assert.equal(after.body.records.length, 1)
  assert.equal(after.body.erasedAt, 0)

  // 清理，避免与后续用例共享 dev_openid
  await call('/api/records/erase', {
    method: 'POST',
    body: { code: 'cloud-only-bool', cloudOnly: true }
  })
})

test('cloudOnly 删除云端副本不写 erasure 水位，本机记录可再次上传', async () => {
  const wakeAt = Date.now()
  const bedAt = wakeAt - 8 * 60 * 60 * 1000
  const record = { bedAt, wakeAt, updatedAt: wakeAt }

  const first = await call('/api/records/sync', {
    method: 'POST',
    body: { code: 'cloud-only-code', records: [record] }
  })
  assert.equal(first.status, 200)
  assert.equal(first.body.synced, 1)

  const erased = await call('/api/records/erase', {
    method: 'POST',
    body: { code: 'cloud-only-code', cloudOnly: true }
  })
  assert.equal(erased.status, 200)
  assert.equal(erased.body.deleted, 1)
  assert.equal(erased.body.erasedAt, 0)

  const afterErase = await call('/api/records/sync', {
    method: 'POST',
    body: { code: 'cloud-only-code', records: [] }
  })
  assert.equal(afterErase.status, 200)
  assert.equal(afterErase.body.records.length, 0)
  assert.equal(afterErase.body.erasedAt, 0)

  // 没有 erasure 水位：同一份本机记录仍能重新上传
  const again = await call('/api/records/sync', {
    method: 'POST',
    body: { code: 'cloud-only-code', records: [record] }
  })
  assert.equal(again.status, 200)
  assert.equal(again.body.synced, 1)
})
