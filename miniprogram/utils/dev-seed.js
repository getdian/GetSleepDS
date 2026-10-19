/**
 * 开发版专用：生成"真实感"的模拟睡眠记录，用于评估热力图/统计展示。
 * 特点：深浅不一（工作日 7h±1h、周末 8.5h±1.2h、偶发熬夜 ~5h / 补觉 ~10h）、
 * 约 1/6 的日子漏打卡、固定随机种子保证可复现。
 * 仅在开发者工具 console 调用（app.js 只在 envVersion=develop 时挂载）：
 *   getApp().seedDemo()     // 近 120 天
 *   getApp().seedDemo(60)   // 近 60 天
 * 不进任何页面逻辑；体验版/正式版不存在该入口。
 */
const T = require('./time')
const storage = require('./storage')

const SEED = 20261019

/** 可复现伪随机（mulberry32） */
function mulberry32(seed) {
  let a = (seed || SEED) >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 三次均匀采样取平均，近似集中在 0.5 的钟形分布 */
function bell(rand) {
  return (rand() + rand() + rand()) / 3
}

/**
 * 生成模拟记录。now 为当前时间戳，days 为回看天数。
 * 纯函数（不碰 storage / wx），可直接单测。
 */
function buildRealisticRecords(now, days, rand) {
  rand = rand || mulberry32(SEED)
  const out = {}
  const end = T.startOfDay(now)
  const span = days || 120

  for (let i = span - 1; i >= 0; i -= 1) {
    const ts = T.addDays(end, -i)
    const day = T.dateKey(ts)
    const dow = new Date(ts).getDay()
    const lateNight = dow === 6 || dow === 0 // 周五/周六晚睡
    const sleepIn = dow === 0 || dow === 6   // 周六/周日赖床

    // 漏打卡：工作日约 13%，周末约 22%
    if (rand() < (lateNight || sleepIn ? 0.22 : 0.13)) continue

    // 入睡时刻：相对当天 0 点的分钟数；≥18h 保证映射到这个睡眠日，
    // 跨过 24h 自然落到次日凌晨（sleepDayOf 会归到同一天）
    let bedMin
    const roll = rand()
    if (roll < 0.05) {
      bedMin = 22 * 60 + Math.floor(rand() * 60)               // 偶发早睡 22 点档
    } else if (lateNight) {
      bedMin = 24 * 60 + 20 + Math.floor(bell(rand) * 90)      // 00:20~01:50
    } else {
      bedMin = 23 * 60 + Math.floor((bell(rand) - 0.5) * 120)  // 22:30~00:30
    }
    bedMin = Math.max(18 * 60, Math.min(26 * 60, bedMin))

    // 时长：工作日 7h±1h，周末 8.5h±1.2h；偶发熬夜 ~5h / 补觉 ~10h
    let durationMin
    const mood = rand()
    if (mood < 0.05) {
      durationMin = 280 + Math.floor(rand() * 60)
    } else if (mood > 0.96) {
      durationMin = 570 + Math.floor(rand() * 60)
    } else if (sleepIn) {
      durationMin = 510 + Math.floor((bell(rand) - 0.5) * 150)
    } else {
      durationMin = 420 + Math.floor((bell(rand) - 0.5) * 130)
    }
    durationMin = Math.max(240, Math.min(660, durationMin))

    const bedAt = ts + bedMin * 60000
    const wakeAt = bedAt + durationMin * 60000
    out[day] = {
      day,
      bedAt,
      wakeAt,
      durationMin,
      updatedAt: bedAt
    }
  }
  return out
}

/**
 * 用模拟数据整体替换本机记录，并给被移除的旧日子写墓碑，
 * 防止下次同步时被云端旧数据（如之前的等长块）按 LWW 回填。
 * 返回写入的记录条数。
 */
function seedRealistic(days) {
  const records = buildRealisticRecords(Date.now(), days || 120)
  const old = storage.getRecords()
  Object.keys(old).forEach((day) => {
    if (!records[day]) storage.markDeleted(day)
  })
  storage.replaceRecords(records)
  return Object.keys(records).length
}

module.exports = { buildRealisticRecords, seedRealistic, mulberry32, SEED }
