/**
 * 睡眠规律性：只看最近 N 天的入睡/起床时刻波动，不做睡眠质量评价。
 * 用圆周均值处理 23:50 与 00:10 的跨午夜差值。
 */
const T = require('./time')

function spreadOf(values, mean) {
  if (mean === null || !values.length) return null
  let total = 0
  values.forEach((value) => {
    total += Math.abs(T.clockDelta(value, mean))
  })
  return Math.round(total / values.length)
}

function durationOf(record) {
  if (record.nightDurationMin) return record.nightDurationMin
  if (record.durationMin) return record.durationMin
  return Math.round((record.wakeAt - record.bedAt) / T.MINUTE_MS)
}

function analyze(records, now, days) {
  const span = days || 7
  const source = records || {}
  const list = []
  for (let i = span - 1; i >= 0; i -= 1) {
    const key = T.dateKey(T.addDays(now, -i))
    const record = source[key]
    if (record && record.bedAt && record.wakeAt && record.wakeAt > record.bedAt) {
      list.push(record)
    }
  }
  if (list.length < 4) {
    return { enough: false, count: list.length, span }
  }

  const beds = list.map((record) => T.minutesOf(record.bedAt))
  const wakes = list.map((record) => T.minutesOf(record.wakeAt))
  const bedMean = T.circularMeanMinutes(beds)
  const wakeMean = T.circularMeanMinutes(wakes)
  const bedSpread = spreadOf(beds, bedMean)
  const wakeSpread = spreadOf(wakes, wakeMean)
  const maxSpread = Math.max(bedSpread || 0, wakeSpread || 0)
  let label = '较规律'
  if (maxSpread > 60) label = '波动较大'
  else if (maxSpread > 30) label = '略有波动'

  return {
    enough: true,
    count: list.length,
    span,
    bedMeanMin: bedMean,
    wakeMeanMin: wakeMean,
    bedSpreadMin: bedSpread,
    wakeSpreadMin: wakeSpread,
    avgDurationMin: Math.round(
      list.reduce((sum, record) => sum + durationOf(record), 0) / list.length
    ),
    label
  }
}

module.exports = { analyze }
