const { test } = require('node:test')
const assert = require('node:assert/strict')

const { loadConfig } = require('../src/config')
const { createDb } = require('../src/db')
const { normalizeConfig, validateConfig } = require('../src/lib/config-schema')

const FILE_AUDIO = [
  {
    id: 'sleep-10001',
    title: '环境音 01',
    subtitle: '循环播放 · 支持锁屏',
    category: '环境音',
    url: 'https://example.com/a.mp3',
    icon: 'noise'
  }
]

test('生产环境缺少 ADMIN_PASSWORD 时启动失败', () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: 'production',
        DB_MODE: 'postgres',
        DATABASE_URL: 'postgres://user:pass@db:5432/sleep',
        WX_APPID: 'wx-test',
        WX_SECRET: 'secret',
        ADMIN_PASSWORD: ''
      }),
    /ADMIN_PASSWORD/
  )
})

test('旧配置缺少 category / cache 时按默认值补齐', () => {
  const base = normalizeConfig({ audio: FILE_AUDIO, unlock: {}, features: {}, copy: {} })
  const normalized = normalizeConfig(
    {
      version: 3,
      audio: [{ id: 'old', title: '旧音频', url: 'https://example.com/old.mp3' }],
      unlock: base.unlock,
      features: { summary: true },
      copy: base.copy
    },
    base
  )

  assert.equal(normalized.audio[0].category, '环境音')
  assert.equal(normalized.audio[0].subtitle, '循环播放 · 支持锁屏')
  assert.equal(normalized.audio[0].icon, 'noise')
  assert.equal(normalized.cache.maxMB, 80)
  assert.equal(normalized.features.preload, true)
})

test('开发环境未设密码时生成随机临时密码，且不把 COS 密钥标为可用', () => {
  const config = loadConfig({ NODE_ENV: 'test', DB_MODE: 'memory' })
  assert.notEqual(config.admin.password, 'password123')
  assert.equal(config.admin.generated, true)
  assert.equal(config.security.ready, false)
})

test('部分字段保存不会重置 unlock/features/cache/copy', () => {
  const base = validateConfig({
    audio: FILE_AUDIO,
    unlock: { mode: 'rewarded', adUnitId: 'adunit-x', ttlHours: 12, onAdError: 'deny' },
    features: { sync: false, events: false },
    cache: { maxMB: 120, ttlDays: 3 },
    copy: { unlockTitle: '自定义标题', unlockDesc: '自定义说明', unlockConfirm: '继续', unlockCancel: '关闭' }
  })
  const partial = validateConfig({ audio: base.audio }, base)
  assert.equal(partial.unlock.adUnitId, 'adunit-x')
  assert.equal(partial.unlock.ttlHours, 12)
  assert.equal(partial.unlock.onAdError, 'deny')
  assert.equal(partial.features.sync, false)
  assert.equal(partial.features.events, false)
  assert.equal(partial.cache.maxMB, 120)
  assert.equal(partial.cache.ttlDays, 3)
  assert.equal(partial.copy.unlockTitle, '自定义标题')
})

test('解锁说明旧默认文案读取时迁移为中端口径，自定义文案不动', () => {
  const base = normalizeConfig({ audio: FILE_AUDIO, unlock: {}, features: {}, copy: {} })
  const withDesc = (desc) =>
    normalizeConfig(
      {
        version: 4,
        audio: FILE_AUDIO,
        unlock: Object.assign({}, base.unlock, { ttlHours: 12 }),
        copy: Object.assign({}, base.copy, { unlockDesc: desc })
      },
      base
    )

  // 种子配置里的旧文案（写死 24 小时、含“今晚的”）
  assert.equal(
    withDesc('观看视频，解锁今晚的环境声音（24小时内有效）').copy.unlockDesc,
    '观看视频，解锁环境声音（12 小时内有效）'
  )
  // 旧生成逻辑产生的带空格形态同样迁移
  assert.equal(
    withDesc('观看视频，解锁今晚的环境声音（24 小时内有效）').copy.unlockDesc,
    '观看视频，解锁环境声音（12 小时内有效）'
  )
  // 运营自定义文案原样保留（哪怕它自己写了“今晚”）
  assert.equal(
    withDesc('看一段视频，今晚都能听').copy.unlockDesc,
    '看一段视频，今晚都能听'
  )
})

