const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')

const { createApp } = require('../src/app')
const { loadConfig } = require('../src/config')
const { createMemoryDb } = require('../src/db')

const PASSWORD = 'test-admin-pass'
const FIXED_NOW = Date.UTC(2026, 9, 15, 2, 0)

let server = null
let base = ''
let db = null
let cookie = ''

function cookieFrom(res) {
  const list = res.headers.getSetCookie ? res.headers.getSetCookie() : []
  const raw = list[0] || res.headers.get('set-cookie') || ''
  return raw.split(';')[0]
}

async function call(path, options, useCookie) {
  const init = Object.assign({}, options || {})
  init.headers = Object.assign({}, init.headers || {})
  if (useCookie && cookie) init.headers.cookie = cookie
  if (init.body !== undefined) {
    init.headers['content-type'] = 'application/json'
    init.body = JSON.stringify(init.body)
  }
  const res = await fetch(base + path, init)
  let body = null
  try {
    body = await res.json()
  } catch (e) {
    body = null
  }
  return { status: res.status, body, headers: res.headers }
}

before(async () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    ALLOW_DEV_LOGIN: '1',
    DB_MODE: 'memory',
    ADMIN_PASSWORD: PASSWORD
  })
  db = createMemoryDb()
  const app = createApp({
    config,
    db,
    logger: { log() {}, error() {} },
    now: () => FIXED_NOW
  })
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = 'http://127.0.0.1:' + server.address().port

  const res = await fetch(base + '/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD })
  })
  cookie = cookieFrom(res)
})

after(() => new Promise((resolve) => server.close(resolve)))

test('畸形后台 Cookie 不会 500，按未登录处理', async () => {
  const res = await fetch(base + '/api/admin/session', {
    headers: { cookie: 'sleep_admin=%' }
  })
  assert.equal(res.status, 200)
  assert.equal((await res.json()).authenticated, false)

  const protectedRes = await fetch(base + '/api/admin/config', {
    headers: { cookie: 'sleep_admin=%' }
  })
  assert.equal(protectedRes.status, 401)
})

test('后台页面可访问并带安全头', async () => {
  const res = await fetch(base + '/admin/')
  assert.equal(res.status, 200)
  const html = await res.text()
  assert.match(html, /后台管理/)
  assert.equal(res.headers.get('x-frame-options'), 'DENY')
  assert.match(res.headers.get('content-security-policy') || '', /default-src 'self'/)
})

test('落地页与 H5 演示可访问', async () => {
  const home = await fetch(base + '/')
  assert.equal(home.status, 200)
  const html = await home.text()
  // 新版落地页核心口径：睡点主张 + 小程序码占位 + GEO 文件引用
  assert.match(html, /算出你的/)
  assert.match(html, /mp-qr-img/)
  assert.match(html, /robots\.txt|llms\.txt|application\/ld\+json/)

  const demo = await fetch(base + '/demo/')
  assert.equal(demo.status, 200)
  assert.match(await demo.text(), /H5 交互演示/)
})

test('未登录不能读写配置', async () => {
  const res = await call('/api/admin/config')
  assert.equal(res.status, 401)
  assert.equal(res.body.error.code, 'UNAUTHORIZED')
})

test('密码错误返回 401', async () => {
  const res = await call('/api/admin/login', {
    method: 'POST',
    body: { password: 'wrong-password' }
  })
  assert.equal(res.status, 401)
})

test('登录成功后会话可用，Cookie 带 HttpOnly 与 SameSite', async () => {
  const res = await fetch(base + '/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD })
  })
  assert.equal(res.status, 200)

  const raw = (res.headers.getSetCookie ? res.headers.getSetCookie()[0] : res.headers.get('set-cookie')) || ''
  assert.match(raw, /HttpOnly/i)
  assert.match(raw, /SameSite=Strict/i)

  const session = await call('/api/admin/session', {}, true)
  assert.equal(session.body.authenticated, true)
})

test('读取后台配置，初始来源是文件', async () => {
  const res = await call('/api/admin/config', {}, true)
  assert.equal(res.status, 200)
  assert.equal(res.body.source, 'file')
  assert.ok(res.body.config.audio.length >= 1)
  assert.equal(res.body.storage, 'memory')
})

