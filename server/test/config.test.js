const { test } = require('node:test')
const assert = require('node:assert/strict')

const { loadConfig } = require('../src/config')
const { normalizeConfig } = require('../src/lib/config-schema')

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
})
