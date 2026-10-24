const { test } = require('node:test')
const assert = require('node:assert/strict')

const { createMemoryDb } = require('../src/db')
const { createReminderService } = require('../src/services/reminders')
const { createApp } = require('../src/app')
const { loadConfig } = require('../src/config')

test('调度器发送到点提醒并标记 sent', async () => {
  const db = createMemoryDb()
  const now = Date.now()
  await db.saveReminder('openid-1', {
    sessionId: 'sleep-1',
    fireAt: now - 1000,
    templateId: 'tmpl-test',
    page: 'pages/sleep/sleep?end=1'
  })
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: options && options.body })
    if (url.indexOf('stable_token') >= 0) {
      return { json: async () => ({ access_token: 'token-test', expires_in: 7200 }) }
    }
    return { json: async () => ({ errcode: 0 }) }
  }
  const service = createReminderService({
    db,
    wx: { appid: 'appid-test', secret: 'secret-test', fetchImpl },
    templateId: 'tmpl-test',
    now: () => now
  })
  await service.tick()
  assert.equal(calls.filter((item) => item.url.indexOf('subscribe/send') >= 0).length, 1)
  const due = await db.dueReminders(now + 1000, 10)
  assert.equal(due.length, 0)
})

test('清除全部数据会删除待发送提醒（避免清除后仍收到推送）', async () => {
  const db = createMemoryDb()
  const now = Date.now()
  await db.saveReminder('openid-erase', {
    sessionId: 'sleep-erase',
    fireAt: now + 60 * 1000,
    templateId: 'tmpl-test',
    page: 'pages/sleep/sleep?end=1'
  })
  const result = await db.eraseUserData('openid-erase', now)
  assert.equal(result.reminders, 1)
  assert.equal((await db.dueReminders(now + 2 * 60 * 1000, 10)).length, 0)
})

test('只删云端副本同样删除提醒，但不动 erasure 水位', async () => {
  const db = createMemoryDb()
  const now = Date.now()
  await db.saveReminder('openid-cloud', {
    sessionId: 'sleep-cloud',
    fireAt: now + 60 * 1000,
    templateId: 'tmpl-test',
    page: 'pages/sleep/sleep?end=1'
  })
  const result = await db.eraseCloudData('openid-cloud')
  assert.equal(result.reminders, 1)
  assert.equal(await db.getErasure('openid-cloud'), 0)
  assert.equal((await db.dueReminders(now + 2 * 60 * 1000, 10)).length, 0)
})

test('提醒创建/取消路由要求模板配置并写库', async () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    ALLOW_DEV_LOGIN: '1',
    DB_MODE: 'memory',
    ADMIN_PASSWORD: 'test-admin-pass',
    WX_REMINDER_TEMPLATE_ID: 'tmpl-test'
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
  const fireAt = Date.now() + 10 * 60 * 1000
  const created = await fetch(base + '/api/reminders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'reminder-code', action: 'create', sessionId: 'sleep-1', fireAt })
  })
  assert.equal(created.status, 200)
  const cancelled = await fetch(base + '/api/reminders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'reminder-code', action: 'cancel', sessionId: 'sleep-1' })
  })
  assert.equal(cancelled.status, 200)
  app.locals.reminderService.stop()
  await new Promise((resolve) => server.close(resolve))
})

test('过期超过 15 分钟的提醒不补发，标记 expired', async () => {
  const db = createMemoryDb()
  const now = Date.now()
  await db.saveReminder('openid-stale', {
    sessionId: 'sleep-stale',
    fireAt: now - 2 * 60 * 60 * 1000,
    templateId: 'tmpl-test',
    page: 'pages/sleep/sleep?end=1'
  })
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    if (url.indexOf('stable_token') >= 0) {
      return { json: async () => ({ access_token: 'token-test', expires_in: 7200 }) }
    }
    return { json: async () => ({ errcode: 0 }) }
  }
  const service = createReminderService({
    db,
    wx: { appid: 'appid-test', secret: 'secret-test', fetchImpl },
    templateId: 'tmpl-test',
    now: () => now
  })
  try {
    await service.tick()
    assert.equal(
      calls.filter((url) => url.indexOf('subscribe/send') >= 0).length,
      0,
      '迟到 2 小时的提醒不应调用微信接口'
    )
    assert.equal((await db.dueReminders(now + 1000, 10)).length, 0, '处理后不应再命中 due')
  } finally {
    service.stop()
  }
})

