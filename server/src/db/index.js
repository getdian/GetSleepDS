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

-- 单日删除墓碑：撤销打卡后阻止其他设备把旧记录传回
CREATE TABLE IF NOT EXISTS sleep_record_deletions (
    openid       VARCHAR(64) NOT NULL,
    day          DATE NOT NULL,
    deleted_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (openid, day)
);
CREATE INDEX IF NOT EXISTS idx_sleep_record_deletions_openid
    ON sleep_record_deletions (openid, deleted_at DESC);

-- 全量清除水位：清除/后台删除后，早于 erased_at 的记录不能再写回
CREATE TABLE IF NOT EXISTS user_erasures (
    openid       VARCHAR(64) PRIMARY KEY,
    erased_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
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
CREATE INDEX IF NOT EXISTS idx_events_openid ON events (openid);

-- 后台敏感操作审计：只存 openid 哈希前缀，不落明文；容器日志轮转后仍可追溯。
CREATE TABLE IF NOT EXISTS admin_audit (
    id           BIGSERIAL PRIMARY KEY,
    action       VARCHAR(40) NOT NULL,
    openid_tag   VARCHAR(32) NOT NULL,
    details      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON admin_audit (created_at DESC);
`

function createMemoryDb() {
  const unlocks = new Map()
  const records = new Map()
  const deletions = new Map()
  const erasures = new Map()
  const settings = new Map()
  const events = []
  const audits = []
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

    async getErasure(openid) {
      return erasures.get(openid) || 0
    },

    async getRecordDeletions(openid) {
      const list = deletions.get(openid)
      if (!list) return []
      return Array.from(list, ([day, deletedAt]) => ({ day, deletedAt }))
    },

    /**
     * 同步的核心：应用删除墓碑、erasure 水位，再按 LWW upsert。
     * 返回 accepted/dropped 以及当前云端全量，供客户端回填。
     */
    async syncRecords(openid, list, deleteList, nowTs) {
      const erasedAt = erasures.get(openid) || 0
      let bucket = records.get(openid)
      if (!bucket) {
        bucket = new Map()
        records.set(openid, bucket)
      }

      let delMap = deletions.get(openid)
      if (!delMap) {
        delMap = new Map()
        deletions.set(openid, delMap)
      }
      ;(deleteList || []).forEach((item) => {
        const previous = delMap.get(item.day) || 0
        if (item.deletedAt > previous) delMap.set(item.day, item.deletedAt)
      })

      let accepted = 0
      let dropped = 0

      list.forEach((record) => {
        if (record.updatedAt <= erasedAt) {
          dropped += 1
          return
        }
        const deletedAt = delMap.get(record.day) || 0
        if (record.updatedAt <= deletedAt) {
          dropped += 1
          return
        }
        const previous = bucket.get(record.day)
        if (!previous || record.updatedAt >= previous.updatedAt) {
          bucket.set(record.day, record)
          accepted += 1
        } else {
          dropped += 1
        }
      })

      // 删除墓碑比分发记录新时，物理删除旧记录
      delMap.forEach((deletedAt, day) => {
        const current = bucket.get(day)
        if (current && current.updatedAt <= deletedAt) bucket.delete(day)
      })

      const all = Array.from(bucket.values()).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
      const allDeletions = Array.from(delMap, ([day, deletedAt]) => ({ day, deletedAt }))
      return { accepted, dropped, records: all, deletedDays: allDeletions, erasedAt }
    },

    async eraseUserData(openid, nowTs) {
      const erasedAt = nowTs || Date.now()
      const bucket = records.get(openid)
      const recordCount = bucket ? bucket.size : 0
      records.delete(openid)
      deletions.delete(openid)
      const unlockCount = unlocks.delete(openid) ? 1 : 0
      let eventCount = 0
      for (let i = events.length - 1; i >= 0; i -= 1) {
        if (events[i].openid === openid) {
          events.splice(i, 1)
          eventCount += 1
        }
      }
      erasures.set(openid, erasedAt)
      return { records: recordCount, unlocks: unlockCount, events: eventCount, erasedAt }
    },

    /**
     * 只删除云端副本，不写 erasure 水位。
     * 用于“关闭云备份后删除云端历史，但保留本机记录”：
     * 本机数据不会在下次同步时被水位清掉，重新开启备份后仍可再次上传。
     */
    async eraseCloudData(openid) {
      const bucket = records.get(openid)
      const recordCount = bucket ? bucket.size : 0
      records.delete(openid)
      deletions.delete(openid)
      const unlockCount = unlocks.delete(openid) ? 1 : 0
      let eventCount = 0
      for (let i = events.length - 1; i >= 0; i -= 1) {
        if (events[i].openid === openid) {
          events.splice(i, 1)
          eventCount += 1
        }
      }
      return { records: recordCount, unlocks: unlockCount, events: eventCount, erasedAt: 0 }
    },

    // 兼容旧调用：全量删除等同于 erasure
    async deleteUserData(openid) {
      return this.eraseUserData(openid)
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
      const erasedAt = erasures.get(openid) || 0
      const accepted = list.filter((item) => (item.ts || now) > erasedAt)
      accepted.forEach((item) => {
        events.push({
          openid,
          type: item.type,
          target: item.target || '',
          ts: item.ts || now
        })
      })
      if (events.length > 50000) events.splice(0, events.length - 50000)
      return accepted.length
    },

    async countEvents(openid) {
      return events.filter((event) => event.openid === openid).length
    },

    async logAdminAction(action, openidTag, details) {
      audits.push({
        action,
        openidTag,
        details: details || {},
        createdAt: Date.now()
      })
      if (audits.length > 5000) audits.splice(0, audits.length - 5000)
      return true
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
      // 同一 openid 只保留最新一次解锁：TTL 调小后，旧的长有效期行不能继续赢
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query('DELETE FROM audio_unlocks WHERE openid = $1', [openid])
        await client.query(
          'INSERT INTO audio_unlocks (openid, expire_time) VALUES ($1, to_timestamp($2::bigint / 1000.0))',
          [openid, expireAt]
        )
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
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

    async getErasure(openid) {
      const result = await pool.query('SELECT erased_at FROM user_erasures WHERE openid = $1', [openid])
      if (!result.rows.length) return 0
      return new Date(result.rows[0].erased_at).getTime()
    },

    async getRecordDeletions(openid) {
      const result = await pool.query(
        `SELECT to_char(day, 'YYYY-MM-DD') AS day,
                (EXTRACT(EPOCH FROM deleted_at) * 1000)::bigint AS deleted_at
         FROM sleep_record_deletions WHERE openid = $1 ORDER BY day`,
        [openid]
      )
      return result.rows.map((row) => ({ day: row.day, deletedAt: Number(row.deleted_at) }))
    },

    /**
     * 同一事务里应用 erasure / 单日墓碑 / LWW upsert，避免清除与在途同步互相覆盖。
     * advisory lock 以 openid 为粒度，单实例之外也能串行化同一用户。
     */
    async syncRecords(openid, list, deleteList, nowTs) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [openid])

        const erasureResult = await client.query(
          'SELECT erased_at FROM user_erasures WHERE openid = $1',
          [openid]
        )
        const erasedAt = erasureResult.rows.length
          ? new Date(erasureResult.rows[0].erased_at).getTime()
          : 0

        for (let i = 0; i < (deleteList || []).length; i += 1) {
          const item = deleteList[i]
          await client.query(
            `INSERT INTO sleep_record_deletions (openid, day, deleted_at)
             VALUES ($1, $2, to_timestamp($3::bigint / 1000.0))
             ON CONFLICT (openid, day) DO UPDATE SET
               deleted_at = GREATEST(sleep_record_deletions.deleted_at, EXCLUDED.deleted_at)`,
            [openid, item.day, item.deletedAt]
          )
        }

        let accepted = 0
        let dropped = 0

        for (let i = 0; i < list.length; i += 1) {
          const record = list[i]
          if (erasedAt && record.updatedAt <= erasedAt) {
            dropped += 1
            continue
          }

          const deletion = await client.query(
            `SELECT (EXTRACT(EPOCH FROM deleted_at) * 1000)::bigint AS deleted_at
             FROM sleep_record_deletions WHERE openid = $1 AND day = $2`,
            [openid, record.day]
          )
          const deletedAt = deletion.rows.length ? Number(deletion.rows[0].deleted_at) : 0
          if (deletedAt && record.updatedAt <= deletedAt) {
            dropped += 1
            continue
          }

          const saved = await client.query(
            `INSERT INTO sleep_records (openid, day, bed_at, wake_at, duration_min, updated_at)
             VALUES ($1, $2, $3, $4, $5, to_timestamp($6::bigint / 1000.0))
             ON CONFLICT (openid, day) DO UPDATE SET
               bed_at = EXCLUDED.bed_at,
               wake_at = EXCLUDED.wake_at,
               duration_min = EXCLUDED.duration_min,
               updated_at = GREATEST(sleep_records.updated_at, EXCLUDED.updated_at)
             WHERE EXCLUDED.updated_at >= sleep_records.updated_at
             RETURNING day`,
            [openid, record.day, record.bedAt, record.wakeAt, record.durationMin, record.updatedAt]
          )
          if (saved.rowCount) accepted += 1
          else dropped += 1
        }

        // 删除墓碑比记录新时，物理删除；记录更新（用户重新记录）时保留
        for (let i = 0; i < (deleteList || []).length; i += 1) {
          const item = deleteList[i]
          await client.query(
            `DELETE FROM sleep_records
             WHERE openid = $1 AND day = $2
               AND updated_at <= to_timestamp($3::bigint / 1000.0)`,
            [openid, item.day, item.deletedAt]
          )
        }

        const stored = await client.query(
          `SELECT to_char(day, 'YYYY-MM-DD') AS day, bed_at, wake_at, duration_min, updated_at
           FROM sleep_records WHERE openid = $1 ORDER BY day`,
          [openid]
        )
        const deletionRows = await client.query(
          `SELECT to_char(day, 'YYYY-MM-DD') AS day,
                  (EXTRACT(EPOCH FROM deleted_at) * 1000)::bigint AS deleted_at
           FROM sleep_record_deletions WHERE openid = $1 ORDER BY day`,
          [openid]
        )

        await client.query('COMMIT')
        return {
          accepted,
          dropped,
          erasedAt,
          records: stored.rows.map((row) => ({
            day: row.day,
            bedAt: Number(row.bed_at),
            wakeAt: Number(row.wake_at),
            durationMin: row.duration_min,
            updatedAt: new Date(row.updated_at).getTime()
          })),
          deletedDays: deletionRows.rows.map((row) => ({
            day: row.day,
            deletedAt: Number(row.deleted_at)
          }))
        }
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    },

    async eraseUserData(openid, nowTs) {
      const erasedAt = nowTs || Date.now()
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [openid])
        await client.query(
          `INSERT INTO user_erasures (openid, erased_at)
           VALUES ($1, to_timestamp($2::bigint / 1000.0))
           ON CONFLICT (openid) DO UPDATE SET erased_at = EXCLUDED.erased_at`,
          [openid, erasedAt]
        )
        const records = await client.query('DELETE FROM sleep_records WHERE openid = $1', [openid])
        const unlocks = await client.query('DELETE FROM audio_unlocks WHERE openid = $1', [openid])
        const events = await client.query('DELETE FROM events WHERE openid = $1', [openid])
        await client.query('DELETE FROM sleep_record_deletions WHERE openid = $1', [openid])
        await client.query('COMMIT')
        return {
          records: records.rowCount,
          unlocks: unlocks.rowCount,
          events: events.rowCount,
          erasedAt
        }
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    },

    /** 只删除云端副本，不写 user_erasures（本机记录保留） */
    async eraseCloudData(openid) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [openid])
        const records = await client.query('DELETE FROM sleep_records WHERE openid = $1', [openid])
        const unlocks = await client.query('DELETE FROM audio_unlocks WHERE openid = $1', [openid])
        const events = await client.query('DELETE FROM events WHERE openid = $1', [openid])
        await client.query('DELETE FROM sleep_record_deletions WHERE openid = $1', [openid])
        await client.query('COMMIT')
        return {
          records: records.rowCount,
          unlocks: unlocks.rowCount,
          events: events.rowCount,
          erasedAt: 0
        }
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    },

    async deleteUserData(openid) {
      return this.eraseUserData(openid)
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
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [openid])
        const erasure = await client.query('SELECT erased_at FROM user_erasures WHERE openid = $1', [openid])
        const erasedAt = erasure.rows.length ? new Date(erasure.rows[0].erased_at).getTime() : 0
        const accepted = list.filter((item) => (item.ts || Date.now()) > erasedAt)
        if (accepted.length) {
          const placeholders = []
          const values = []
          accepted.forEach((item, index) => {
            const offset = index * 4
            placeholders.push(
              `($${offset + 1}, $${offset + 2}, $${offset + 3}, to_timestamp($${offset + 4}::bigint / 1000.0))`
            )
            values.push(openid, item.type, item.target || '', item.ts)
          })
          await client.query(
            `INSERT INTO events (openid, type, target, created_at) VALUES ${placeholders.join(', ')}`,
            values
          )
        }
        await client.query('COMMIT')
        return accepted.length
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    },

    async countEvents(openid) {
      const result = await pool.query('SELECT count(*)::int AS n FROM events WHERE openid = $1', [openid])
      return Number(result.rows[0].n) || 0
    },

    async logAdminAction(action, openidTag, details) {
      await pool.query(
        'INSERT INTO admin_audit (action, openid_tag, details) VALUES ($1, $2, $3::jsonb)',
        [action, openidTag, JSON.stringify(details || {})]
      )
      return true
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
          (SELECT count(DISTINCT openid) FROM audio_unlocks WHERE expire_time > to_timestamp($1::bigint / 1000.0)) AS active_unlocks`,
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
  const mode = options && options.mode
  if (mode === 'memory') return createMemoryDb()
  if (mode !== 'postgres') {
    throw new Error('未知 DB_MODE：' + mode + '（只支持 memory / postgres）')
  }
  {
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
}

module.exports = { createDb, createMemoryDb, createPostgresDb }