test('保存时拒绝非 https 的音频地址', async () => {
  const res = await call(
    '/api/admin/config',
    {
      method: 'PUT',
      body: {
        audio: [{ id: 'rain', title: '雨声', url: 'http://cdn.example.com/rain.mp3', icon: 'rain' }],
        unlock: { mode: 'rewarded', adUnitId: '', ttlHours: 24, onAdError: 'grant' },
        features: { summary: true, sync: true, timer: true },
        copy: {}
      }
    },
    true
  )
  assert.equal(res.status, 400)
  assert.equal(res.body.error.code, 'INVALID_BODY')
})

test('保存配置后公共接口与解锁有效期立即生效', async () => {
  const payload = {
    audio: [
      {
        id: 'rain',
        title: '雨声',
        subtitle: '窗外小雨',
        url: 'https://cdn.example.com/sleep/rain.mp3',
        icon: 'rain'
      },
      {
        id: 'wave',
        title: '海浪',
        subtitle: '缓慢的浪',
        url: 'https://cdn.example.com/sleep/wave.mp3',
        icon: 'wave'
      }
    ],
    unlock: { mode: 'rewarded', adUnitId: 'adunit-test', ttlHours: 12, onAdError: 'deny' },
    ads: {
      home: { enabled: true, unitId: 'adunit-home', type: 'template' },
      sleep: { enabled: false, unitId: '', type: 'banner' },
      stats: { enabled: false, unitId: '', type: 'template' },
      statsFooter: { enabled: false, unitId: '', type: 'template' }
    },
    features: { summary: true, sync: false, timer: true, preload: false },
    cache: { maxMB: 120, ttlDays: 5 },
    copy: {
      unlockTitle: '解锁环境音',
      unlockDesc: '看一段视频，今晚都能听',
      unlockConfirm: '看视频',
      unlockCancel: '再想想'
    }
  }

  const saved = await call('/api/admin/config', { method: 'PUT', body: payload }, true)
  assert.equal(saved.status, 200)
  assert.equal(saved.body.source, 'db')
  assert.ok(saved.body.config.version > 2)
  assert.equal(saved.body.config.audio.length, 2)
  assert.equal(saved.body.config.audio[0].category, '环境音')
  assert.equal(saved.body.config.cache.maxMB, 120)

  const publicConfig = await call('/api/config')
  assert.equal(publicConfig.status, 200)
  assert.equal(publicConfig.body.audio[0].id, 'rain')
  assert.equal(publicConfig.body.audio[0].category, '环境音')
  assert.equal(publicConfig.body.unlock.adUnitId, 'adunit-test')
  assert.equal(publicConfig.body.unlock.ttlHours, 12)
  assert.equal(publicConfig.body.ads.home.enabled, true)
  assert.equal(publicConfig.body.ads.home.unitId, 'adunit-home')
  assert.equal(publicConfig.body.ads.sleep.type, 'banner')
  assert.equal(publicConfig.body.ads.stats.enabled, false)
  assert.equal(publicConfig.body.features.sync, false)
  assert.equal(publicConfig.body.features.preload, false)
  assert.equal(publicConfig.body.cache.ttlDays, 5)

  const unlock = await call('/api/audio/unlock', {
    method: 'POST',
    body: { code: 'admin-test-code' }
  })
  assert.equal(unlock.status, 200)
  assert.equal(unlock.body.ttlHours, 12)
  assert.equal(unlock.body.expireAt, FIXED_NOW + 12 * 60 * 60 * 1000)
})

test('落地页/演示页带 CSP，非 API 的 404 返回 HTML', async () => {
  const demo = await fetch(base + '/demo')
  assert.equal(demo.status, 200)
  assert.match(demo.headers.get('content-security-policy') || '', /default-src 'self'/)

  const root = await fetch(base + '/')
  assert.equal(root.status, 200)
  assert.match(root.headers.get('content-security-policy') || '', /script-src 'self'/)

  const page404 = await fetch(base + '/not-found-page', { headers: { accept: 'text/html' } })
  assert.equal(page404.status, 404)
  assert.match(page404.headers.get('content-type') || '', /text\/html/)

  const api404 = await fetch(base + '/api/not-found')
  assert.equal(api404.status, 404)
  assert.match(api404.headers.get('content-type') || '', /application\/json/)
})

