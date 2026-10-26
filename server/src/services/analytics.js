const DAY_MS = 24 * 60 * 60 * 1000
const BEIJING_OFFSET = 8 * 60 * 60 * 1000
const { weekStartKey } = require('../lib/time')

function dayKey(timestamp) {
  return new Date(timestamp + BEIJING_OFFSET).toISOString().slice(0, 10)
}

function emptyBucket(day) {
  return {
    day,
    opens: new Set(),
    checkins: 0,
    plays: 0,
    unlocks: 0,
    adShows: 0,
    adErrors: 0,
    // 外部中断次数：只统计 begin（end 只是时长与恢复结果，不计频次）
    interrupts: 0,
    // 补记次数：只打卡不补记 vs 高补记率，是判断“打卡闭环是否成立”的关键信号
    manualSleeps: 0,
    // 分享次数：分享 → 打开 → 首次打卡 漏斗的第一段，没有它无法判断增长动作是否有效
    shares: 0
  }
}

/**
 * 只统计客户端上报的轻量事件，不碰用户睡眠明细。
 */
function createAnalytics(options) {
  const db = options.db
  const store = options.store

  async function overview(now) {
    const today = dayKey(now)
    const todayStart = Date.parse(today + 'T00:00:00+08:00')
    const start = todayStart - 13 * DAY_MS
    // 与产品“本周”一致：北京时间周一 00:00 起，而不是滚动 7 天
    const weekStart = weekStartKey(today)

    const [events, totals, current] = await Promise.all([
      db.listEvents(start),
      db.adminStats(now),
      store.get()
    ])

    const days = new Map()
    for (let i = 0; i < 14; i += 1) {
      const key = dayKey(start + i * DAY_MS)
      days.set(key, emptyBucket(key))
    }

    const weekOpens = new Set()
    const checkinUsers = new Set()
    let weekCheckins = 0
    let weekPlays = 0
    let weekUnlocks = 0
    let weekAdShows = 0
    let weekAdErrors = 0
    let weekInterrupts = 0
    let weekManualSleeps = 0
    let weekShares = 0
    const top = new Map()
    const sources = new Map()
    const adSlots = new Map()

    events.forEach((event) => {
      const bucket = days.get(dayKey(event.ts))
      if (!bucket) return

      if (event.type === 'checkin') checkinUsers.add(event.openid)

      if (event.type === 'app_open') {
        bucket.opens.add(event.openid)
        // 启动来源：target = "scene|path|from"（历史空值归 unknown）
        const sourceKey = event.target || 'unknown'
        sources.set(sourceKey, (sources.get(sourceKey) || 0) + 1)
      }
      if (event.type === 'checkin') bucket.checkins += 1
      if (event.type === 'audio_play') {
        bucket.plays += 1
        const key = event.target || 'unknown'
        top.set(key, (top.get(key) || 0) + 1)
      }
      if (event.type === 'audio_unlock') bucket.unlocks += 1
      if (event.type === 'audio_interrupt' && String(event.target || '').indexOf('begin') === 0) {
        bucket.interrupts += 1
      }
      if (event.type === 'manual_sleep') bucket.manualSleeps += 1
      if (event.type === 'share') bucket.shares += 1

      if (event.type === 'ad_show' || event.type === 'ad_error') {
        const key = event.target || 'unknown'
        const slot = adSlots.get(key) || { slot: key, shows: 0, errors: 0 }
        if (event.type === 'ad_show') {
          bucket.adShows += 1
          slot.shows += 1
        } else {
          bucket.adErrors += 1
          slot.errors += 1
        }
        adSlots.set(key, slot)
      }

      if (bucket.day >= weekStart) {
        if (event.type === 'app_open') weekOpens.add(event.openid)
        if (event.type === 'checkin') weekCheckins += 1
        if (event.type === 'audio_play') weekPlays += 1
        if (event.type === 'audio_unlock') weekUnlocks += 1
        if (event.type === 'audio_interrupt' && String(event.target || '').indexOf('begin') === 0) {
          weekInterrupts += 1
        }
        if (event.type === 'ad_show') weekAdShows += 1
        if (event.type === 'ad_error') weekAdErrors += 1
        if (event.type === 'manual_sleep') weekManualSleeps += 1
        if (event.type === 'share') weekShares += 1
      }
    })

    const todayBucket = days.get(today) || emptyBucket(today)
    const audio = (current.config && current.config.audio) || []

    const topTracks = Array.from(top.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map((entry) => {
        const match = audio.filter((item) => item.id === entry[0])[0]
        return { id: entry[0], title: match ? match.title : entry[0], plays: entry[1] }
      })

    const topSources = Array.from(sources.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map((entry) => ({ source: entry[0], opens: entry[1] }))

    const adBySlot = Array.from(adSlots.values()).sort((a, b) => {
      return b.shows + b.errors - (a.shows + a.errors)
    })
    const adShows = adBySlot.reduce((sum, item) => sum + item.shows, 0)
    const adErrors = adBySlot.reduce((sum, item) => sum + item.errors, 0)

    return {
      totals: Object.assign({}, totals, {
        users: Math.max(totals.users || 0, checkinUsers.size)
      }),
      today: {
        opens: todayBucket.opens.size,
        checkins: todayBucket.checkins,
        plays: todayBucket.plays,
        unlocks: todayBucket.unlocks,
        adShows: todayBucket.adShows,
        adErrors: todayBucket.adErrors,
        interrupts: todayBucket.interrupts,
        manualSleeps: todayBucket.manualSleeps,
        shares: todayBucket.shares
      },
      week: {
        opens: weekOpens.size,
        checkins: weekCheckins,
        plays: weekPlays,
        unlocks: weekUnlocks,
        adShows: weekAdShows,
        adErrors: weekAdErrors,
        interrupts: weekInterrupts,
        manualSleeps: weekManualSleeps,
        shares: weekShares
      },
      ads: {
        todayShows: todayBucket.adShows,
        todayErrors: todayBucket.adErrors,
        weekShows: weekAdShows,
        weekErrors: weekAdErrors,
        shows: adShows,
        errors: adErrors,
        fillRate: adShows + adErrors ? Math.round((adShows / (adShows + adErrors)) * 100) : null,
        bySlot: adBySlot
      },
      trend: Array.from(days.values()).map((bucket) => ({
        day: bucket.day,
        opens: bucket.opens.size,
        checkins: bucket.checkins,
        plays: bucket.plays,
        interrupts: bucket.interrupts,
        shares: bucket.shares
      })),
      topTracks,
      topSources,
      // listEvents 在 memory/PG 两端都硬上限 20000；达到上限时趋势与 Top 榜可能偏低
      truncated: events.length >= 20000
    }
  }

  return { overview }
}

module.exports = { createAnalytics, dayKey }