test('旧配置缺少 site 时按默认值补齐，落地页有兜底口径', () => {
  const base = normalizeConfig({ audio: FILE_AUDIO, unlock: {}, features: {}, copy: {} })
  assert.equal(base.site.mpQrCodeUrl, '')
  assert.equal(base.site.mpQrNote, '微信搜索「睡点」')

  // 旧库行没有 site 字段：读取路径必须补默认值而不是 undefined
  const normalized = normalizeConfig(
    { version: 3, audio: FILE_AUDIO, unlock: base.unlock, copy: base.copy },
    base
  )
  assert.equal(normalized.site.mpQrCodeUrl, '')
  assert.equal(normalized.site.mpQrNote, '微信搜索「睡点」')
})

test('site 保存校验：https 限制、可清空、部分保存沿用旧值', () => {
  const base = validateConfig({
    audio: FILE_AUDIO,
    site: { mpQrCodeUrl: 'https://img.example.com/sleep/mp-qr.png', mpQrNote: '扫码打开' }
  })
  assert.equal(base.site.mpQrCodeUrl, 'https://img.example.com/sleep/mp-qr.png')
  assert.equal(base.site.mpQrNote, '扫码打开')

  // 未提交 site 时沿用当前配置，避免旧后台保存把小程序码静默清掉
  const partial = validateConfig({ audio: base.audio }, base)
  assert.equal(partial.site.mpQrCodeUrl, 'https://img.example.com/sleep/mp-qr.png')
  assert.equal(partial.site.mpQrNote, '扫码打开')

  // 显式置空 URL 允许（落地页回退搜索提示）；未提交的文案沿用旧值
  const cleared = validateConfig({ audio: base.audio, site: { mpQrCodeUrl: '' } }, base)
  assert.equal(cleared.site.mpQrCodeUrl, '')
  assert.equal(cleared.site.mpQrNote, '扫码打开')

  // URL 与文案同时提交为空：URL 清空、文案回默认
  const clearedAll = validateConfig({ audio: base.audio, site: { mpQrCodeUrl: '', mpQrNote: '' } }, base)
  assert.equal(clearedAll.site.mpQrCodeUrl, '')
  assert.equal(clearedAll.site.mpQrNote, '微信搜索「睡点」')

  assert.throws(
    () => validateConfig({ audio: base.audio, site: { mpQrCodeUrl: 'http://insecure.example.com/a.png' } }),
    /https/
  )
})

test('未知 DB_MODE 在生产启动即失败，createDb 不静默落内存', async () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: 'production',
        DB_MODE: 'postgresql',
        DATABASE_URL: 'postgres://user:pass@db:5432/sleep',
        WX_APPID: 'wx-test',
        WX_SECRET: 'secret',
        ADMIN_PASSWORD: 'strong-password'
      }),
    /DB_MODE/
  )
  await assert.rejects(() => createDb({ mode: 'postgresql' }), /未知 DB_MODE/)
})

test('启动数值配置非法时失败，不静默退化为 NaN/0', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'test', DB_MODE: 'memory', TRUST_PROXY: 'true' }),
    /TRUST_PROXY/
  )
  assert.throws(
    () => loadConfig({ NODE_ENV: 'test', DB_MODE: 'memory', RATE_UNLOCK_IP: 'abc' }),
    /RATE_UNLOCK_IP/
  )
})

test('生产环境配置齐全时可以启动', () => {
  const config = loadConfig({
    NODE_ENV: 'production',
    DB_MODE: 'postgres',
    DATABASE_URL: 'postgres://user:pass@db:5432/sleep',
    WX_APPID: 'wx-test',
    WX_SECRET: 'secret',
    ADMIN_PASSWORD: 'strong-password',
    CONFIG_SECRET: 'stable-config-secret',
    TRUST_PROXY: '1'
  })

  assert.equal(config.admin.password, 'strong-password')
  assert.equal(config.security.ready, true)
  assert.equal(config.trustProxy, 1)
  assert.equal(config.app.cache.maxMB, 80)
  // 文件配置的 site 段必须进 app：漏传会让空库首次部署丢失落地页小程序码
  assert.ok(config.app.site, 'app.site 缺失')
  assert.equal(typeof config.app.site.mpQrNote, 'string')
  // 国际站 web 段同理：漏传会让后台面板只写不读（docs/14 §9 要求可编辑且生效）
  assert.ok(config.app.web, 'app.web 缺失')
  assert.equal(config.app.web.brand, 'SleepCycle')
})