test('后台概览返回记录与解锁数量', async () => {
  const res = await call('/api/admin/stats', {}, true)
  assert.equal(res.status, 200)
  assert.equal(res.body.records, 0)
  assert.equal(res.body.users, 0)
  assert.equal(res.body.activeUnlocks, 1)
})

test('服务端关闭云同步后 sync 返回 403', async () => {
  const sync = await call('/api/records/sync', {
    method: 'POST',
    body: { code: 'sync-gate-code', records: [] }
  })
  assert.equal(sync.status, 403)
  assert.equal(sync.body.error.code, 'FEATURE_OFF')
})

test('保存配置未携带 ads 时保留已有展示位，不会被静默清零', async () => {
  const res = await call(
    '/api/admin/config',
    {
      method: 'PUT',
      body: {
        audio: [{ id: 'rain', title: '雨声', url: 'https://cdn.example.com/rain.mp3', icon: 'rain' }],
        unlock: { mode: 'rewarded', adUnitId: '', ttlHours: 24, onAdError: 'grant' },
        features: { summary: true, sync: true, timer: true },
        cache: { maxMB: 80, ttlDays: 7 },
        copy: {}
      }
    },
    true
  )
  assert.equal(res.status, 200)

  const publicConfig = await call('/api/config')
  assert.equal(publicConfig.body.ads.home.enabled, true)
  assert.equal(publicConfig.body.ads.home.unitId, 'adunit-home')
})

test('启用的页面展示位缺少广告位 ID 会被拒绝', async () => {
  const res = await call(
    '/api/admin/config',
    {
      method: 'PUT',
      body: {
        audio: [{ id: 'rain', title: '雨声', url: 'https://cdn.example.com/rain.mp3', icon: 'rain' }],
        unlock: { mode: 'rewarded', adUnitId: '', ttlHours: 24, onAdError: 'grant' },
        ads: {
          home: { enabled: true, unitId: '', type: 'template' },
          sleep: { enabled: false, unitId: '', type: 'template' },
          stats: { enabled: false, unitId: '', type: 'template' },
          statsFooter: { enabled: false, unitId: '', type: 'template' }
        },
        features: { summary: true, sync: true, timer: true },
        copy: {}
      }
    },
    true
  )
  assert.equal(res.status, 400)
  assert.equal(res.body.error.code, 'INVALID_BODY')
})

test('重复的音频 ID 会被拒绝', async () => {
  const res = await call(
    '/api/admin/config',
    {
      method: 'PUT',
      body: {
        audio: [
          { id: 'same', title: 'A', url: 'https://cdn.example.com/a.mp3', icon: 'rain' },
          { id: 'same', title: 'B', url: 'https://cdn.example.com/b.mp3', icon: 'wave' }
        ],
        unlock: { mode: 'rewarded', adUnitId: '', ttlHours: 24, onAdError: 'grant' },
        features: { summary: true, sync: true, timer: true },
        copy: {}
      }
    },
    true
  )
  assert.equal(res.status, 400)
})

