const test = require('node:test')
const assert = require('node:assert/strict')

const { createAnalytics, dayKey } = require('../src/services/analytics')

function fakeDeps(events) {
  return {
    db: {
      listEvents: async () => events,
      adminStats: async () => ({ users: 3 })
    },
    store: {
      get: async () => ({ config: { audio: [{ id: 'a1', title: '雨声' }] } })
    }
  }
}

function eventAt(offsetDays, type, target, openid) {
  const ts = Date.now() - offsetDays * 24 * 60 * 60 * 1000
  return { openid: openid || 'o-1', type, target: target || '', ts }
}

test('topSources 按 app_open 的 target 聚合并取 Top5', async () => {
  const events = [
    eventAt(0, 'app_open', '1007|pages/index/index|share'),
    eventAt(0, 'app_open', '1007|pages/index/index|share'),
    eventAt(0, 'app_open', '1154|pages/index/index|timeline'),
    eventAt(0, 'app_open', ''),
    eventAt(0, 'app_open', ''),
    eventAt(0, 'app_open', '1001|pages/index/index'),
    eventAt(0, 'checkin', '2026-10-19'),
    eventAt(0, 'audio_play', 'a1')
  ]
  const analytics = createAnalytics(fakeDeps(events))
  const overview = await analytics.overview(Date.now())

  assert.ok(Array.isArray(overview.topSources))
  assert.equal(overview.topSources.length, 4)
  assert.deepEqual(overview.topSources[0], { source: '1007|pages/index/index|share', opens: 2 })
  assert.deepEqual(overview.topSources[1], { source: 'unknown', opens: 2 })
  assert.equal(overview.topSources[2].source, '1154|pages/index/index|timeline')
  assert.equal(overview.topSources[3].source, '1001|pages/index/index')

  // 原有口径不受影响（opens 是去重用户数，同一 openid 多次打开只计 1）
  assert.equal(overview.topTracks.length, 1)
  assert.equal(overview.topTracks[0].title, '雨声')
  assert.equal(overview.today.opens, 1)
  assert.equal(overview.today.checkins, 1)
})

test('事件量达到 2 万条时标记 truncated', async () => {
  const events = Array.from({ length: 20000 }, (_, i) =>
    eventAt(0, 'app_open', '1001|pages/index/index', 'o-' + (i % 10))
  )
  const analytics = createAnalytics(fakeDeps(events))
  const overview = await analytics.overview(Date.now())
  assert.equal(overview.truncated, true)

  const small = createAnalytics(fakeDeps([eventAt(0, 'app_open', '1001|pages/index/index')]))
  const normal = await small.overview(Date.now())
  assert.equal(normal.truncated, false)
})

test('窗口外的事件不进入统计', async () => {
  const events = [
    eventAt(0, 'app_open', '1007|pages/index/index|share'),
    eventAt(20, 'app_open', '1001|pages/index/index')
  ]
  const analytics = createAnalytics(fakeDeps(events))
  const overview = await analytics.overview(Date.now())

  assert.equal(overview.topSources.length, 1)
  assert.equal(overview.topSources[0].source, '1007|pages/index/index|share')
})

test('本周按周一 00:00 起，不把上周日算进来', async () => {
  const now = Date.parse('2026-10-19T10:00:00+08:00') // 周一
  const events = [
    { openid: 'o-1', type: 'checkin', target: '', ts: Date.parse('2026-10-18T23:00:00+08:00') },
    { openid: 'o-1', type: 'checkin', target: '', ts: Date.parse('2026-10-19T09:00:00+08:00') }
  ]
  const analytics = createAnalytics(fakeDeps(events))
  const overview = await analytics.overview(now)
  assert.equal(overview.week.checkins, 1)
  assert.equal(overview.today.checkins, 1)
})

test('audio_interrupt 只统计 begin：中断频次不被 end 翻倍', async () => {
  const events = [
    eventAt(0, 'audio_interrupt', 'begin|a1'),
    eventAt(0, 'audio_interrupt', 'end|12s|resume'),
    eventAt(0, 'audio_interrupt', 'begin|a1')
  ]
  const analytics = createAnalytics(fakeDeps(events))
  const overview = await analytics.overview(Date.now())
  assert.equal(overview.today.interrupts, 2)
  assert.equal(overview.trend[13].interrupts, 2)
  assert.ok(overview.week.interrupts >= 2)
})

test('dayKey 按东八区归日', () => {
  const noon = Date.parse('2026-10-19T12:00:00+08:00')
  assert.equal(dayKey(noon), '2026-10-19')
})
