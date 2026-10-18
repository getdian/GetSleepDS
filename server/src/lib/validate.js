const { invalidBody, payloadTooLarge } = require('./errors')
const { sleepDayOf } = require('./time')

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MAX_RECORDS = 62
const MAX_SLEEP_MS = 20 * 60 * 60 * 1000

/**
 * 校验并归一化打卡记录。
 * 只信任时间戳，day 与时长由服务端重算，避免前端脏数据污染统计。
 */
function validateRecords(input) {
  if (!Array.isArray(input)) throw invalidBody('records 必须是数组')
  if (input.length > MAX_RECORDS) throw payloadTooLarge('记录最多 ' + MAX_RECORDS + ' 条')

  const normalized = []

  for (let i = 0; i < input.length; i += 1) {
    const item = input[i]
    if (!item || typeof item !== 'object') throw invalidBody('第 ' + (i + 1) + ' 条记录格式错误')

    const bedAt = Number(item.bedAt)
    const wakeAt = Number(item.wakeAt)
    if (!Number.isFinite(bedAt) || !Number.isFinite(wakeAt)) {
      throw invalidBody('第 ' + (i + 1) + ' 条记录缺少时间戳')
    }
    if (wakeAt <= bedAt) throw invalidBody('第 ' + (i + 1) + ' 条记录起床时间早于入睡时间')
    if (wakeAt - bedAt > MAX_SLEEP_MS) throw invalidBody('第 ' + (i + 1) + ' 条记录时长异常')

    if (!item.day || !DAY_PATTERN.test(item.day)) {
      throw invalidBody('第 ' + (i + 1) + ' 条记录日期格式错误')
    }

    const expected = sleepDayOf(bedAt)
    if (expected !== item.day) {
      throw invalidBody('第 ' + (i + 1) + ' 条记录日期不匹配（应为 ' + expected + '）')
    }

    normalized.push({
      day: item.day,
      bedAt,
      wakeAt,
      durationMin: Math.round((wakeAt - bedAt) / 60000),
      updatedAt: Number(item.updatedAt) || wakeAt
    })
  }

  // 同一天只保留最新的一条
  const byDay = new Map()
  normalized.forEach((record) => {
    const previous = byDay.get(record.day)
    if (!previous || record.updatedAt >= previous.updatedAt) byDay.set(record.day, record)
  })

  return Array.from(byDay.values())
}

module.exports = { validateRecords, MAX_RECORDS }