test('背景图配置保存、校验与公开下发', async () => {
  const basePayload = {
    audio: [{ id: 'rain', title: '雨声', url: 'https://cdn.example.com/rain.mp3', icon: 'rain' }],
    unlock: { mode: 'rewarded', adUnitId: '', ttlHours: 24, onAdError: 'grant' },
    features: { summary: true, sync: true, timer: true },
    cache: { maxMB: 80, ttlDays: 7 },
    copy: {},
    backgroundUnlockHours: 72
  }

  const saved = await call(
    '/api/admin/config',
    {
      method: 'PUT',
      body: Object.assign({}, basePayload, {
        backgrounds: [
          { id: 'bg-a', title: '湖面', category: '夜色', url: 'https://cdn.example.com/bg-a.jpg', enabled: true },
          { id: 'bg-b', title: '山川', category: '山川', url: 'https://cdn.example.com/bg-b.jpg', enabled: true }
        ],
        defaultBackgroundId: 'bg-a'
      })
    },
    true
  )
  assert.equal(saved.status, 200)

  const publicConfig = await call('/api/config')
  assert.equal(publicConfig.body.backgrounds.length, 2)
  assert.equal(publicConfig.body.backgrounds[0].id, 'bg-a')
  assert.equal(publicConfig.body.defaultBackgroundId, 'bg-a')
  assert.equal(publicConfig.body.backgroundUnlockHours, 72)

  const badUrl = await call(
    '/api/admin/config',
    {
      method: 'PUT',
      body: Object.assign({}, basePayload, {
        backgrounds: [{ id: 'bg-a', title: '湖面', url: 'http://cdn.example.com/bg-a.jpg' }],
        defaultBackgroundId: 'bg-a'
      })
    },
    true
  )
  assert.equal(badUrl.status, 400)

  const missingDefault = await call(
    '/api/admin/config',
    {
      method: 'PUT',
      body: Object.assign({}, basePayload, {
        backgrounds: [{ id: 'bg-a', title: '湖面', url: 'https://cdn.example.com/bg-a.jpg' }],
        defaultBackgroundId: 'missing'
      })
    },
    true
  )
  assert.equal(missingDefault.status, 400)

  const disabledDefault = await call(
    '/api/admin/config',
    {
      method: 'PUT',
      body: Object.assign({}, basePayload, {
        backgrounds: [
          { id: 'bg-a', title: '湖面', url: 'https://cdn.example.com/bg-a.jpg', enabled: false },
          { id: 'bg-b', title: '山川', url: 'https://cdn.example.com/bg-b.jpg', enabled: true }
        ],
        defaultBackgroundId: 'bg-a'
      })
    },
    true
  )
  assert.equal(disabledDefault.status, 400)
  assert.match(disabledDefault.body.error.message, /停用/)
})

test('背景图上传先校验登录与文件', async () => {
  const unauth = await fetch(base + '/api/admin/backgrounds/upload', {
    method: 'POST',
    body: new FormData()
  })
  assert.equal(unauth.status, 401)

  const empty = new FormData()
  empty.append('note', 'no-file')
  const res = await fetch(base + '/api/admin/backgrounds/upload', {
    method: 'POST',
    headers: { cookie: cookie },
    body: empty
  })
  assert.equal(res.status, 400)
})

test('事件上报与看板聚合', async () => {
  const events = [
    { type: 'app_open', ts: FIXED_NOW },
    { type: 'checkin', target: '', ts: FIXED_NOW },
    { type: 'audio_play', target: 'rain', ts: FIXED_NOW },
    { type: 'ad_show', target: 'home', ts: FIXED_NOW },
    { type: 'ad_error', target: 'sleep', ts: FIXED_NOW },
    // 分享漏斗的分母：没有它无法判断分享动作是否有效
    { type: 'share', target: 'wake', ts: FIXED_NOW }
  ]

  const sent = await call('/api/events', { method: 'POST', body: { code: 'events-code', events } })
  assert.equal(sent.status, 200)
  assert.equal(sent.body.accepted, 6)

  // 补记事件：两个页面的补记成功都会 track('manual_sleep')。
  // 它曾不在白名单，导致整批事件被 400 拒绝后由客户端丢弃（静默丢数）。
  const manual = await call('/api/events', {
    method: 'POST',
    body: { code: 'events-code', events: [{ type: 'manual_sleep', ts: FIXED_NOW }] }
  })
  assert.equal(manual.status, 200)
  assert.equal(manual.body.accepted, 1)

  const bad = await call('/api/events', {
    method: 'POST',
    body: { code: 'events-code', events: [{ type: 'hack', ts: FIXED_NOW }] }
  })
  assert.equal(bad.status, 400)

  const board = await call('/api/admin/analytics', {}, true)
  assert.equal(board.status, 200)
  assert.equal(board.body.today.opens, 1)
  assert.equal(board.body.ads.todayShows, 1)
  assert.equal(board.body.ads.todayErrors, 1)
  assert.equal(board.body.ads.fillRate, 50)
  assert.equal(board.body.ads.bySlot.length, 2)
  assert.equal(board.body.today.checkins, 1)
  assert.equal(board.body.today.plays, 1)
  // 补记是独立指标：只打卡不补记 vs 高补记率决定产品动作，必须有出口
  assert.equal(board.body.today.manualSleeps, 1)
  assert.equal(board.body.week.manualSleeps, 1)
  assert.equal(board.body.today.shares, 1)
  assert.equal(board.body.week.shares, 1)
  assert.equal(board.body.trend.length, 14)
  assert.equal(board.body.topTracks[0].id, 'rain')
  assert.equal(board.body.topTracks[0].title, '雨声')
})

