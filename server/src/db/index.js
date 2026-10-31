const { Pool } = require('pg')
const { apiError } = require('../lib/errors')
const { MAX_UPDATED_FUTURE_MS } = require('../lib/validate')

const SCHEMA = `
CREATE TABLE IF NOT EXISTS audio_unlocks (
    id           SERIAL PRIMARY KEY,
    openid       VARCHAR(64) NOT NULL,
    unlock_time  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expire_time  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audio_unlocks_openid_expire
    ON audio_unlocks (openid, expire_time DESC);

-- 环境音收藏：只存「谁收藏了哪首」，前台展示值 = 后台人气基数 + 这里的真实计数。
-- 主键天然去重，同一用户重复收藏不会把数字刷上去。
CREATE TABLE IF NOT EXISTS audio_favorites (
    openid      VARCHAR(64) NOT NULL,
    track_id    VARCHAR(64) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (openid, track_id)
);
CREATE INDEX IF NOT EXISTS idx_audio_favorites_track
    ON audio_favorites (track_id);

-- 背景图使用次数：前台展示「已被使用 N 次」= 后台人气基数 + 这里的累计次数。
-- 与收藏不同：同一用户换用同一张背景多次是真实使用行为，因此不做唯一约束。
-- 累计口径：不做时间清理（清了数字会倒退），量级随真实使用低频增长。
CREATE TABLE IF NOT EXISTS background_uses (
    id          BIGSERIAL PRIMARY KEY,
    openid      VARCHAR(64) NOT NULL,
    bg_id       VARCHAR(64) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_background_uses_bg
    ON background_uses (bg_id);
-- 清除数据按 openid 删除：没有这个索引就是全表扫描
CREATE INDEX IF NOT EXISTS idx_background_uses_openid
    ON background_uses (openid);

CREATE TABLE IF NOT EXISTS sleep_records (
    openid       VARCHAR(64) NOT NULL,
    day          DATE NOT NULL,
    bed_at       BIGINT NOT NULL,
    wake_at      BIGINT NOT NULL,
    duration_min INTEGER NOT NULL,
    day_rule     TEXT NOT NULL DEFAULT 'bed-v1',
    schema_version INTEGER NOT NULL DEFAULT 1,
    sessions     JSONB NOT NULL DEFAULT '[]'::jsonb,
    night_duration_min INTEGER,
    total_duration_min INTEGER,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (openid, day)
);
ALTER TABLE sleep_records ADD COLUMN IF NOT EXISTS day_rule TEXT NOT NULL DEFAULT 'bed-v1';
ALTER TABLE sleep_records ADD COLUMN IF NOT EXISTS schema_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sleep_records ADD COLUMN IF NOT EXISTS sessions JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE sleep_records ADD COLUMN IF NOT EXISTS night_duration_min INTEGER;
ALTER TABLE sleep_records ADD COLUMN IF NOT EXISTS total_duration_min INTEGER;

CREATE TABLE IF NOT EXISTS app_config (
    key          TEXT PRIMARY KEY,
    value        JSONB NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- 单调递增的发布版本：后台保存用它做原子 CAS（并发保存只允许一个成功），
    -- updated_at 只用于展示，不能当并发依据（同一毫秒可能相同）。
    revision     BIGINT NOT NULL DEFAULT 1
);
ALTER TABLE app_config ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;

-- 单日删除墓碑：撤销打卡后阻止其他设备把旧记录传回
CREATE TABLE IF NOT EXISTS sleep_record_deletions (
    openid       VARCHAR(64) NOT NULL,
    day          DATE NOT NULL,
    deleted_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (openid, day)
);
CREATE INDEX IF NOT EXISTS idx_sleep_record_deletions_openid
    ON sleep_record_deletions (openid, deleted_at DESC);

-- 一次性的结束入睡提醒；只存发送所需的最小字段
CREATE TABLE IF NOT EXISTS sleep_reminders (
    openid       VARCHAR(64) NOT NULL,
    session_id   VARCHAR(64) NOT NULL,
    fire_at      BIGINT NOT NULL,
    template_id  TEXT NOT NULL,
    page         TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at      TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    -- 模板字段名快照：运营换模板/改字段后，已排队任务仍按创建时的字段发送，
    -- 否则“旧模板 + 新字段”会被微信以 47003 拒绝，提醒永久发不出去。
    thing_key    TEXT NOT NULL DEFAULT '',
    time_key     TEXT NOT NULL DEFAULT '',
    -- 瞬时失败重试预算：attempts 是已失败次数，retry_at 是下一次允许发送的时刻（毫秒）。
    -- 没有这两列时，微信/网络一次抖动就会把提醒永久标成 failed，用户收不到。
    attempts     INTEGER NOT NULL DEFAULT 0,
    retry_at     BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (openid, session_id)
);

ALTER TABLE sleep_reminders ADD COLUMN IF NOT EXISTS thing_key TEXT NOT NULL DEFAULT '';
ALTER TABLE sleep_reminders ADD COLUMN IF NOT EXISTS time_key TEXT NOT NULL DEFAULT '';
ALTER TABLE sleep_reminders ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sleep_reminders ADD COLUMN IF NOT EXISTS retry_at BIGINT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_sleep_reminders_due
    ON sleep_reminders (status, fire_at);

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
    -- 客户端自带事件 id：网络重试（服务端已提交但响应丢失）时按 (openid, event_id) 去重，
    -- 否则播放/打卡/分享等计数会被重复放大。旧客户端没有 id 时留空。
    event_id    VARCHAR(64),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE events ADD COLUMN IF NOT EXISTS event_id VARCHAR(64);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events (created_at);
CREATE INDEX IF NOT EXISTS idx_events_type_created ON events (type, created_at);
CREATE INDEX IF NOT EXISTS idx_events_openid ON events (openid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_openid_event_id
    ON events (openid, event_id) WHERE event_id IS NOT NULL;

-- 用户反馈：只存用户主动提交的内容。type 三类（SUGGEST/MUSIC/ISSUE），
-- contact 为可选联系方式（用户自愿填写）；后台标记已处理后 handled_at 非空。
CREATE TABLE IF NOT EXISTS user_feedback (
    id          BIGSERIAL PRIMARY KEY,
    openid      VARCHAR(64) NOT NULL,
    type        VARCHAR(16) NOT NULL,
    content     VARCHAR(600) NOT NULL,
    contact     VARCHAR(64) NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    handled_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_user_feedback_created ON user_feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_feedback_openid ON user_feedback (openid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_feedback_open ON user_feedback (handled_at) WHERE handled_at IS NULL;

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

function subjectRequestAt(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now()
}

/**
 * 全量清除与所有用户写入共用的代际判定。
 * 删除前已经开始的请求即使晚到，也不能凭客户端时间戳把数据写回；
 * 删除完成后发生的新主动操作不受限制。
 */
function assertSubjectWriteAllowed(erasedAt, requestStartedAt) {
  // 严格小于：与清除同一毫秒开始的请求视为“清除之后的新动作”，
  // 否则同一毫秒内完成的正常操作会被误判成在途请求。
  if (erasedAt && subjectRequestAt(requestStartedAt) < erasedAt) {
    throw apiError('DATA_ERASED', '数据已清除，请刷新后重试', 409)
  }
}

/** PG 用户写入的统一深模块：连接、事务、subject 锁和 erasure 判定只在这里出现一次。 */
async function withSubjectWrite(pool, openid, requestStartedAt, work) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [openid])
    const result = await client.query('SELECT erased_at FROM user_erasures WHERE openid = $1', [openid])
    const erasedAt = result.rows.length ? new Date(result.rows[0].erased_at).getTime() : 0
    assertSubjectWriteAllowed(erasedAt, requestStartedAt)
    const value = await work(client, erasedAt)
    await client.query('COMMIT')
    return value
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

function createMemoryDb() {
  const unlocks = new Map()
  const records = new Map()
  const deletions = new Map()
  const erasures = new Map()
  const settings = new Map()
  const events = []
  // 客户端事件 id 去重键（openid|eventId）：网络重试不重复计数
  const eventIds = new Set()
  const audits = []
  const reminders = new Map()
  const feedback = []
  // 环境音收藏：openid -> Set(trackId)
  const audioFavs = new Map()
  // 背景使用记录（同一人可多次，用于累计「已被使用 N 次」）
  const bgUses = []
  let feedbackSeq = 0
  let appConfig = null

  /** 去重索引与事件数组保持一致：删除或清理后必须重建，否则 id 会永久占用。 */
  function syncEventIds() {
    eventIds.clear()
    events.forEach((event) => {
      if (event.id) eventIds.add(event.openid + '|' + event.id)
    })
  }

  return {
    mode: 'memory',

    async init() {
      return true
    },

    async health() {
      return 'ok'
    },

    async saveUnlock(openid, expireAt, requestStartedAt) {
      assertSubjectWriteAllowed(erasures.get(openid) || 0, requestStartedAt)
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
      // 与 PG 实现保持一致（ORDER BY day），否则后台/接口在两种模式下的顺序不同
      return bucket
        ? Array.from(bucket.values()).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
        : []
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

    async saveReminder(openid, reminder, requestStartedAt) {
      assertSubjectWriteAllowed(erasures.get(openid) || 0, requestStartedAt)
      let bucket = reminders.get(openid)
      if (!bucket) {
        bucket = new Map()
        reminders.set(openid, bucket)
      }
      const previous = bucket.get(reminder.sessionId)
      // 已发送的同 ID 任务保持幂等，不重复排队；
      // cancelled/failed/expired 是“用户主动重新创建”，必须能恢复为 pending，
      // 否则「设 A → 改 B → 再改回 A」会静默没有任何待发送任务。
      if (previous && previous.status === 'sent') return true
      // 用户主动重建（cancelled/failed/expired → pending）时重置重试预算
      const next = Object.assign({}, reminder, { openid, status: 'pending', attempts: 0, retryAt: 0 })
      delete next.cancelledAt
      bucket.set(reminder.sessionId, next)
      return true
    },

    async cancelReminder(openid, sessionId) {
      const bucket = reminders.get(openid)
      const item = bucket && bucket.get(sessionId)
      if (!item || item.status !== 'pending') return false
      item.status = 'cancelled'
      item.cancelledAt = Date.now()
      return true
    },

    async dueReminders(nowTs, limit) {
      const out = []
      reminders.forEach((bucket, openid) => {
        bucket.forEach((item) => {
          if (
            item.status === 'pending' &&
            item.fireAt <= nowTs &&
            (!item.retryAt || item.retryAt <= nowTs)
          ) {
            out.push(Object.assign({}, item, { openid }))
          }
        })
      })
      out.sort((a, b) => a.fireAt - b.fireAt)
      return out.slice(0, Math.max(1, Number(limit) || 50))
    },

    async markReminder(openid, sessionId, status, atTs) {
      const bucket = reminders.get(openid)
      const item = bucket && bucket.get(sessionId)
      if (!item) return false
      item.status = status
      if (status === 'sent') {
        item.sentAt = atTs || Date.now()
        item.attempts = 0
        item.retryAt = 0
      } else item.cancelledAt = atTs || Date.now()
      return true
    },

    /** 瞬时失败：保留 pending，累加 attempts 并推后下一次发送时刻（退避） */
    async scheduleReminderRetry(openid, sessionId, options) {
      const bucket = reminders.get(openid)
      const item = bucket && bucket.get(sessionId)
      if (!item || item.status !== 'pending') return false
      item.attempts = Number(options && options.attempts) || 1
      item.retryAt = Number(options && options.retryAt) || 0
      return true
    },

    async cleanupReminders(beforeTs) {
      let removed = 0
      reminders.forEach((bucket) => {
        Array.from(bucket.keys()).forEach((key) => {
          const item = bucket.get(key)
          if (item && item.status !== 'pending' && (item.sentAt || item.cancelledAt || 0) < beforeTs) {
            bucket.delete(key)
            removed += 1
          }
        })
      })
      return removed
    },

    /**
     * 同步的核心：应用删除墓碑、erasure 水位，再按 LWW upsert。
     * 返回 accepted/dropped 以及当前云端全量，供客户端回填。
     */
    async syncRecords(openid, list, deleteList, nowTs, requestStartedAt) {
      const erasedAt = erasures.get(openid) || 0
      // 清除前已在途的同步：不写入，并把清除水位带回客户端（客户端据此清本机）
      if (erasedAt && subjectRequestAt(requestStartedAt) < erasedAt) {
        return {
          accepted: 0,
          dropped: (list || []).length,
          records: [],
          deletedDays: [],
          erasedAt
        }
      }
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
        // 时间戳超出请求时刻太多：不是可信的新数据（旧设备时钟偏快），直接丢弃，
        // 否则删除后仍可用未来时间戳把旧记录写回。
        if (record.updatedAt > subjectRequestAt(requestStartedAt) + MAX_UPDATED_FUTURE_MS) {
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
      // 收藏与背景使用都带 openid，属用户偏好：全量清除与仅清云端都要一起清
      const favoriteCount = audioFavs.delete(openid) ? 1 : 0
      let backgroundUseCount = 0
      for (let i = bgUses.length - 1; i >= 0; i -= 1) {
        if (bgUses[i].openid === openid) {
          bgUses.splice(i, 1)
          backgroundUseCount += 1
        }
      }
      // 「删除全部数据」必须连订阅提醒一起清：否则清除后仍会在到点推送，
      // 且 openid/session_id 会继续留存在 sleep_reminders 里直到 7 天清理。
      const reminderBucket = reminders.get(openid)
      const reminderCount = reminderBucket ? reminderBucket.size : 0
      reminders.delete(openid)
      let eventCount = 0
      for (let i = events.length - 1; i >= 0; i -= 1) {
        if (events[i].openid === openid) {
          events.splice(i, 1)
          eventCount += 1
        }
      }
      // 反馈含 openid 与用户自愿填写的联系方式：清除数据必须一起清，
      // 否则「已清除」之后后台仍留着可联系到本人的信息。
      let feedbackCount = 0
      for (let i = feedback.length - 1; i >= 0; i -= 1) {
        if (feedback[i].openid === openid) {
          feedback.splice(i, 1)
          feedbackCount += 1
        }
      }
      // 水位只前进不后退：乱序到达的旧删除请求不能降低已生效的清除边界
      erasures.set(openid, Math.max(erasures.get(openid) || 0, erasedAt))
      syncEventIds()
      return {
        records: recordCount,
        unlocks: unlockCount,
        events: eventCount,
        reminders: reminderCount,
        feedback: feedbackCount,
        favorites: favoriteCount,
        backgroundUses: backgroundUseCount,
        erasedAt
      }
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
      // 收藏与背景使用都带 openid，属用户偏好：全量清除与仅清云端都要一起清
      const favoriteCount = audioFavs.delete(openid) ? 1 : 0
      let backgroundUseCount = 0
      for (let i = bgUses.length - 1; i >= 0; i -= 1) {
        if (bgUses[i].openid === openid) {
          bgUses.splice(i, 1)
          backgroundUseCount += 1
        }
      }
      // 只删云端副本时，云端的订阅提醒也属于“云端数据”，必须一起清。
      const reminderBucket = reminders.get(openid)
      const reminderCount = reminderBucket ? reminderBucket.size : 0
      reminders.delete(openid)
      let eventCount = 0
      for (let i = events.length - 1; i >= 0; i -= 1) {
        if (events[i].openid === openid) {
          events.splice(i, 1)
          eventCount += 1
        }
      }
      // 反馈只存在云端（本机不落副本），因此“只删云端副本”也要删干净。
      let feedbackCount = 0
      for (let i = feedback.length - 1; i >= 0; i -= 1) {
        if (feedback[i].openid === openid) {
          feedback.splice(i, 1)
          feedbackCount += 1
        }
      }
      syncEventIds()
      return {
        records: recordCount,
        unlocks: unlockCount,
        events: eventCount,
        reminders: reminderCount,
        feedback: feedbackCount,
        favorites: favoriteCount,
        backgroundUses: backgroundUseCount,
        erasedAt: 0
      }
    },

    // 兼容旧调用：全量删除等同于 erasure
    async deleteUserData(openid) {
      return this.eraseUserData(openid)
    },

    async getAppConfig() {
      if (!appConfig) return null
      return {
        value: JSON.parse(JSON.stringify(appConfig.value)),
        updatedAt: appConfig.updatedAt,
        revision: appConfig.revision
      }
    },

    /**
     * 配置发布：expectedRevision 不为空时做原子 CAS，
     * 版本不匹配返回 null（调用方转 409），匹配则写入并把 revision +1。
     */
    async saveAppConfig(value, options) {
      const expected =
        options && options.expectedRevision !== undefined && options.expectedRevision !== null
          ? Number(options.expectedRevision)
          : null
      if (expected !== null) {
        const current = appConfig ? Number(appConfig.revision) : 0
        if (current !== expected) return null
      }
      const updatedAt = Date.now()
      const revision = appConfig ? Number(appConfig.revision) + 1 : 1
      appConfig = { value: JSON.parse(JSON.stringify(value)), updatedAt, revision }
      return { updatedAt, revision }
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

    async insertEvents(openid, list, requestStartedAt) {
      const now = Date.now()
      const erasedAt = erasures.get(openid) || 0
      assertSubjectWriteAllowed(erasedAt, requestStartedAt)
      const accepted = list.filter((item) => (item.ts || now) > erasedAt)
      let inserted = 0
      accepted.forEach((item) => {
        const id = item.id || ''
        // 客户端自带 id：同一事件因网络重试重复提交时只计一次
        if (id) {
          const key = openid + '|' + id
          if (eventIds.has(key)) return
          eventIds.add(key)
        }
        events.push({
          openid,
          id,
          type: item.type,
          target: item.target || '',
          ts: item.ts || now
        })
        inserted += 1
      })
      if (events.length > 50000) events.splice(0, events.length - 50000)
      return inserted
    },

    /** 收藏/取消收藏，返回该曲目的真实收藏人数（不含后台人气基数） */
    async setAudioFavorite(openid, trackId, on, requestStartedAt) {
      if (on) assertSubjectWriteAllowed(erasures.get(openid) || 0, requestStartedAt)
      let bucket = audioFavs.get(openid)
      if (!bucket) {
        bucket = new Set()
        audioFavs.set(openid, bucket)
      }
      if (on) bucket.add(trackId)
      else bucket.delete(trackId)
      // 取消最后一首后清掉空桶，避免 Map 随用户数无限增长
      if (!bucket.size) audioFavs.delete(openid)
      let count = 0
      audioFavs.forEach((set) => {
        if (set.has(trackId)) count += 1
      })
      return count
    },

    async countAudioFavorites(trackIds) {
      const counts = {}
      ;(Array.isArray(trackIds) ? trackIds : []).forEach((id) => {
        if (id) counts[id] = 0
      })
      audioFavs.forEach((set) => {
        set.forEach((id) => {
          if (counts[id] !== undefined) counts[id] += 1
        })
      })
      return counts
    },

    /** 记录一次背景使用，返回该背景的真实累计次数（不含后台基数） */
    async addBackgroundUse(openid, bgId, requestStartedAt) {
      assertSubjectWriteAllowed(erasures.get(openid) || 0, requestStartedAt)
      // 内存库重启即清零，不做条数截断：截断会让「累计」计数倒退，与 PG 语义不一致
      bgUses.push({ openid, bgId, ts: Date.now() })
      let count = 0
      bgUses.forEach((item) => {
        if (item.bgId === bgId) count += 1
      })
      return count
    },

    async countBackgroundUses(ids) {
      const counts = {}
      ;(Array.isArray(ids) ? ids : []).forEach((id) => {
        if (id) counts[id] = 0
      })
      bgUses.forEach((item) => {
        if (counts[item.bgId] !== undefined) counts[item.bgId] += 1
      })
      return counts
    },

    async countEvents(openid) {
      return events.filter((event) => event.openid === openid).length
    },

    async insertFeedback(openid, item, requestStartedAt) {
      assertSubjectWriteAllowed(erasures.get(openid) || 0, requestStartedAt)
      const createdAt = item.createdAt || Date.now()
      feedbackSeq += 1
      feedback.push({
        id: feedbackSeq,
        openid,
        type: item.type,
        content: item.content,
        contact: item.contact || '',
        createdAt,
        handledAt: 0
      })
      if (feedback.length > 5000) feedback.splice(0, feedback.length - 5000)
      return { id: feedbackSeq, createdAt }
    },

    /** onlyOpen=true 时只返回未处理；unhandled 恒为全量未处理数（侧边栏/筛选角标用） */
    async listFeedback(limit, onlyOpen) {
      const count = Math.min(Math.max(Number(limit) || 50, 1), 200)
      const unhandled = feedback.filter((row) => !row.handledAt).length
      const items = feedback
        .filter((row) => (onlyOpen ? !row.handledAt : true))
        // 同一毫秒提交的多条反馈要按 id 倒序兜底：只比 createdAt 时 Array.sort 稳定，
        // 平手会保持插入顺序（最旧的排最前），「取最新一条」的调用方就会读到旧数据。
        .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id)
        .slice(0, count)
        .map((row) => Object.assign({}, row))
      return { items, unhandled }
    },

    async markFeedbackHandled(id, nowTs) {
      const row = feedback.find((item) => item.id === Number(id))
      if (!row) return { updated: false }
      if (!row.handledAt) row.handledAt = nowTs || Date.now()
      return { updated: true }
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

    async readAdminAudit(limit) {
      const count = Math.min(Math.max(Number(limit) || 50, 1), 200)
      return audits.slice(-count).reverse()
    },

    /**
     * 看板取事件：返回 { items, truncated, oldestAt }。
     * truncated 表示「取样上限被触达」，前端据此披露口径，
     * 避免把样本当成全量。
     */
    async listEvents(sinceTs) {
      const matched = events
        .filter((event) => event.ts >= sinceTs)
        .sort((a, b) => b.ts - a.ts)
      const items = matched.slice(0, 20000)
      return {
        items,
        truncated: matched.length > items.length,
        oldestAt: items.length ? items[items.length - 1].ts : 0
      }
    },

    /**
     * 清理过期删除墓碑。客户端只上传最近 400 天的删除，更老的墓碑不再有作用，
     * 但会被每次 sync 全量回传，长期使用后响应体单调增长。
     */
    async cleanupDeletions(beforeTs) {
      let removed = 0
      deletions.forEach((list) => {
        list.forEach((deletedAt, day) => {
          if (deletedAt < beforeTs) {
            list.delete(day)
            removed += 1
          }
        })
      })
      return removed
    },

    async cleanupEvents(beforeTs) {
      const kept = events.filter((event) => event.ts >= beforeTs)
      const removed = events.length - kept.length
      events.length = 0
      kept.forEach((event) => events.push(event))
      syncEventIds()
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

    async saveUnlock(openid, expireAt, requestStartedAt) {
      // 同一 openid 只保留最新一次解锁：TTL 调小后，旧的长有效期行不能继续赢；
      // 锁与 erasure 判定在 withSubjectWrite 内，删除前已开始的请求不能写回。
      return withSubjectWrite(pool, openid, requestStartedAt, async (client) => {
        await client.query('DELETE FROM audio_unlocks WHERE openid = $1', [openid])
        await client.query(
          'INSERT INTO audio_unlocks (openid, expire_time) VALUES ($1, to_timestamp($2::bigint / 1000.0))',
          [openid, expireAt]
        )
      })
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

    /** 清理过期删除墓碑（超出客户端 400 天同步窗口后已无作用），防止表与响应体单调增长 */
    async cleanupDeletions(beforeTs) {
      const result = await pool.query(
        'DELETE FROM sleep_record_deletions WHERE deleted_at < to_timestamp($1::bigint / 1000.0)',
        [beforeTs]
      )
      return result.rowCount
    },

    async saveReminder(openid, reminder, requestStartedAt) {
      // 与 memory 实现同口径：sent 幂等不重置，cancelled/failed/expired 允许用户主动重建。
      // 第二条 SELECT 让“已 sent”也返回成功，避免路由把幂等场景误判为写入失败。
      return withSubjectWrite(pool, openid, requestStartedAt, async (client) => {
        const result = await client.query(
          `WITH ins AS (
             INSERT INTO sleep_reminders (openid, session_id, fire_at, template_id, page, status, thing_key, time_key)
             VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
             ON CONFLICT (openid, session_id) DO UPDATE SET
               fire_at = EXCLUDED.fire_at,
               template_id = EXCLUDED.template_id,
               page = EXCLUDED.page,
               status = 'pending',
               cancelled_at = NULL,
               thing_key = EXCLUDED.thing_key,
               time_key = EXCLUDED.time_key,
               attempts = 0,
               retry_at = 0
             WHERE sleep_reminders.status <> 'sent'
             RETURNING session_id
           )
           SELECT session_id FROM ins
           UNION ALL
           SELECT session_id FROM sleep_reminders
            WHERE openid = $1 AND session_id = $2 AND status = 'sent'
           LIMIT 1`,
          [
            openid,
            reminder.sessionId,
            reminder.fireAt,
            reminder.templateId,
            reminder.page,
            reminder.thingKey || '',
            reminder.timeKey || ''
          ]
        )
        return result.rowCount > 0
      })
    },

    async cancelReminder(openid, sessionId) {
      const result = await pool.query(
        `UPDATE sleep_reminders SET status = 'cancelled', cancelled_at = now()
         WHERE openid = $1 AND session_id = $2 AND status = 'pending'`,
        [openid, sessionId]
      )
      return result.rowCount > 0
    },

    async dueReminders(nowTs, limit) {
      const result = await pool.query(
        `SELECT openid, session_id, fire_at, template_id, page, thing_key, time_key, attempts
         FROM sleep_reminders
         WHERE status = 'pending' AND fire_at <= $1
           AND (retry_at = 0 OR retry_at <= $1)
         ORDER BY fire_at
         LIMIT $2`,
        [nowTs, Math.max(1, Number(limit) || 50)]
      )
      return result.rows.map((row) => ({
        openid: row.openid,
        sessionId: row.session_id,
        fireAt: Number(row.fire_at),
        templateId: row.template_id,
        page: row.page,
        thingKey: row.thing_key || '',
        timeKey: row.time_key || '',
        attempts: Number(row.attempts) || 0
      }))
    },

    async markReminder(openid, sessionId, status, atTs) {
      const result = await pool.query(
        `UPDATE sleep_reminders
         SET status = $3,
             sent_at = CASE WHEN $3 = 'sent' THEN to_timestamp($4::bigint / 1000.0) ELSE sent_at END,
             cancelled_at = CASE WHEN $3 <> 'sent' THEN to_timestamp($4::bigint / 1000.0) ELSE cancelled_at END,
             attempts = CASE WHEN $3 = 'sent' THEN 0 ELSE attempts END,
             retry_at = CASE WHEN $3 = 'sent' THEN 0 ELSE retry_at END
         WHERE openid = $1 AND session_id = $2`,
        [openid, sessionId, status, atTs || Date.now()]
      )
      return result.rowCount > 0
    },

    /** 瞬时失败：保留 pending，累加 attempts 并推后下一次发送时刻（退避） */
    async scheduleReminderRetry(openid, sessionId, options) {
      const attempts = Number(options && options.attempts) || 1
      const retryAt = Number(options && options.retryAt) || 0
      const result = await pool.query(
        `UPDATE sleep_reminders
            SET attempts = $3, retry_at = $4
          WHERE openid = $1 AND session_id = $2 AND status = 'pending'`,
        [openid, sessionId, attempts, retryAt]
      )
      return result.rowCount > 0
    },

    async cleanupReminders(beforeTs) {
      const result = await pool.query(
        `DELETE FROM sleep_reminders
         WHERE status <> 'pending'
           AND COALESCE(sent_at, cancelled_at) < to_timestamp($1::bigint / 1000.0)`,
        [beforeTs]
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
            `INSERT INTO sleep_records
               (openid, day, bed_at, wake_at, duration_min, day_rule, schema_version,
                sessions, night_duration_min, total_duration_min, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, to_timestamp($11::bigint / 1000.0))
             ON CONFLICT (openid, day) DO UPDATE SET
               bed_at = EXCLUDED.bed_at,
               wake_at = EXCLUDED.wake_at,
               duration_min = EXCLUDED.duration_min,
               day_rule = EXCLUDED.day_rule,
               schema_version = EXCLUDED.schema_version,
               sessions = EXCLUDED.sessions,
               night_duration_min = EXCLUDED.night_duration_min,
               total_duration_min = EXCLUDED.total_duration_min,
               updated_at = GREATEST(sleep_records.updated_at, EXCLUDED.updated_at)
             WHERE EXCLUDED.updated_at >= sleep_records.updated_at`,
            [
              openid,
              record.day,
              record.bedAt,
              record.wakeAt,
              record.durationMin,
              record.dayRule || 'bed-v1',
              record.schemaVersion || 1,
              JSON.stringify(record.sessions || []),
              record.nightDurationMin || record.durationMin,
              record.totalDurationMin || record.durationMin,
              record.updatedAt
            ]
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
        `SELECT to_char(day, 'YYYY-MM-DD') AS day, bed_at, wake_at, duration_min,
                day_rule, schema_version, sessions, night_duration_min, total_duration_min, updated_at
         FROM sleep_records WHERE openid = $1 ORDER BY day`,
        [openid]
      )
      return result.rows.map((row) => ({
        day: row.day,
        dayRule: row.day_rule || 'bed-v1',
        schemaVersion: row.schema_version || 1,
        bedAt: Number(row.bed_at),
        wakeAt: Number(row.wake_at),
        durationMin: row.duration_min,
        nightDurationMin: row.night_duration_min || row.duration_min,
        totalDurationMin: row.total_duration_min || row.duration_min,
        sessions: Array.isArray(row.sessions) ? row.sessions : [],
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
    async syncRecords(openid, list, deleteList, nowTs, requestStartedAt) {
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
        // 清除前已在途的同步：不写入，并把清除水位带回客户端（客户端据此清本机）
        if (erasedAt && subjectRequestAt(requestStartedAt) < erasedAt) {
          await client.query('COMMIT')
          return {
            accepted: 0,
            dropped: (list || []).length,
            records: [],
            deletedDays: [],
            erasedAt
          }
        }

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
          // 未来时间戳超出统一偏差上限：旧设备时钟偏快时不能凭未来时间戳写回
          if (record.updatedAt > subjectRequestAt(requestStartedAt) + MAX_UPDATED_FUTURE_MS) {
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
            `INSERT INTO sleep_records
               (openid, day, bed_at, wake_at, duration_min, day_rule, schema_version,
                sessions, night_duration_min, total_duration_min, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, to_timestamp($11::bigint / 1000.0))
             ON CONFLICT (openid, day) DO UPDATE SET
               bed_at = EXCLUDED.bed_at,
               wake_at = EXCLUDED.wake_at,
               duration_min = EXCLUDED.duration_min,
               day_rule = EXCLUDED.day_rule,
               schema_version = EXCLUDED.schema_version,
               sessions = EXCLUDED.sessions,
               night_duration_min = EXCLUDED.night_duration_min,
               total_duration_min = EXCLUDED.total_duration_min,
               updated_at = GREATEST(sleep_records.updated_at, EXCLUDED.updated_at)
             WHERE EXCLUDED.updated_at >= sleep_records.updated_at
             RETURNING day`,
            [
              openid,
              record.day,
              record.bedAt,
              record.wakeAt,
              record.durationMin,
              record.dayRule || 'bed-v1',
              record.schemaVersion || 1,
              JSON.stringify(record.sessions || []),
              record.nightDurationMin || record.durationMin,
              record.totalDurationMin || record.durationMin,
              record.updatedAt
            ]
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
          `SELECT to_char(day, 'YYYY-MM-DD') AS day, bed_at, wake_at, duration_min,
                  day_rule, schema_version, sessions, night_duration_min, total_duration_min, updated_at
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
            dayRule: row.day_rule || 'bed-v1',
            schemaVersion: row.schema_version || 1,
            bedAt: Number(row.bed_at),
            wakeAt: Number(row.wake_at),
            durationMin: row.duration_min,
            nightDurationMin: row.night_duration_min || row.duration_min,
            totalDurationMin: row.total_duration_min || row.duration_min,
            sessions: Array.isArray(row.sessions) ? row.sessions : [],
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
           ON CONFLICT (openid) DO UPDATE SET
             erased_at = GREATEST(user_erasures.erased_at, EXCLUDED.erased_at)`,
          [openid, erasedAt]
        )
        const records = await client.query('DELETE FROM sleep_records WHERE openid = $1', [openid])
        const unlocks = await client.query('DELETE FROM audio_unlocks WHERE openid = $1', [openid])
        // 收藏与背景使用都带 openid，属用户偏好：全量清除与仅清云端都要一起清
        const favorites = await client.query('DELETE FROM audio_favorites WHERE openid = $1', [openid])
        const backgroundUses = await client.query('DELETE FROM background_uses WHERE openid = $1', [openid])
        const events = await client.query('DELETE FROM events WHERE openid = $1', [openid])
        // 订阅提醒含 openid/session_id 明文，且到点会真的推送：清除全部数据时必须一起删。
        const reminders = await client.query('DELETE FROM sleep_reminders WHERE openid = $1', [openid])
        // 反馈含 openid 与用户自愿填写的联系方式：清除数据必须一起清。
        const feedback = await client.query('DELETE FROM user_feedback WHERE openid = $1', [openid])
        await client.query('DELETE FROM sleep_record_deletions WHERE openid = $1', [openid])
        await client.query('COMMIT')
        return {
          records: records.rowCount,
          unlocks: unlocks.rowCount,
          events: events.rowCount,
          reminders: reminders.rowCount,
          feedback: feedback.rowCount,
          favorites: favorites.rowCount,
          backgroundUses: backgroundUses.rowCount,
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
        // 收藏与背景使用都带 openid，属用户偏好：全量清除与仅清云端都要一起清
        const favorites = await client.query('DELETE FROM audio_favorites WHERE openid = $1', [openid])
        const backgroundUses = await client.query('DELETE FROM background_uses WHERE openid = $1', [openid])
        const events = await client.query('DELETE FROM events WHERE openid = $1', [openid])
        // 只删云端副本时，云端待发送的订阅提醒也属于云端数据。
        const reminders = await client.query('DELETE FROM sleep_reminders WHERE openid = $1', [openid])
        // 反馈只存在云端，因此“只删云端副本”也要删干净。
        const feedback = await client.query('DELETE FROM user_feedback WHERE openid = $1', [openid])
        await client.query('DELETE FROM sleep_record_deletions WHERE openid = $1', [openid])
        await client.query('COMMIT')
        return {
          records: records.rowCount,
          unlocks: unlocks.rowCount,
          events: events.rowCount,
          reminders: reminders.rowCount,
          feedback: feedback.rowCount,
          favorites: favorites.rowCount,
          backgroundUses: backgroundUses.rowCount,
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
      const result = await pool.query(
        "SELECT value, updated_at, revision FROM app_config WHERE key = 'app'"
      )
      if (!result.rows.length) return null
      return {
        value: result.rows[0].value,
        updatedAt: new Date(result.rows[0].updated_at).getTime(),
        revision: Number(result.rows[0].revision) || 1
      }
    },

    /**
     * 配置发布：SELECT ... FOR UPDATE 把并发保存串行化，
     * 版本不匹配返回 null（调用方转 409 CONFIG_CONFLICT）。
     * 只靠「先读后写」会出现两个请求同时通过检查、后写者覆盖先写者的丢失更新。
     */
    async saveAppConfig(value, options) {
      const expected =
        options && options.expectedRevision !== undefined && options.expectedRevision !== null
          ? Number(options.expectedRevision)
          : null
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const current = await client.query(
          "SELECT revision FROM app_config WHERE key = 'app' FOR UPDATE"
        )
        const currentRevision = current.rows.length ? Number(current.rows[0].revision) : 0
        if (expected !== null && currentRevision !== expected) {
          await client.query('ROLLBACK')
          return null
        }
        const nextRevision = currentRevision + 1
        const saved = await client.query(
          `INSERT INTO app_config (key, value, updated_at, revision)
           VALUES ('app', $1::jsonb, now(), $2::bigint)
           ON CONFLICT (key) DO UPDATE SET
             value = EXCLUDED.value,
             updated_at = now(),
             revision = EXCLUDED.revision`,
          [JSON.stringify(value), nextRevision]
        )
        await client.query('COMMIT')
        return {
          updatedAt: new Date(saved.rows[0].updated_at).getTime(),
          revision: Number(saved.rows[0].revision) || nextRevision
        }
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
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

    async insertEvents(openid, list, requestStartedAt) {
      if (!list.length) return 0
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [openid])
        const erasure = await client.query('SELECT erased_at FROM user_erasures WHERE openid = $1', [openid])
        const erasedAt = erasure.rows.length ? new Date(erasure.rows[0].erased_at).getTime() : 0
        assertSubjectWriteAllowed(erasedAt, requestStartedAt)
        const accepted = list.filter((item) => (item.ts || Date.now()) > erasedAt)
        let inserted = 0
        if (accepted.length) {
          const placeholders = []
          const values = []
          accepted.forEach((item, index) => {
            const offset = index * 5
            placeholders.push(
              `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, to_timestamp($${offset + 5}::bigint / 1000.0))`
            )
            values.push(openid, item.id || null, item.type, item.target || '', item.ts)
          })
          // 客户端事件 id 唯一索引兜底：重试批次里已入库的事件被直接忽略，不重复计数
          const insertedRows = await client.query(
            `INSERT INTO events (openid, event_id, type, target, created_at) VALUES ${placeholders.join(', ')}
             ON CONFLICT DO NOTHING`,
            values
          )
          inserted = insertedRows.rowCount
        }
        await client.query('COMMIT')
        return inserted
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

    /** 收藏/取消收藏，返回该曲目的真实收藏人数（不含后台人气基数） */
    async setAudioFavorite(openid, trackId, on, requestStartedAt) {
      if (!on) {
        await pool.query('DELETE FROM audio_favorites WHERE openid = $1 AND track_id = $2', [openid, trackId])
      } else {
        await withSubjectWrite(pool, openid, requestStartedAt, async (client) => {
          await client.query(
            `INSERT INTO audio_favorites (openid, track_id) VALUES ($1, $2)
             ON CONFLICT (openid, track_id) DO NOTHING`,
            [openid, trackId]
          )
        })
      }
      const result = await pool.query(
        'SELECT count(*)::int AS n FROM audio_favorites WHERE track_id = $1',
        [trackId]
      )
      return Number(result.rows[0] && result.rows[0].n) || 0
    },

    async countAudioFavorites(trackIds) {
      const ids = (Array.isArray(trackIds) ? trackIds : []).filter(Boolean)
      const counts = {}
      ids.forEach((id) => {
        counts[id] = 0
      })
      if (!ids.length) return counts
      const result = await pool.query(
        `SELECT track_id, count(*)::int AS n FROM audio_favorites
         WHERE track_id = ANY($1::text[]) GROUP BY track_id`,
        [ids]
      )
      result.rows.forEach((row) => {
        counts[row.track_id] = Number(row.n) || 0
      })
      return counts
    },

    /** 记录一次背景使用，返回该背景的真实累计次数（不含后台基数） */
    async addBackgroundUse(openid, bgId, requestStartedAt) {
      await withSubjectWrite(pool, openid, requestStartedAt, async (client) => {
        await client.query('INSERT INTO background_uses (openid, bg_id) VALUES ($1, $2)', [openid, bgId])
      })
      const result = await pool.query(
        'SELECT count(*)::int AS n FROM background_uses WHERE bg_id = $1',
        [bgId]
      )
      return Number(result.rows[0] && result.rows[0].n) || 0
    },

    async countBackgroundUses(ids) {
      const list = (Array.isArray(ids) ? ids : []).filter(Boolean)
      const counts = {}
      list.forEach((id) => {
        counts[id] = 0
      })
      if (!list.length) return counts
      const result = await pool.query(
        `SELECT bg_id, count(*)::int AS n FROM background_uses
         WHERE bg_id = ANY($1::text[]) GROUP BY bg_id`,
        [list]
      )
      result.rows.forEach((row) => {
        counts[row.bg_id] = Number(row.n) || 0
      })
      return counts
    },

    async insertFeedback(openid, item, requestStartedAt) {
      const createdAt = item.createdAt || Date.now()
      return withSubjectWrite(pool, openid, requestStartedAt, async (client) => {
        const result = await client.query(
          `INSERT INTO user_feedback (openid, type, content, contact, created_at)
           VALUES ($1, $2, $3, $4, to_timestamp($5::bigint / 1000.0))
           RETURNING id, (EXTRACT(EPOCH FROM created_at) * 1000)::bigint AS ts`,
          [openid, item.type, item.content, item.contact || '', createdAt]
        )
        return { id: Number(result.rows[0].id), createdAt: Number(result.rows[0].ts) }
      })
    },

    async listFeedback(limit, onlyOpen) {
      const count = Math.min(Math.max(Number(limit) || 50, 1), 200)
      const where = onlyOpen ? 'WHERE handled_at IS NULL' : ''
      const [list, open] = await Promise.all([
        pool.query(
          `SELECT id, openid, type, content, contact,
                  (EXTRACT(EPOCH FROM created_at) * 1000)::bigint AS ts,
                  (EXTRACT(EPOCH FROM handled_at) * 1000)::bigint AS handled_ts
           FROM user_feedback ${where}
           ORDER BY created_at DESC, id DESC LIMIT $1`,
          [count]
        ),
        pool.query('SELECT count(*)::int AS n FROM user_feedback WHERE handled_at IS NULL')
      ])
      return {
        items: list.rows.map((row) => ({
          id: Number(row.id),
          openid: row.openid,
          type: row.type,
          content: row.content,
          contact: row.contact,
          createdAt: Number(row.ts),
          handledAt: row.handled_ts ? Number(row.handled_ts) : 0
        })),
        unhandled: Number(open.rows[0].n) || 0
      }
    },

    async markFeedbackHandled(id, nowTs) {
      const result = await pool.query(
        `UPDATE user_feedback
         SET handled_at = COALESCE(handled_at, to_timestamp($2::bigint / 1000.0))
         WHERE id = $1`,
        [Number(id), nowTs || Date.now()]
      )
      return { updated: result.rowCount > 0 }
    },

    async logAdminAction(action, openidTag, details) {
      await pool.query(
        'INSERT INTO admin_audit (action, openid_tag, details) VALUES ($1, $2, $3::jsonb)',
        [action, openidTag, JSON.stringify(details || {})]
      )
      return true
    },

    async readAdminAudit(limit) {
      const count = Math.min(Math.max(Number(limit) || 50, 1), 200)
      const result = await pool.query(
        `SELECT action, openid_tag AS "openidTag", details,
                (EXTRACT(EPOCH FROM created_at) * 1000)::bigint AS ts
         FROM admin_audit ORDER BY created_at DESC LIMIT $1`,
        [count]
      )
      return result.rows.map((row) => ({
        action: row.action,
        openidTag: row.openidTag,
        details: row.details || {},
        createdAt: Number(row.ts)
      }))
    },

    /**
     * 看板取事件：多取一条用于判断是否触达上限，
     * 返回 { items, truncated, oldestAt }，前端据此披露口径。
     */
    async listEvents(sinceTs) {
      const result = await pool.query(
        `SELECT openid, type, target, (EXTRACT(EPOCH FROM created_at) * 1000)::bigint AS ts
         FROM events WHERE created_at >= to_timestamp($1::bigint / 1000.0)
         ORDER BY created_at DESC LIMIT 20001`,
        [sinceTs]
      )
      const rows = result.rows.map((row) => ({
        openid: row.openid,
        type: row.type,
        target: row.target,
        ts: Number(row.ts)
      }))
      const items = rows.slice(0, 20000)
      return {
        items,
        truncated: rows.length > items.length,
        oldestAt: items.length ? items[items.length - 1].ts : 0
      }
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
