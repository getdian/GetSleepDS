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
    CONFIG_SECRET: 'stable-config-secret'
  })

  assert.equal(config.admin.password, 'strong-password')
  assert.equal(config.security.ready, true)
  assert.equal(config.app.cache.maxMB, 80)
  // 文件配置的 site 段必须进 app：漏传会让空库首次部署丢失落地页小程序码
  assert.ok(config.app.site, 'app.site 缺失')
  assert.equal(typeof config.app.site.mpQrNote, 'string')
})
