-- 睡点 · 初始化表结构（幂等，容器首次启动自动执行）
-- 说明：服务端启动时也会执行同一份 DDL，重复执行无副作用。

CREATE TABLE IF NOT EXISTS audio_unlocks (
    id           SERIAL PRIMARY KEY,
    openid       VARCHAR(64) NOT NULL,
    unlock_time  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expire_time  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audio_unlocks_openid_expire
    ON audio_unlocks (openid, expire_time DESC);

-- 云端备份：本地仍是主数据，服务端只做灾备与换机恢复
CREATE TABLE IF NOT EXISTS sleep_records (
    openid       VARCHAR(64) NOT NULL,
    day          DATE NOT NULL,
    bed_at       BIGINT NOT NULL,
    wake_at      BIGINT NOT NULL,
    duration_min INTEGER NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (openid, day)
);

-- 后台配置持久化：key='app' 为下发配置，key='cos' 为加密后的存储凭证
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

-- 到点提醒（一次性订阅消息）
-- thing_key/time_key 是模板字段名快照：运营换模板后，已排队任务仍按创建时的字段发送，
-- 否则“旧模板 + 新字段”会被微信以 47003 拒绝（服务端 SCHEMA 与 init() 同源，此处保持同步）。
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
    thing_key    TEXT NOT NULL DEFAULT '',
    time_key     TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (openid, session_id)
);

CREATE INDEX IF NOT EXISTS idx_sleep_reminders_due
    ON sleep_reminders (status, fire_at);

-- 全量清除水位：清除/后台删除后，早于 erased_at 的记录不能再写回
CREATE TABLE IF NOT EXISTS user_erasures (
    openid       VARCHAR(64) PRIMARY KEY,
    erased_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 运行时增量列（与 db/index.js 的 ALTER 保持一致）
ALTER TABLE sleep_records ADD COLUMN IF NOT EXISTS day_rule TEXT NOT NULL DEFAULT 'bed-v1';
ALTER TABLE sleep_records ADD COLUMN IF NOT EXISTS schema_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sleep_records ADD COLUMN IF NOT EXISTS sessions JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE sleep_records ADD COLUMN IF NOT EXISTS night_duration_min INTEGER;
ALTER TABLE sleep_records ADD COLUMN IF NOT EXISTS total_duration_min INTEGER;
ALTER TABLE sleep_reminders ADD COLUMN IF NOT EXISTS thing_key TEXT NOT NULL DEFAULT '';
ALTER TABLE sleep_reminders ADD COLUMN IF NOT EXISTS time_key TEXT NOT NULL DEFAULT '';

-- 全量清除水位：清除/后台删除后，早于 erased_at 的记录不能再写回
CREATE TABLE IF NOT EXISTS user_erasures (
    openid       VARCHAR(64) PRIMARY KEY,
    erased_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 轻量行为事件：只记 openid + 类型 + 目标，用于后台看板
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

-- 后台敏感操作审计：只存 openid 哈希前缀，不落明文
CREATE TABLE IF NOT EXISTS admin_audit (
    id           BIGSERIAL PRIMARY KEY,
    action       VARCHAR(40) NOT NULL,
    openid_tag   VARCHAR(32) NOT NULL,
    details      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON admin_audit (created_at DESC);

-- 过期解锁记录由服务端每 6 小时清理一次（保留 7 天便于排查）
