const { Pool } = require('pg')

const SCHEMA = `
CREATE TABLE IF NOT EXISTS audio_unlocks (
    id           SERIAL PRIMARY KEY,
    openid       VARCHAR(64) NOT NULL,
    unlock_time  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expire_time  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audio_unlocks_openid_expire
    ON audio_unlocks (openid, expire_time DESC);

CREATE TABLE IF NOT EXISTS sleep_records (
    openid       VARCHAR(64) NOT NULL,
    day          DATE NOT NULL,
    bed_at       BIGINT NOT NULL,
    wake_at      BIGINT NOT NULL,
    duration_min INTEGER NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (openid, day)
);

CREATE TABLE IF NOT EXISTS app_config (
    key          TEXT PRIMARY KEY,
    value        JSONB NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS events (
    id          BIGSERIAL PRIMARY KEY,
    openid      VARCHAR(64) NOT NULL,
    type        VARCHAR(24) NOT NULL,
    target      VARCHAR(64) NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events (created_at);
CREATE INDEX IF NOT EXISTS idx_events_type_created ON events (type, created_at);
`

function createMemoryDb() {
  const unlocks = new Map()
  const records = new Map()
  const settings = new Map()
  const events = []
  let appConfig = null

  return {
    mode: 'memory',

    async init() {
      return true
    },

    async health() {
      return 'ok'
    },

    async saveUnlock(openid, expireAt) {
      unlocks.set(openid, expireAt)
    },

    async getUnlock(openid) {
      return unlocks.get(openid) || 0
    },

    async cleanupExpired(now) {
      let removed = 0
      unlocks.forEach((expireAt, openid) => {
        if (expireAt < now - 7 * 24 * 60 * 60 * 1000) {
          unlocks.delete(openid)
          removed += 1
        }
      })
      return removed
    },

    async upsertRecords(openid, list) {
      let bucket = records.get(openid)
      if (!bucket) {
        bucket = new Map()
        records.set(openid, bucket)
      }
      list.forEach((record) => {
        const previous = bucket.get(record.day)
        if (!previous || record.updatedAt >= previous.updatedAt) {
          bucket.set(record.day, record)
        }
      })
      return list.length
    },

    async getRecords(openid) {
      const bucket = records.get(openid)
      return bucket ? Array.from(bucket.values()) : []
    },

    async deleteRecords(openid) {
      const bucket = records.get(openid)
      if (!bucket) return 0
      const count = bucket.size
      records.delete(openid)
      return count
    },

    async getAppConfig() {
      if (!appConfig) return null
      return { value: JSON.parse(JSON.stringify(appConfig.value)), updatedAt: appConfig.updatedAt }
    },

    async saveAppConfig(value) {
      const updatedAt = Date.now()
      appConfig = { value: JSON.parse(JSON.stringify(value)), updatedAt }
      return updatedAt
    },

    async getSetting(key) {
      const row = settings.get(key)
      if (!row) return null
      return { value: JSON.parse(JSON.stringify(row.value)), updatedAt: row.updatedAt }
    },

    async saveSetting(key, value) {
      const updatedAt = Date.now()
      settings.set(key, { value: JSON.parse(JSON.stringify(value)), updatedAt })
      return updatedAt
    },

    async insertEvents(openid, list) {
      const now = Date.now()
      list.forEach((item) => {
        events.push({
          openid,
          type: item.type,
          target: item.target || '',
          ts: item.ts || now
        })
      })
      if (events.length > 50000) events.splice(0, events.length - 50000)
      return list.length
    },

    async listEvents(sinceTs) {
      return events.filter((event) => event.ts >= sinceTs)
    },

    async cleanupEvents(beforeTs) {
      const kept = events.filter((event) => event.ts >= beforeTs)
      const removed = events.length - kept.length
      events.length = 0
      kept.forEach((event) => events.push(event))
      return removed
    },

    async adminStats(nowTs) {
      let recordCount = 0
      records.forEach((bucket) => {
        recordCount += bucket.size
      })
      let activeUnlocks = 0
      const now = nowTs || Date.now()
      unlocks.forEach((expireAt) => {
        if (expireAt > now) activeUnlocks += 1
      })
      return {
        records: recordCount,
        users: records.size,
        activeUnlocks
      }
    },

    async close() {}
  }
}

