const test = require('node:test')
const assert = require('node:assert/strict')

const PG_URL = process.env.PG_TEST_URL || process.env.TEST_DATABASE_URL || ''
const maybe = PG_URL ? test : test.skip

// 只在显式提供 PG_TEST_URL 时执行；普通 npm test 跳过，CI/发布门禁必须带真实 PG 跑。
maybe('PostgreSQL：sync 墓碑 / erasure / 解锁 / 事件过滤', async () => {
  const { createPostgresDb } = require('../src/db')
  const db = createPostgresDb(PG_URL)
  const openid = 'pg_test_' + Date.now().toString(36)
  const now = Date.now()
  try {
    await db.init()
    const record = {
      day: '2026-10-14',
      bedAt: now - 8 * 60 * 60 * 1000,
      wakeAt: now,
      durationMin: 480,
      updatedAt: now
    }
    const first = await db.syncRecords(openid, [record], [], now)
    assert.equal(first.accepted, 1)
    assert.equal(first.records.length, 1)

    const deleted = await db.syncRecords(
      openid,
      [],
      [{ day: record.day, deletedAt: now + 1000 }],
      now + 1000
    )
    assert.equal(deleted.records.length, 0)
    assert.equal(deleted.deletedDays.length, 1)

    const replay = await db.syncRecords(openid, [record], [], now + 2000)
    assert.equal(replay.accepted, 0)

    const fresh = Object.assign({}, record, {
      day: '2026-10-15',
      bedAt: now - 4 * 60 * 60 * 1000,
      wakeAt: now + 1000,
      updatedAt: now + 3000
    })
    const accepted = await db.syncRecords(openid, [fresh], [], now + 3000)
    assert.equal(accepted.accepted, 1)

    await db.eraseCloudData(openid)
    assert.deepEqual(await db.getRecords(openid), [])

    await db.saveUnlock(openid, now + 3600 * 1000)
    assert.equal(await db.getUnlock(openid), now + 3600 * 1000)

    await db.eraseUserData(openid, now + 4000)
    assert.equal(await db.getErasure(openid), now + 4000)

    const oldEvent = { type: 'app_open', target: 'x', ts: now }
    const acceptedEvents = await db.insertEvents(openid, [oldEvent])
    assert.equal(acceptedEvents, 0)
    assert.equal(await db.countEvents(openid), 0)

    await db.logAdminAction('test', 'tag', { ok: true })
    const audit = await db.pool.query('SELECT count(*)::int AS n FROM admin_audit WHERE openid_tag = $1', ['tag'])
    assert.ok(Number(audit.rows[0].n) >= 1)
  } finally {
    try {
      await db.pool.query('DELETE FROM sleep_records WHERE openid = $1', [openid])
      await db.pool.query('DELETE FROM sleep_record_deletions WHERE openid = $1', [openid])
      await db.pool.query('DELETE FROM user_erasures WHERE openid = $1', [openid])
      await db.pool.query('DELETE FROM audio_unlocks WHERE openid = $1', [openid])
      await db.pool.query('DELETE FROM events WHERE openid = $1', [openid])
      await db.pool.query("DELETE FROM admin_audit WHERE openid_tag = 'tag'")
    } catch (e) {}
    await db.close().catch(() => {})
  }
})

// 清除代际：水位只前进不后退、在途写入被拒、事件 id 去重。
maybe('PostgreSQL：清除代际 / 水位单调 / 事件幂等', async () => {
  const { createPostgresDb } = require('../src/db')
  const db = createPostgresDb(PG_URL)
  const openid = 'pg_erase_' + Date.now().toString(36)
  const now = Date.now()
  try {
    await db.init()

    // 水位只前进：后到的旧删除请求不能把边界拉低
    await db.eraseUserData(openid, now + 5000)
    await db.eraseUserData(openid, now + 1000)
    assert.equal(await db.getErasure(openid), now + 5000)

    // 清除前已在途的写入被拒（409 DATA_ERASED）
    await assert.rejects(
      () => db.saveUnlock(openid, now + 3600 * 1000, now),
      (error) => {
        assert.equal(error.status, 409)
        assert.equal(error.code, 'DATA_ERASED')
        return true
      }
    )
    await assert.rejects(
      () => db.insertFeedback(openid, { type: 'SUGGEST', content: 'x' }, now),
      (error) => error.code === 'DATA_ERASED'
    )

    // 清除后新动作仍然可用
    await db.saveUnlock(openid, now + 7200 * 1000, now + 6000)
    assert.equal(await db.getUnlock(openid), now + 7200 * 1000)

    // 清除前已在途的同步：不写入，但带回水位
    const inflight = await db.syncRecords(
      openid,
      [
        {
          day: '2026-10-18',
          bedAt: now - 8 * 60 * 60 * 1000,
          wakeAt: now,
          durationMin: 480,
          updatedAt: now + 6000
        }
      ],
      [],
      now + 6000,
      now
    )
    assert.equal(inflight.accepted, 0)
    assert.equal(inflight.erasedAt, now + 5000)

    // 客户端事件 id 去重：同一批次重试只入库一次
    const eventId = 'pg-evt-' + Date.now().toString(36)
    const first = await db.insertEvents(
      openid,
      [{ id: eventId, type: 'audio_play', target: 'sleep-1', ts: now + 7000 }],
      now + 7000
    )
    const retry = await db.insertEvents(
      openid,
      [{ id: eventId, type: 'audio_play', target: 'sleep-1', ts: now + 7000 }],
      now + 7000
    )
    assert.equal(first, 1)
    assert.equal(retry, 0)
  } finally {
    try {
      await db.pool.query('DELETE FROM sleep_records WHERE openid = $1', [openid])
      await db.pool.query('DELETE FROM sleep_record_deletions WHERE openid = $1', [openid])
      await db.pool.query('DELETE FROM user_erasures WHERE openid = $1', [openid])
      await db.pool.query('DELETE FROM audio_unlocks WHERE openid = $1', [openid])
      await db.pool.query('DELETE FROM events WHERE openid = $1', [openid])
      await db.pool.query('DELETE FROM user_feedback WHERE openid = $1', [openid])
    } catch (e) {}
    await db.close().catch(() => {})
  }
})