test('后台配置的模板 ID 优先于环境变量，关闭后立即拒绝创建', async () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    ALLOW_DEV_LOGIN: '1',
    DB_MODE: 'memory',
    ADMIN_PASSWORD: 'test-admin-pass'
  })
  // 启动时没有 env 模板：旧实现会因此永不启动调度器、路由也永远 503
  assert.equal(config.wx.reminderTemplateId, '')

  const db = createMemoryDb()
  let current = {
    config: Object.assign({}, config.app, {
      reminder: { enabled: true, templateId: 'tmpl-admin', page: 'pages/sleep/sleep?end=1' }
    })
  }
  const configStore = {
    get: async () => current,
    set: async (next) => {
      current = next
      return next
    }
  }
  const app = createApp({
    config,
    db,
    configStore,
    logger: { log() {}, error() {} },
    now: () => Date.now()
  })
  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const base = 'http://127.0.0.1:' + server.address().port
  const fireAt = Date.now() + 10 * 60 * 1000
  try {
    const created = await fetch(base + '/api/reminders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'admin-code', action: 'create', sessionId: 'sleep-a', fireAt })
    })
    assert.equal(created.status, 200, '后台填了模板后应立即可用')

    current = {
      config: Object.assign({}, current.config, {
        reminder: { enabled: false, templateId: 'tmpl-admin', page: 'pages/sleep/sleep?end=1' }
      })
    }
    const disabled = await fetch(base + '/api/reminders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'admin-code', action: 'create', sessionId: 'sleep-b', fireAt })
    })
    assert.equal(disabled.status, 503, '后台关闭后不应再创建新提醒')
  } finally {
    app.locals.reminderService.stop()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('模板字段名按后台映射发送（time1/thing2 也能用）', async () => {
  const db = createMemoryDb()
  const now = Date.now()
  await db.saveReminder('openid-map', {
    sessionId: 'sleep-map',
    fireAt: now - 1000,
    templateId: 'tmpl-map',
    page: 'pages/sleep/sleep?end=1'
  })
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: options && options.body })
    if (url.indexOf('stable_token') >= 0) {
      return { json: async () => ({ access_token: 'token-test', expires_in: 7200 }) }
    }
    return { json: async () => ({ errcode: 0 }) }
  }
  const service = createReminderService({
    db,
    wx: { appid: 'appid-test', secret: 'secret-test', fetchImpl },
    getReminder: async () => ({
      enabled: true,
      templateId: 'tmpl-map',
      page: 'pages/sleep/sleep?end=1',
      thingKey: 'thing2',
      timeKey: 'time1'
    }),
    now: () => now
  })
  await service.tick()
  const send = calls.filter((item) => item.url.indexOf('subscribe/send') >= 0)[0]
  assert.ok(send, '应调用订阅消息发送')
  const body = JSON.parse(send.body)
  assert.deepEqual(Object.keys(body.data).sort(), ['thing2', 'time1'])
  assert.equal(body.data.thing2.value, '结束入睡')
  // 与模板参数示例一致：完整日期时间（北京时间），而不是裸 HH:mm
  assert.match(body.data.time1.value, /^\d{4}年\d{1,2}月\d{1,2}日 \d{2}:\d{2}$/)
})

test('结果面提醒按来源发送不同事项文案（该睡了 / 该起床了）', async () => {
  const db = createMemoryDb()
  const now = Date.now()
  await db.saveReminder('openid-kind', {
    sessionId: 'plan-s-1700000000000',
    fireAt: now - 1000,
    templateId: 'tmpl-kind',
    page: 'pages/sleep/sleep?end=1'
  })
  await db.saveReminder('openid-kind', {
    sessionId: 'plan-w-1700000000001',
    fireAt: now - 1000,
    templateId: 'tmpl-kind',
    page: 'pages/sleep/sleep?end=1'
  })
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: options && options.body })
    if (url.indexOf('stable_token') >= 0) {
      return { json: async () => ({ access_token: 'token-test', expires_in: 7200 }) }
    }
    return { json: async () => ({ errcode: 0 }) }
  }
  const service = createReminderService({
    db,
    wx: { appid: 'appid-test', secret: 'secret-test', fetchImpl },
    templateId: 'tmpl-kind',
    now: () => now
  })
  await service.tick()
  const sends = calls
    .filter((item) => item.url.indexOf('subscribe/send') >= 0)
    .map((item) => JSON.parse(item.body))
  assert.equal(sends.length, 2)
  const things = sends.map((body) => body.data.thing1.value).sort()
  assert.deepEqual(things, ['该睡了', '该起床了'])
  // 已排队行的 page 仍是 end=1（旧版本写入），发送时必须按前缀纠正：
  // 「该睡了」落到 end=1 会在已打卡时直接弹出结束面板。
  const pages = {}
  sends.forEach((body) => {
    pages[body.data.thing1.value] = body.page
  })
  assert.equal(pages['该睡了'], 'pages/sleep/sleep?remind=sleep')
  assert.equal(pages['该起床了'], 'pages/sleep/sleep?remind=wake')
})

test('pageFor：只改写计划提醒，打卡会话沿用后台配置', () => {
  const { pageFor } = require('../src/services/reminders')
  assert.equal(pageFor('plan-s-1', 'pages/sleep/sleep?end=1'), 'pages/sleep/sleep?remind=sleep')
  assert.equal(pageFor('plan-w-1', 'pages/sleep/sleep?end=1'), 'pages/sleep/sleep?remind=wake')
  assert.equal(pageFor('sleep-1', 'pages/sleep/sleep?end=1'), 'pages/sleep/sleep?end=1')
  assert.equal(pageFor('sleep-1', 'pages/index/index'), 'pages/index/index')
})

test('路由创建计划提醒时写入分流后的落地页', async () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    ALLOW_DEV_LOGIN: '1',
    DB_MODE: 'memory',
    ADMIN_PASSWORD: 'test-admin-pass',
    WX_REMINDER_TEMPLATE_ID: 'tmpl-test'
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
  const fireAt = Date.now() + 10 * 60 * 1000
  try {
    for (const sessionId of ['plan-s-' + fireAt, 'sleep-' + fireAt]) {
      const res = await fetch(base + '/api/reminders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'plan-code', action: 'create', sessionId, fireAt })
      })
      assert.equal(res.status, 200)
    }
    const due = await db.dueReminders(fireAt + 1000, 10)
    const byId = {}
    due.forEach((item) => {
      byId[item.sessionId.split('-')[0]] = item.page
    })
    assert.equal(byId.plan, 'pages/sleep/sleep?remind=sleep')
    assert.equal(byId.sleep, 'pages/sleep/sleep?end=1')
  } finally {
    app.locals.reminderService.stop()
    await new Promise((resolve) => server.close(resolve))
  }
})