test('后台可按 openid 查询并删除用户记录', async () => {
  const records = [
    {
      day: '2026-10-14',
      bedAt: Date.UTC(2026, 9, 14, 15, 50),
      wakeAt: Date.UTC(2026, 9, 14, 23, 30),
      updatedAt: FIXED_NOW
    }
  ]
  const synced = await call('/api/records/sync', {
    method: 'POST',
    body: { code: 'admin-user-code', records }
  })
  assert.equal(synced.status, 200)
  await call('/api/audio/unlock', { method: 'POST', body: { code: 'admin-user-code' } })
  await call('/api/events', {
    method: 'POST',
    body: { code: 'admin-user-code', events: [{ type: 'checkin', ts: FIXED_NOW }] }
  })

  const found = await call('/api/admin/users/dev_openid', {}, true)
  assert.equal(found.status, 200)
  assert.equal(found.body.openid, 'dev_openid')
  assert.equal(found.body.count, 1)
  assert.equal(found.body.records[0].day, '2026-10-14')
  assert.ok(found.body.unlockExpireAt > FIXED_NOW)
  assert.ok(found.body.eventCount >= 1)

  const removed = await call('/api/admin/users/dev_openid/records', { method: 'DELETE' }, true)
  assert.equal(removed.status, 200)
  assert.equal(removed.body.deleted, 1)
  assert.equal(removed.body.deletedUnlocks, 1)
  assert.ok(removed.body.deletedEvents >= 1)

  const after = await call('/api/admin/users/dev_openid', {}, true)
  assert.equal(after.status, 200)
  assert.equal(after.body.count, 0)
  assert.equal(after.body.unlockExpireAt, 0)
  assert.equal(after.body.eventCount, 0)
  assert.ok(after.body.erasedAt > 0)
})

test('云端无数据的 openid 也能写入全量清除水位', async () => {
  const openid = 'empty_user_001'
  const before = await call('/api/admin/users/' + openid, {}, true)
  assert.equal(before.status, 200)
  assert.equal(before.body.count, 0)
  assert.equal(before.body.erasedAt, 0)
  assert.equal(before.body.deletedDayCount, 0)

  const removed = await call('/api/admin/users/' + openid + '/records', { method: 'DELETE' }, true)
  assert.equal(removed.status, 200)
  assert.equal(removed.body.deleted, 0)
  assert.ok(removed.body.erasedAt > 0)
  assert.equal(await db.getErasure(openid), removed.body.erasedAt)

  const after = await call('/api/admin/users/' + openid, {}, true)
  assert.equal(after.status, 200)
  assert.equal(after.body.erasedAt, removed.body.erasedAt)
})

test('后台用户查询拒绝非法 openid，且未登录不可用', async () => {
  const bad = await call('/api/admin/users/x', {}, true)
  assert.equal(bad.status, 400)

  const unauth = await call('/api/admin/users/dev_openid')
  assert.equal(unauth.status, 401)
})

test('上传接口先校验登录与文件', async () => {
  const unauth = await fetch(base + '/api/admin/audio/upload', {
    method: 'POST',
    body: new FormData()
  })
  assert.equal(unauth.status, 401)

  const empty = new FormData()
  empty.append('note', 'no-file')
  const res = await fetch(base + '/api/admin/audio/upload', {
    method: 'POST',
    headers: { cookie: cookie },
    body: empty
  })
  assert.equal(res.status, 400)
  const body = await res.json()
  assert.equal(body.error.code, 'INVALID_BODY')
})