function createPostgresDb(connectionString) {
  const pool = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    keepAlive: true
  })

  pool.on('error', (err) => {
    console.error('[db] idle client error:', err.message)
  })

  return {
    mode: 'postgres',
    pool,

    async init() {
      await pool.query(SCHEMA)
    },

    async health() {
      try {
        await pool.query('SELECT 1')
        return 'ok'
      } catch (e) {
        return 'down'
      }
    },

    async saveUnlock(openid, expireAt) {
      await pool.query(
        'INSERT INTO audio_unlocks (openid, expire_time) VALUES ($1, to_timestamp($2::bigint / 1000.0))',
        [openid, expireAt]
      )
    },

    async getUnlock(openid) {
      const result = await pool.query(
        'SELECT expire_time FROM audio_unlocks WHERE openid = $1 ORDER BY expire_time DESC LIMIT 1',
        [openid]
      )
      if (!result.rows.length) return 0
      return new Date(result.rows[0].expire_time).getTime()
    },

    async cleanupExpired() {
      const result = await pool.query(
        "DELETE FROM audio_unlocks WHERE expire_time < now() - interval '7 days'"
      )
      return result.rowCount
    },

    async upsertRecords(openid, list) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        for (let i = 0; i < list.length; i += 1) {
          const record = list[i]
          await client.query(
            `INSERT INTO sleep_records (openid, day, bed_at, wake_at, duration_min, updated_at)
             VALUES ($1, $2, $3, $4, $5, to_timestamp($6::bigint / 1000.0))
             ON CONFLICT (openid, day) DO UPDATE SET
               bed_at = EXCLUDED.bed_at,
               wake_at = EXCLUDED.wake_at,
               duration_min = EXCLUDED.duration_min,
               updated_at = GREATEST(sleep_records.updated_at, EXCLUDED.updated_at)
             WHERE EXCLUDED.updated_at >= sleep_records.updated_at`,
            [openid, record.day, record.bedAt, record.wakeAt, record.durationMin, record.updatedAt]
          )
        }
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
      return list.length
    },

    async getRecords(openid) {
      const result = await pool.query(
        `SELECT to_char(day, 'YYYY-MM-DD') AS day, bed_at, wake_at, duration_min, updated_at
         FROM sleep_records WHERE openid = $1 ORDER BY day`,
        [openid]
      )
      return result.rows.map((row) => ({
        day: row.day,
        bedAt: Number(row.bed_at),
        wakeAt: Number(row.wake_at),
        durationMin: row.duration_min,
        updatedAt: new Date(row.updated_at).getTime()
      }))
    },

    async deleteRecords(openid) {
      const result = await pool.query('DELETE FROM sleep_records WHERE openid = $1', [openid])
      return result.rowCount
    },

    async getAppConfig() {
      const result = await pool.query("SELECT value, updated_at FROM app_config WHERE key = 'app'")
      if (!result.rows.length) return null
      return {
        value: result.rows[0].value,
        updatedAt: new Date(result.rows[0].updated_at).getTime()
      }
    },

    async saveAppConfig(value) {
      const result = await pool.query(
        `INSERT INTO app_config (key, value) VALUES ('app', $1::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
         RETURNING updated_at`,
        [JSON.stringify(value)]
      )
      return new Date(result.rows[0].updated_at).getTime()
    },

    async getSetting(key) {
      const result = await pool.query('SELECT value, updated_at FROM app_config WHERE key = $1', [key])
      if (!result.rows.length) return null
      return {
        value: result.rows[0].value,
        updatedAt: new Date(result.rows[0].updated_at).getTime()
      }
    },

    async saveSetting(key, value) {
      const result = await pool.query(
        `INSERT INTO app_config (key, value) VALUES ($1, $2::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
         RETURNING updated_at`,
        [key, JSON.stringify(value)]
      )
      return new Date(result.rows[0].updated_at).getTime()
    },

    async insertEvents(openid, list) {
      if (!list.length) return 0
      const placeholders = []
      const values = []
      list.forEach((item, index) => {
        const offset = index * 4
        placeholders.push(
          `($${offset + 1}, $${offset + 2}, $${offset + 3}, to_timestamp($${offset + 4}::bigint / 1000.0))`
        )
        values.push(openid, item.type, item.target || '', item.ts)
      })
      await pool.query(
        `INSERT INTO events (openid, type, target, created_at) VALUES ${placeholders.join(', ')}`,
        values
      )
      return list.length
    },

    async listEvents(sinceTs) {
      const result = await pool.query(
        `SELECT openid, type, target, (EXTRACT(EPOCH FROM created_at) * 1000)::bigint AS ts
         FROM events WHERE created_at >= to_timestamp($1::bigint / 1000.0)
         ORDER BY created_at DESC LIMIT 20000`,
        [sinceTs]
      )
      return result.rows.map((row) => ({
        openid: row.openid,
        type: row.type,
        target: row.target,
        ts: Number(row.ts)
      }))
    },

    async cleanupEvents(beforeTs) {
      const result = await pool.query(
        'DELETE FROM events WHERE created_at < to_timestamp($1::bigint / 1000.0)',
        [beforeTs]
      )
      return result.rowCount
    },

    async adminStats(nowTs) {
      const current = nowTs || Date.now()
      const result = await pool.query(
        `SELECT
          (SELECT count(*) FROM sleep_records) AS records,
          (SELECT count(DISTINCT openid) FROM sleep_records) AS users,
          (SELECT count(*) FROM audio_unlocks WHERE expire_time > to_timestamp($1::bigint / 1000.0)) AS active_unlocks`,
        [current]
      )
      const row = result.rows[0]
      return {
        records: Number(row.records),
        users: Number(row.users),
        activeUnlocks: Number(row.active_unlocks)
      }
    },

    async close() {
      await pool.end()
    }
  }
}

async function createDb(options) {
  if (options.mode === 'postgres') {
    if (!options.url) throw new Error('DB_MODE=postgres 但缺少 DATABASE_URL')
    const db = createPostgresDb(options.url)

    // 容器首次初始化时 PostgreSQL 会先起一个临时实例再重启，
    // 这里重试几次，避免 API 恰好连到临时实例后被断开。
    const maxAttempts = 5
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await db.init()
        return db
      } catch (error) {
        if (attempt === maxAttempts) {
          await db.close().catch(() => {})
          throw error
        }
        console.warn('[db] init failed, retrying (' + attempt + '/' + maxAttempts + '):', error.message)
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }
    }
  }
  return createMemoryDb()
}

module.exports = { createDb, createMemoryDb, createPostgresDb }