test('订阅消息配置：默认开启、模板 ID 可后台填写、非法值被拒', () => {
  const base = normalizeConfig({ audio: FILE_AUDIO, unlock: {}, features: {}, copy: {} })
  assert.equal(base.reminder.enabled, true)
  assert.equal(base.reminder.templateId, '')
  assert.equal(base.reminder.page, 'pages/sleep/sleep?end=1')

  assert.equal(base.reminder.thingKey, 'thing1')
  assert.equal(base.reminder.timeKey, 'time2')

  const ok = validateConfig(
    Object.assign({}, base, {
      reminder: {
        enabled: true,
        templateId: 'abc_DEF-1234567890',
        page: 'pages/sleep/sleep?end=1',
        thingKey: 'thing2',
        timeKey: 'time1'
      }
    }),
    base
  )
  assert.equal(ok.reminder.templateId, 'abc_DEF-1234567890')
  assert.equal(ok.reminder.enabled, true)
  // 「睡觉到点提醒」这类模板是 time1 + thing2：必须支持任意映射
  assert.equal(ok.reminder.thingKey, 'thing2')
  assert.equal(ok.reminder.timeKey, 'time1')

  assert.throws(
    () =>
      validateConfig(
        Object.assign({}, base, { reminder: { templateId: 'bad id!' } }),
        base
      ),
    /模板 ID/
  )
  assert.throws(
    () =>
      validateConfig(
        Object.assign({}, base, { reminder: { page: 'http://example.com' } }),
        base
      ),
    /跳转路径/
  )
  assert.throws(
    () =>
      validateConfig(
        Object.assign({}, base, { reminder: { thingKey: 'Thing 1' } }),
        base
      ),
    /字段名/
  )
  assert.throws(
    () =>
      validateConfig(
        Object.assign({}, base, { reminder: { thingKey: 'thing1', timeKey: 'thing1' } }),
        base
      ),
    /同一个字段名/
  )
})

test('国际站配置：normalize 必须保留 web 段（只写不读是已发生过的缺陷）', () => {
  const base = normalizeConfig({ audio: FILE_AUDIO, unlock: {}, features: {}, copy: {} })
  // 缺省时给 DEFAULT_WEB，而不是 undefined
  assert.equal(base.web.enabled, true)
  assert.equal(base.web.brand, 'SleepCycle')
  assert.deepEqual(base.web.locales, ['en', 'es'])

  const kept = normalizeConfig(
    {
      audio: FILE_AUDIO,
      unlock: {},
      features: {},
      copy: {},
      web: { brand: 'MySleep', locales: ['ja', 'xx', 'en'], freeLimit: 3 }
    },
    base
  )
  assert.equal(kept.web.brand, 'MySleep')
  assert.equal(kept.web.freeLimit, 3)
  // 与后台 validateConfig 同口径：未知 locale 丢弃、最多 4 个
  assert.deepEqual(kept.web.locales, ['ja', 'en'])
  // 后台显式关闭后不得被默认值翻回 true
  assert.equal(normalizeConfig({ web: { enabled: false } }, base).web.enabled, false)
})

test('生产环境未设置 TRUST_PROXY 时拒绝启动（限流桶会全站共用）', () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: 'production',
        DB_MODE: 'postgres',
        DATABASE_URL: 'postgres://user:pass@db:5432/sleep',
        WX_APPID: 'wx-test',
        WX_SECRET: 'secret',
        ADMIN_PASSWORD: 'strong-password'
      }),
    /TRUST_PROXY/
  )
})

test('生产环境显式 TRUST_PROXY=0（直连部署）允许启动', () => {
  const config = loadConfig({
    NODE_ENV: 'production',
    DB_MODE: 'postgres',
    DATABASE_URL: 'postgres://user:pass@db:5432/sleep',
    WX_APPID: 'wx-test',
    WX_SECRET: 'secret',
    ADMIN_PASSWORD: 'strong-password',
    TRUST_PROXY: '0'
  })
  assert.equal(config.trustProxy, 0)
})