test('COS 配置加密保存且不回显 SecretKey', async () => {
  const before = await call('/api/admin/storage', {}, true)
  assert.equal(before.status, 200)
  assert.equal(before.body.configured, false)
  assert.equal(before.body.securityReady, true)

  const saved = await call(
    '/api/admin/storage',
    {
      method: 'PUT',
      body: {
        bucket: 'qfmaster-1322402212',
        region: 'ap-shanghai',
        domain: '',
        prefix: 'sleep',
        secretId: 'AKIDtest',
        secretKey: 'super-secret-key'
      }
    },
    true
  )

  assert.equal(saved.status, 200)
  assert.equal(saved.body.configured, true)
  assert.equal(saved.body.hasSecret, true)
  assert.equal(saved.body.secretId, '****')
  assert.equal(saved.body.secretIdConfigured, true)
  assert.ok(!JSON.stringify(saved.body).includes('AKIDtest'))
  assert.ok(!JSON.stringify(saved.body).includes('super-secret-key'))

  const row = await db.getSetting('cos')
  assert.ok(row.value.secretKeyEnc)
  assert.ok(!row.value.secretKeyEnc.includes('super-secret-key'))

  // 前端回填的是脱敏值：原样提交（SecretKey 留空）不能把掩码写库
  const unchanged = await call(
    '/api/admin/storage',
    {
      method: 'PUT',
      body: {
        bucket: 'qfmaster-1322402212',
        region: 'ap-shanghai',
        domain: '',
        prefix: 'sleep',
        secretId: saved.body.secretId,
        secretKey: ''
      }
    },
    true
  )
  assert.equal(unchanged.status, 200)
  const rowAfter = await db.getSetting('cos')
  assert.equal(rowAfter.value.secretId, 'AKIDtest')
  assert.equal(rowAfter.value.secretKeyEnc, row.value.secretKeyEnc)
})

// 放在文件末尾：它会写库，把配置来源从 file 翻成 db
test('审计可读：保存配置后能在 /api/admin/audit 查到', async () => {
  const unauth = await fetch(base + '/api/admin/audit')
  assert.equal(unauth.status, 401)

  const current = await call('/api/admin/config', {}, true)
  assert.equal(current.status, 200)
  const saved = await call('/api/admin/config', { method: 'PUT', body: current.body.config }, true)
  assert.equal(saved.status, 200)

  const audit = await call('/api/admin/audit?limit=20', {}, true)
  assert.equal(audit.status, 200)
  assert.ok(Array.isArray(audit.body.items))
  assert.ok(
    audit.body.items.some((item) => item.action === 'admin_config_save'),
    '审计里没有 admin_config_save'
  )
  assert.ok(audit.body.items.every((item) => typeof item.createdAt === 'number'))
})

test('订阅消息模板可在后台配置并下发，环境面板不回显密钥', async () => {
  const current = await call('/api/admin/config', {}, true)
  assert.equal(current.status, 200)
  const payload = Object.assign({}, current.body.config, {
    reminder: { enabled: true, templateId: 'tmpl-admin-1234567890', page: 'pages/sleep/sleep?end=1' }
  })
  const saved = await call('/api/admin/config', { method: 'PUT', body: payload }, true)
  assert.equal(saved.status, 200)
  assert.equal(saved.body.config.reminder.templateId, 'tmpl-admin-1234567890')

  const publicConfig = await call('/api/config')
  assert.equal(publicConfig.body.reminder.templateId, 'tmpl-admin-1234567890')
  assert.equal(publicConfig.body.reminder.enabled, true)
  assert.equal(publicConfig.body.reminder.page, 'pages/sleep/sleep?end=1')

  const env = await call('/api/admin/env', {}, true)
  assert.equal(env.status, 200)
  assert.equal(typeof env.body.appidConfigured, 'boolean')
  assert.equal(typeof env.body.secretConfigured, 'boolean')
  // 只读面板只给"是否就绪"，任何密钥值都不能出现在响应里
  assert.equal(env.body.appid, undefined)
  assert.equal(env.body.secret, undefined)
})

test('订阅消息模板 ID / 跳转路径非法时拒绝保存', async () => {
  const current = await call('/api/admin/config', {}, true)
  const badTemplate = Object.assign({}, current.body.config, {
    reminder: { enabled: true, templateId: 'bad id!', page: 'pages/sleep/sleep?end=1' }
  })
  const rejected = await call('/api/admin/config', { method: 'PUT', body: badTemplate }, true)
  assert.equal(rejected.status, 400)

  const badPage = Object.assign({}, current.body.config, {
    reminder: { enabled: true, templateId: 'tmpl-admin-1234567890', page: 'javascript:alert(1)' }
  })
  const rejectedPage = await call('/api/admin/config', { method: 'PUT', body: badPage }, true)
  assert.equal(rejectedPage.status, 400)
})

