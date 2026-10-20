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
  const app = createApp({
    config,
    db: createMemoryDb(),
    logger: { log() {}, error() {} }
  })
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = 'http://127.0.0.1:' + server.address().port
})

after(() => new Promise((resolve) => server.close(resolve)))

test('多字节畸形后台 Cookie 不会让鉴权接口 500', async () => {
  const exp = Date.now() + 60 * 1000
  // Latin-1 头字符：JS 字符串长度 64，UTF-8 字节长度 128，正好触发旧的 byte-length 漏洞
  const cookie = 'sleep_admin=v1.' + exp + '.' + 'é'.repeat(64)
  const session = await fetch(base + '/api/admin/session', {
    headers: { cookie }
  })
  assert.equal(session.status, 200)
  assert.equal((await session.json()).authenticated, false)

  const config = await fetch(base + '/api/admin/config', {
    headers: { cookie }
  })
  assert.equal(config.status, 401)
})
