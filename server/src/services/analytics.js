const DAY_MS = 24 * 60 * 60 * 1000
const BEIJING_OFFSET = 8 * 60 * 60 * 1000

function dayKey(timestamp) {
  return new Date(timestamp + BEIJING_OFFSET).toISOString().slice(0, 10)
}

function emptyBucket(day) {
  return { day, opens: new Set(), checkins: 0, plays: 0, unlocks: 0 }
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
    const weekStart = dayKey(now - 6 * DAY_MS)

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
    const top = new Map()
    const sources = new Map()

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

      if (bucket.day >= weekStart) {
        if (event.type === 'app_open') weekOpens.add(event.openid)
        if (event.type === 'checkin') weekCheckins += 1
        if (event.type === 'audio_play') weekPlays += 1
        if (event.type === 'audio_unlock') weekUnlocks += 1
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

    return {
      totals: Object.assign({}, totals, {
        users: Math.max(totals.users || 0, checkinUsers.size)
      }),
      today: {
        opens: todayBucket.opens.size,
        checkins: todayBucket.checkins,
        plays: todayBucket.plays,
        unlocks: todayBucket.unlocks
      },
      week: {
        opens: weekOpens.size,
        checkins: weekCheckins,
        plays: weekPlays,
        unlocks: weekUnlocks
      },
      trend: Array.from(days.values()).map((bucket) => ({
        day: bucket.day,
        opens: bucket.opens.size,
        checkins: bucket.checkins,
        plays: bucket.plays
      })),
      topTracks,
      topSources
    }
  }

  return { overview }
}

module.exports = { createAnalytics, dayKey }
