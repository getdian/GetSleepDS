/**
 * 后台登录的 fail-closed 语义。
 *
 * 背景：启动时读取数据库凭据失败曾回退 env 密码（server/src/index.js）。
 * 于是「已改密 → 某次启动读取凭据短暂失败 → 旧 env 密码重新可用」，
 * 与 ADR-013「落库后 env 不再可用」直接冲突。
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')

const { createApp } = require('../src/app')
const { loadConfig } = require('../src/config')
const { createMemoryDb } = require('../src/db')

async function withServer(options, run) {
  const config = loadConfig({
    NODE_ENV: 'test',
    ALLOW_DEV_LOGIN: '1',
    DB_MODE: 'memory',
    ADMIN_PASSWORD: 'test-admin-pass'
  })
  const app = createApp(
    Object.assign({ config, db: createMemoryDb(), logger: { log() {}, error() {} } }, options)
  )
  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const base = 'http://127.0.0.1:' + server.address().port
  try {
    await run(base)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test('凭据不可用时登录返回 503，而不是放行 env 密码', async () => {
  await withServer({ adminAuthDisabled: true }, async (base) => {
    const res = await fetch(base + '/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'test-admin-pass' })
    })
    assert.equal(res.status, 503)
    const body = await res.json()
    assert.equal(body.error.code, 'ADMIN_AUTH_UNAVAILABLE')
  })
})

test('凭据不可用时受保护接口返回 503', async () => {
  await withServer({ adminAuthDisabled: true }, async (base) => {
    const res = await fetch(base + '/api/admin/config')
    assert.equal(res.status, 503)
    const body = await res.json()
    assert.equal(body.error.code, 'ADMIN_AUTH_UNAVAILABLE')
  })
})

test('正常实例不受影响：登录与配置读取照常', async () => {
  await withServer({}, async (base) => {
    const login = await fetch(base + '/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'test-admin-pass' })
    })
    assert.equal(login.status, 200)
    const raw = login.headers.getSetCookie ? login.headers.getSetCookie() : []
    const cookie = (raw[0] || login.headers.get('set-cookie') || '').split(';')[0]

    const config = await fetch(base + '/api/admin/config', { headers: { cookie } })
    assert.equal(config.status, 200)
    const body = await config.json()
    assert.ok(body.config)
    assert.equal(typeof body.revision, 'number')
  })
})
