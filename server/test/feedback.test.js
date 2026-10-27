const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')

const { createApp } = require('../src/app')
const { loadConfig } = require('../src/config')
const { createMemoryDb } = require('../src/db')

const PASSWORD = 'test-admin-pass'
const FIXED_NOW = Date.UTC(2026, 9, 27, 2, 0)

let server = null
let base = ''
let db = null
let cookie = ''
let offServer = null
let offBase = ''
let throttleServer = null
let throttleBase = ''

function listen(app) {
  return new Promise((resolve) => {
    const instance = app.listen(0, () => {
      resolve({ instance, base: 'http://127.0.0.1:' + instance.address().port })
    })
  })
}

function cookieFrom(res) {
  const list = res.headers.getSetCookie ? res.headers.getSetCookie() : []
  const raw = list[0] || res.headers.get('set-cookie') || ''
  return raw.split(';')[0]
}

async function call(target, path, options, useCookie) {
  const init = Object.assign({}, options || {})
  init.headers = Object.assign({}, init.headers || {})
  if (useCookie && cookie) init.headers.cookie = cookie
  if (init.body !== undefined) {
    init.headers['content-type'] = 'application/json'
    init.body = JSON.stringify(init.body)
  }
  const res = await fetch(target + path, init)
  let body = null
  try {
    body = await res.json()
  } catch (e) {
    body = null
  }
  return { status: res.status, body, headers: res.headers }
}

function submit(body) {
  return call(base, '/api/feedback', { method: 'POST', body })
}

before(async () => {
  const quiet = { log() {}, error() {} }
  const baseEnv = {
    NODE_ENV: 'test',
    ALLOW_DEV_LOGIN: '1',
    DB_MODE: 'memory',
    ADMIN_PASSWORD: PASSWORD
  }

  // 主实例：限流放宽，专测业务语义
  const config = loadConfig(Object.assign({}, baseEnv, {
    RATE_FEEDBACK_IP: '100',
    RATE_FEEDBACK_OPENID: '100'
  }))
  db = createMemoryDb()
  const started = await listen(
    createApp({ config, db, logger: quiet, now: () => FIXED_NOW })
  )
  server = started.instance
  base = started.base

  const login = await fetch(base + '/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD })
  })
  cookie = cookieFrom(login)

  // 总闸关闭实例：配置 store 直接返回 features.feedback=false
  const offConfig = loadConfig(baseEnv)
  const offStarted = await listen(
    createApp({
      config: offConfig,
      db: createMemoryDb(),
      logger: quiet,
      now: () => FIXED_NOW,
      configStore: {
        get: async () => ({ config: { features: { feedback: false } } })
      }
    })
  )
  offServer = offStarted.instance
  offBase = offStarted.base

  // 限流实例：IP 桶 1/分钟（第一次通过，第二次 429）
  const throttleConfig = loadConfig(Object.assign({}, baseEnv, {
    RATE_FEEDBACK_IP: '1',
    RATE_FEEDBACK_OPENID: '1'
  }))
  const throttleStarted = await listen(
    createApp({ config: throttleConfig, db: createMemoryDb(), logger: quiet, now: () => FIXED_NOW })
  )
  throttleServer = throttleStarted.instance
  throttleBase = throttleStarted.base
})

after(async () => {
  await Promise.all(
    [server, offServer, throttleServer].map(
      (instance) => new Promise((resolve) => (instance ? instance.close(resolve) : resolve()))
    )
  )
})

test('缺 code 被拒且不落库', async () => {
  const res = await submit({ type: 'SUGGEST', content: '希望有白噪音' })
  assert.equal(res.status, 401)
  assert.equal(res.body.error.code, 'INVALID_CODE')
  const list = await db.listFeedback(20, false)
  assert.equal(list.items.length, 0)
})

test('类型不在白名单被拒', async () => {
  const res = await submit({ code: 'c1', type: 'SPAM', content: '灌水' })
  assert.equal(res.status, 400)
  assert.equal(res.body.error.message, '反馈类型不合法')
})

test('空内容被拒（纯空白也算空）', async () => {
  const res = await submit({ code: 'c1', type: 'MUSIC', content: '   \n  ' })
  assert.equal(res.status, 400)
  assert.equal(res.body.error.message, '请先写下你的想法')
})