test('改密闭环：错旧密拒绝、弱密码拒绝、改后旧会话失效、新密码可登、审计留痕', async () => {
  // 1) 初始来源是 env（内存模式：改密不持久）
  const initial = await call('/api/admin/security', {}, true)
  assert.equal(initial.status, 200)
  assert.equal(initial.body.source, 'env')
  assert.equal(initial.body.persistent, false)

  // 2) 当前密码错误 → 401（不是 429/400，前端据此提示“当前密码不正确”）
  const wrong = await call(
    '/api/admin/password',
    { method: 'POST', body: { currentPassword: 'not-the-password', newPassword: 'another-pass-1' } },
    true
  )
  assert.equal(wrong.status, 401)
  assert.match(wrong.body.error.message, /当前密码不正确/)

  // 3) 新密码过短 → 400
  const weak = await call(
    '/api/admin/password',
    { method: 'POST', body: { currentPassword: PASSWORD, newPassword: '1234567' } },
    true
  )
  assert.equal(weak.status, 400)

  // 4) 正常修改
  const changed = await call(
    '/api/admin/password',
    { method: 'POST', body: { currentPassword: PASSWORD, newPassword: 'brand-new-pass-9' } },
    true
  )
  assert.equal(changed.status, 200)
  assert.equal(changed.body.relogin, true)

  // 5) 旧 Cookie 立即失效（令牌版本变化，无需重启）
  const stale = await call('/api/admin/session', {}, true)
  assert.equal(stale.status, 200)
  assert.equal(stale.body.authenticated, false)

  // 6) 旧密码（env）不能再登录：库内凭据优先，避免轮换后 env 成后门
  const oldLogin = await call('/api/admin/login', { method: 'POST', body: { password: PASSWORD } })
  assert.equal(oldLogin.status, 401)

  // 7) 新密码可登录，且来源变为 db
  const relogin = await fetch(base + '/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'brand-new-pass-9' })
  })
  assert.equal(relogin.status, 200)
  cookie = cookieFrom(relogin)
  const after = await call('/api/admin/security', {}, true)
  assert.equal(after.body.source, 'db')
  assert.ok(after.body.updatedAt > 0)

  // 8) 审计有 admin_password_change，且不含任何密码材料
  const audit = await call('/api/admin/audit?limit=50', {}, true)
  assert.equal(audit.status, 200)
  const row = (audit.body.items || []).filter((item) => item.action === 'admin_password_change')[0]
  assert.ok(row, '必须留下改密审计')
  const dump = JSON.stringify(row)
  assert.equal(/brand-new-pass-9|scrypt|salt/.test(dump), false)
})

test('改密持久化：用库内凭据重建 app 后新密码可登、env 密码不可用', async () => {
  const stored = await db.getSetting('admin_credentials')
  assert.ok(stored && stored.value && stored.value.hash, '改密必须落库（含 salt/hash）')

  const config = loadConfig({
    NODE_ENV: 'test',
    ALLOW_DEV_LOGIN: '1',
    DB_MODE: 'memory',
    ADMIN_PASSWORD: PASSWORD
  })
  // 模拟重启：index.js 读库后把 stored.value 传给 createApp
  const app2 = createApp({
    config,
    db,
    adminCredentials: stored.value,
    logger: { log() {}, error() {} },
    now: () => FIXED_NOW
  })
  const server2 = app2.listen(0)
  await new Promise((resolve) => server2.once('listening', resolve))
  const base2 = 'http://127.0.0.1:' + server2.address().port
  try {
    const ok = await fetch(base2 + '/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'brand-new-pass-9' })
    })
    assert.equal(ok.status, 200)

    const envLogin = await fetch(base2 + '/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD })
    })
    assert.equal(envLogin.status, 401, 'env 密码在落库后必须失效')
  } finally {
    await new Promise((resolve) => server2.close(resolve))
  }
})
