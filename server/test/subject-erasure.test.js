/**
 * 全量清除（compliance erase）的代际边界。
 *
 * 背景：清除水位原先只对「睡眠记录同步」和「事件写入」生效，
 * 解锁、提醒、反馈、收藏、背景使用都不检查水位，
 * 于是「删除前已发出、删除后才落库」的请求会把数据写回——
 * 对含联系方式的反馈与待发送提醒来说这是隐私事故。
 *
 * 口径：请求在首个 await 之前取 requestStartedAt；
 * requestStartedAt < 清除水位 = 清除前已在途 → 拒绝（409 DATA_ERASED）；
 * requestStartedAt >= 清除水位 = 清除后的新动作 → 允许。
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')

const { createMemoryDb } = require('../src/db')

function record(day, updatedAt) {
  return {
    day,
    bedAt: updatedAt - 8 * 60 * 60 * 1000,
    wakeAt: updatedAt,
    durationMin: 480,
    updatedAt
  }
}

function assertErased(error) {
  assert.equal(error.status, 409)
  assert.equal(error.code, 'DATA_ERASED')
  return true
}

test('清除前已在途的写入全部被拒（解锁 / 提醒 / 反馈 / 收藏 / 背景使用 / 事件）', async () => {
  const db = createMemoryDb()
  const now = Date.now()
  const openid = 'erase-inflight'

  await db.eraseUserData(openid, now + 1000)

  await assert.rejects(() => db.saveUnlock(openid, now + 60 * 60 * 1000, now), assertErased)
  await assert.rejects(
    () =>
      db.saveReminder(
        openid,
        { sessionId: 's-1', fireAt: now + 60 * 1000, templateId: 'tpl', page: 'p' },
        now
      ),
    assertErased
  )
  await assert.rejects(
    () => db.insertFeedback(openid, { type: 'SUGGEST', content: '希望有篝火声' }, now),
    assertErased
  )
  await assert.rejects(() => db.setAudioFavorite(openid, 'sleep-1', true, now), assertErased)
  await assert.rejects(() => db.addBackgroundUse(openid, 'bg-1', now), assertErased)
  await assert.rejects(
    () => db.insertEvents(openid, [{ type: 'app_open', target: '', ts: now + 2000 }], now),
    assertErased
  )
})

test('清除之后的新动作仍然可用（不能把 openid 永久封禁）', async () => {
  const db = createMemoryDb()
  const now = Date.now()
  const openid = 'erase-after'

  await db.eraseUserData(openid, now)
  const later = now + 1000

  await db.saveUnlock(openid, later + 60 * 60 * 1000, later)
  assert.equal(await db.getUnlock(openid), later + 60 * 60 * 1000)

  const saved = await db.saveReminder(
    openid,
    { sessionId: 's-2', fireAt: later + 60 * 1000, templateId: 'tpl', page: 'p' },
    later
  )
  assert.equal(saved, true)

  const feedback = await db.insertFeedback(
    openid,
    { type: 'MUSIC', content: '想听海浪', createdAt: later },
    later
  )
  assert.ok(feedback.id > 0)

  await db.setAudioFavorite(openid, 'sleep-1', true, later)
  await db.addBackgroundUse(openid, 'bg-1', later)
  const inserted = await db.insertEvents(
    openid,
    [{ id: 'evt-after', type: 'app_open', target: '', ts: later }],
    later
  )
  assert.equal(inserted, 1)
})

test('清除水位只前进不后退（乱序到达的旧删除请求不能降低边界）', async () => {
  const db = createMemoryDb()
  const now = Date.now()
  const openid = 'erase-order'

  await db.eraseUserData(openid, now + 5000)
  await db.eraseUserData(openid, now + 1000)
  assert.equal(await db.getErasure(openid), now + 5000)
})

test('清除前已在途的同步不写入，但把清除水位带回客户端', async () => {
  const db = createMemoryDb()
  const now = Date.now()
  const openid = 'erase-inflight-sync'

  await db.eraseUserData(openid, now + 1000)
  const result = await db.syncRecords(
    openid,
    [record('2026-10-20', now + 2000)],
    [],
    now + 2000,
    now
  )
  assert.equal(result.accepted, 0)
  assert.deepEqual(result.records, [])
  assert.equal(result.erasedAt, now + 1000)
})

test('清除回执覆盖全部数据类别（提醒按条数而不是按桶）', async () => {
  const db = createMemoryDb()
  const now = Date.now()
  const openid = 'erase-count'

  await db.saveReminder(
    openid,
    { sessionId: 's-1', fireAt: now + 1000, templateId: 'tpl', page: 'p' },
    now
  )
  await db.saveReminder(
    openid,
    { sessionId: 's-2', fireAt: now + 2000, templateId: 'tpl', page: 'p' },
    now
  )
  await db.setAudioFavorite(openid, 'sleep-1', true, now)
  await db.setAudioFavorite(openid, 'sleep-2', true, now)
  await db.addBackgroundUse(openid, 'bg-1', now)
  await db.addBackgroundUse(openid, 'bg-1', now)
  await db.insertFeedback(openid, { type: 'ISSUE', content: '有个问题' }, now)

  const result = await db.eraseUserData(openid, now + 1000)
  assert.equal(result.reminders, 2)
  assert.equal(result.favorites, 1)
  assert.equal(result.backgroundUses, 2)
  assert.equal(result.feedback, 1)
  assert.equal(result.erasedAt, now + 1000)
})

test('未来时间戳的旧记录在清除后不能写回', async () => {
  const db = createMemoryDb()
  const now = Date.now()
  const openid = 'erase-future'

  await db.eraseUserData(openid, now)

  // 设备时钟快 1 小时：旧记录自称来自未来，凭 updatedAt 可绕过清除水位
  const future = await db.syncRecords(
    openid,
    [record('2026-10-20', now + 60 * 60 * 1000)],
    [],
    now + 1000,
    now + 1000
  )
  assert.equal(future.accepted, 0)
  assert.equal(future.dropped, 1)
  assert.deepEqual(future.records, [])
})

test('正常的同步在清除后仍可写入新记录', async () => {
  const db = createMemoryDb()
  const now = Date.now()
  const openid = 'erase-new-record'

  await db.eraseUserData(openid, now)
  const result = await db.syncRecords(
    openid,
    [record('2026-10-20', now + 2000)],
    [],
    now + 2000,
    now + 2000
  )
  assert.equal(result.accepted, 1)
  assert.equal(result.records.length, 1)
})

test('显式上报的未来 updatedAt 被拒（设备时钟偏快也不能写回）', () => {
  const { validateRecords } = require('../src/lib/validate')
  const now = Date.now()
  const base = {
    day: '2026-10-20',
    bedAt: now - 8 * 60 * 60 * 1000,
    wakeAt: now,
    durationMin: 480
  }

  // 未来 1 小时：旧的 24 小时容差会让它写回
  const future = validateRecords([Object.assign({}, base, { updatedAt: now + 60 * 60 * 1000 })], { now })
  assert.equal(future.records.length, 0)
  assert.equal(future.dropped, 1)

  // 轻微偏差（30 秒）：正常设备抖动必须能通过
  const slight = validateRecords([Object.assign({}, base, { updatedAt: now + 30 * 1000 })], { now })
  assert.equal(slight.records.length, 1)
})

test('客户端事件 id 去重：网络重试不重复计数', async () => {
  const db = createMemoryDb()
  const now = Date.now()
  const openid = 'event-idem'

  const first = await db.insertEvents(
    openid,
    [{ id: 'evt-1', type: 'audio_play', target: 'sleep-1', ts: now }],
    now
  )
  const retry = await db.insertEvents(
    openid,
    [{ id: 'evt-1', type: 'audio_play', target: 'sleep-1', ts: now }],
    now
  )
  assert.equal(first, 1)
  assert.equal(retry, 0)
  assert.equal(await db.countEvents(openid), 1)
})

test('没有事件 id 的旧客户端仍然可以上报', async () => {
  const db = createMemoryDb()
  const now = Date.now()
  const inserted = await db.insertEvents(
    'event-legacy',
    [{ type: 'app_open', target: '', ts: now }],
    now
  )
  assert.equal(inserted, 1)
})

test('仅删云端副本不写水位：本机记录可再次上传', async () => {
  const db = createMemoryDb()
  const now = Date.now()
  const openid = 'cloud-only'

  await db.syncRecords(openid, [record('2026-10-19', now)], [], now, now)
  await db.eraseCloudData(openid)
  assert.equal(await db.getErasure(openid), 0)

  const again = await db.syncRecords(openid, [record('2026-10-19', now + 1000)], [], now + 1000, now + 1000)
  assert.equal(again.accepted, 1)
  assert.ok(again.records.length >= 1)
})
