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
