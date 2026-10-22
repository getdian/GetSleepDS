/**
 * 服务端一律按东八区处理（产品只面向国内）。
 * 中国无夏令时，直接做固定偏移即可，不依赖服务器时区。
 */

const DAY_MS = 24 * 60 * 60 * 1000
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000
// 睡眠日 = 入睡时间往前推 12 小时，等价于 UTC 时间再减 4 小时
const SLEEP_DAY_SHIFT_MS = 4 * 60 * 60 * 1000

function pad2(value) {
  return value < 10 ? '0' + value : String(value)
}

function sleepDayOf(timestamp) {
  return new Date(timestamp - SLEEP_DAY_SHIFT_MS).toISOString().slice(0, 10)
}

/** 指定时区（分钟，东为正）的日历日；不传时区时等价于 calendarDayOf */
function dayKeyOf(timestamp, tzOffsetMin) {
  // 兼容历史调用：addDaysKey 传的是 Date 对象，直接取其 UTC 日期
  if (timestamp instanceof Date) return timestamp.toISOString().slice(0, 10)
  const offset = Number.isFinite(Number(tzOffsetMin)) ? Number(tzOffsetMin) : 480
  return new Date(Number(timestamp) + offset * 60 * 1000).toISOString().slice(0, 10)
}

/** 北京时间日历日（用于“本周”这类自然周边界，不等同于睡眠日） */
function calendarDayOf(timestamp) {
  return new Date(timestamp + BEIJING_OFFSET_MS).toISOString().slice(0, 10)
}

function minutesOf(timestamp) {
  const d = new Date(timestamp + BEIJING_OFFSET_MS)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}

function formatClock(minutes) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440
  return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60)
}

function wrapMinutes(value) {
  const m = Math.round(value) % 1440
  return m < 0 ? m + 1440 : m
}

function circularMeanMinutes(values) {
  if (!values || !values.length) return null
  let sin = 0
  let cos = 0
  for (let i = 0; i < values.length; i += 1) {
    const angle = (wrapMinutes(values[i]) / 1440) * Math.PI * 2
    sin += Math.sin(angle)
    cos += Math.cos(angle)
  }
  if (Math.abs(sin) < 1e-9 && Math.abs(cos) < 1e-9) return null
  let deg = (Math.atan2(sin, cos) * 180) / Math.PI
  if (deg < 0) deg += 360
  return Math.round((deg * 1440) / 360) % 1440
}

function clockDelta(a, b) {
  let diff = wrapMinutes(a - b)
  if (diff > 720) diff -= 1440
  return diff
}

function parseDayKey(key) {
  const parts = String(key).split('-')
  return new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])))
}

function addDaysKey(key, days) {
  const d = parseDayKey(key)
  d.setUTCDate(d.getUTCDate() + days)
  return dayKeyOf(d)
}

function weekdayOf(key) {
  return parseDayKey(key).getUTCDay()
}

/** 周一对齐的周一日期 */
function weekStartKey(key) {
  const dow = weekdayOf(key)
  return addDaysKey(key, -((dow + 6) % 7))
}

module.exports = {
  DAY_MS,
  pad2,
  sleepDayOf,
  dayKeyOf,
  calendarDayOf,
  minutesOf,
  formatClock,
  wrapMinutes,
  circularMeanMinutes,
  clockDelta,
  parseDayKey,
  dayKeyOf,
  addDaysKey,
  weekdayOf,
  weekStartKey
}
