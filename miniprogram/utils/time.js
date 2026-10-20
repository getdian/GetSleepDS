/**
 * 时间与周期计算，全部为纯函数，不依赖 wx，可在 Node 中直接单测。
 */

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const MINUTE_MS = 60 * 1000

const CYCLE_MIN = 90
// 睡眠日以"入睡时间往前推 12 小时"的日期为准
const SLEEP_DAY_SHIFT_MS = 12 * HOUR_MS

function pad2(value) {
  return value < 10 ? '0' + value : String(value)
}

function wrapMinutes(value) {
  const m = Math.round(value) % 1440
  return m < 0 ? m + 1440 : m
}

function dateKey(timestamp) {
  const d = new Date(timestamp)
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}

function parseDateKey(key) {
  const parts = String(key).split('-')
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 一条睡眠记录归属的日期 */
function sleepDayOf(timestamp) {
  return dateKey(timestamp - SLEEP_DAY_SHIFT_MS)
}

function startOfDay(timestamp) {
  const d = new Date(timestamp)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function addDays(timestamp, days) {
  const d = new Date(timestamp)
  d.setDate(d.getDate() + days)
  return d.getTime()
}

/** 周一 00:00 */
function startOfWeek(timestamp) {
  const d = new Date(startOfDay(timestamp))
  const offset = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - offset)
  return d.getTime()
}

function minutesOf(timestamp) {
  const d = new Date(timestamp)
  return d.getHours() * 60 + d.getMinutes()
}

function parseClock(clock) {
  const parts = String(clock || '00:00').split(':')
  const h = Number(parts[0]) || 0
  const m = Number(parts[1]) || 0
  return h * 60 + m
}

/** 某天的第 N 分钟对应的时间戳，minutes 可以越界（自动跨天） */
function clockTs(dayTimestamp, minutes) {
  return startOfDay(dayTimestamp) + minutes * MINUTE_MS
}

/**
 * 圆均值：23:50 与 00:10 的平均应是 00:00，而不是 12:00。
 * 返回分钟数（0-1439），无数据返回 null。
 */
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

/** 把 scroll-top 吸附到最近的循环行；返回 3 周期内的 raw 与单周期 index */
function snapWheelTop(top, rowH, count) {
  const rows = Math.max(1, Number(count) || 1)
  const height = Number(rowH) || 1
  const raw = Math.max(0, Math.min(rows * 3 - 1, Math.round((Number(top) || 0) / height)))
  return { raw, index: raw % rows }
}

/** a 相对 b 的有符号分钟差，范围 (-720, 720]，正值表示更晚 */
function clockDelta(a, b) {
  let diff = wrapMinutes(a - b)
  if (diff > 720) diff -= 1440
  return diff
}

module.exports = {
  DAY_MS,
  MINUTE_MS,
  CYCLE_MIN,
  pad2,
  wrapMinutes,
  dateKey,
  parseDateKey,
  sleepDayOf,
  startOfDay,
  addDays,
  startOfWeek,
  minutesOf,
  parseClock,
  clockTs,
  circularMeanMinutes,
  clockDelta,
  snapWheelTop
}