test('超过 500 字被拒', async () => {
  const res = await submit({ code: 'c1', type: 'SUGGEST', content: 'a'.repeat(501) })
  assert.equal(res.status, 400)
  assert.equal(res.body.error.message, '反馈最多 500 字')
})

test('联系方式超过 64 字被拒', async () => {
  const res = await submit({
    code: 'c1',
    type: 'SUGGEST',
    content: '留个联系方式',
    contact: 'x'.repeat(65)
  })
  assert.equal(res.status, 400)
  assert.equal(res.body.error.message, '联系方式最多 64 字')
})

test('提交成功：201 + id，内容首尾空白被裁掉', async () => {
  const res = await submit({
    code: 'c1',
    type: 'MUSIC',
    content: '  想听篝火声  ',
    contact: ' wx-me '
  })
  assert.equal(res.status, 201)
  assert.ok(Number.isInteger(res.body.id) && res.body.id > 0)
  assert.equal(res.body.createdAt, FIXED_NOW)

  const list = await db.listFeedback(20, false)
  assert.equal(list.items.length, 1)
  assert.equal(list.items[0].openid, 'dev_openid')
  assert.equal(list.items[0].type, 'MUSIC')
  assert.equal(list.items[0].content, '想听篝火声')
  assert.equal(list.items[0].contact, 'wx-me')
})

test('控制字符被清掉，换行保留', async () => {
  const res = await submit({
    code: 'c1',
    type: 'ISSUE',
    content: '第一行\u0000\n第二行',
    contact: 'a\u0001b'
  })
  assert.equal(res.status, 201)
  const list = await db.listFeedback(20, false)
  const latest = list.items[0]
  assert.equal(latest.content, '第一行\n第二行')
  assert.equal(latest.contact, 'ab')
})

test('后台反馈列表需要登录', async () => {
  const res = await call(base, '/api/admin/feedback', {}, false)
  assert.equal(res.status, 401)
})

test('后台可读列表并标记已处理', async () => {
  const before = await call(base, '/api/admin/feedback?limit=10', {}, true)
  assert.equal(before.status, 200)
  assert.equal(before.body.items.length, 2)
  assert.equal(before.body.unhandled, 2)

  const id = before.body.items[0].id
  const done = await call(
    base,
    '/api/admin/feedback/' + id + '/handled',
    { method: 'POST', body: {} },
    true
  )
  assert.equal(done.status, 200)
  assert.equal(done.body.handled, true)

  const onlyOpen = await call(base, '/api/admin/feedback?onlyOpen=1', {}, true)
  assert.equal(onlyOpen.body.items.length, 1)
  assert.equal(onlyOpen.body.unhandled, 1)

  const missing = await call(base, '/api/admin/feedback/999999/handled', { method: 'POST', body: {} }, true)
  assert.equal(missing.status, 404)
})

test('运营关闭反馈总闸后接口 403', async () => {
  const res = await call(offBase, '/api/feedback', {
    method: 'POST',
    body: { code: 'c1', type: 'SUGGEST', content: '关了也要拦住' }
  })
  assert.equal(res.status, 403)
  assert.equal(res.body.error.code, 'FEATURE_OFF')
})

test('IP 限流生效：第二次立刻 429', async () => {
  const first = await call(throttleBase, '/api/feedback', {
    method: 'POST',
    body: { code: 'c1', type: 'SUGGEST', content: '第一条' }
  })
  assert.equal(first.status, 201)
  const second = await call(throttleBase, '/api/feedback', {
    method: 'POST',
    body: { code: 'c2', type: 'SUGGEST', content: '第二条' }
  })
  assert.equal(second.status, 429)
  assert.equal(second.body.error.code, 'RATE_LIMITED')
})

test('清除用户数据时反馈一并删除', async () => {
  const erased = await db.eraseUserData('dev_openid', FIXED_NOW)
  assert.equal(erased.feedback, 2)
  const list = await db.listFeedback(20, false)
  assert.equal(list.items.length, 0)
  assert.equal(list.unhandled, 0)
})
