/**
 * /records/sync 的 openid 维度限流。
 *
 * 背景：仓库部署是 1Panel/Nginx 反代，若 TRUST_PROXY 漏配，req.ip 恒为代理地址，
 * 全站用户会共用同一个 IP 桶（120/min）。400 天用户一次完整同步 7 片，
 * 十几个用户就能打满。这里用 openid 桶（30/min）兜住，并与 IP 桶独立。
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')

const { createApp } = require('../src/app')
const { loadConfig } = require('../src/config')
const { createMemoryDb } = require('../src/db')

test('同一 openid 第 31 次 /records/sync 返回 429', async () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    ALLOW_DEV_LOGIN: '1',
    DB_MODE: 'memory'
  })
  const db = createMemoryDb()
  const app = createApp({
    config,
    db,
    logger: { log() {}, error() {} },
    now: () => Date.now()
  })
  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const base = 'http://127.0.0.1:' + server.address().port
  try {
    const body = JSON.stringify({ code: 'dev-code', records: [], includeAll: false })
    for (let i = 0; i < 30; i += 1) {
      const res = await fetch(base + '/api/records/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body
      })
      assert.equal(res.status, 200, '第 ' + (i + 1) + ' 次应通过')
    }
    const limited = await fetch(base + '/api/records/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body
    })
    assert.equal(limited.status, 429, '第 31 次应被 openid 桶拦下')
    const payload = await limited.json()
    const code =
      payload.code || (payload.error && payload.error.code) || payload.errorCode || ''
    assert.equal(code, 'RATE_LIMITED')
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
