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
  assert.match(await home.text(), /今晚几点睡/)

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
    { type: 'ad_error', target: 'sleep', ts: FIXED_NOW }
  ]

  const sent = await call('/api/events', { method: 'POST', body: { code: 'events-code', events } })
  assert.equal(sent.status, 200)
  assert.equal(sent.body.accepted, 5)

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
  assert.ok(!JSON.stringify(saved.body).includes('super-secret-key'))

  const row = await db.getSetting('cos')
  assert.ok(row.value.secretKeyEnc)
  assert.ok(!row.value.secretKeyEnc.includes('super-secret-key'))
})
