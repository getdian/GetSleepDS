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

/** a 相对 b 的有符号分钟差，范围 (-720, 720]，正值表示更晚 */
function clockDelta(a, b) {
  let diff = wrapMinutes(a - b)
  if (diff > 720) diff -= 1440
  return diff
}

/**
 * 计算三个推荐入睡时刻 + 现在睡方案。
 *
 * @param {number} now 当前时间戳
 * @param {number} wakeMinutes 起床时刻（0-1439）
 * @param {number} fallAsleepMin 入睡耗时（分钟）
 * @param {number[]} cyclesList 周期数，默认 5/4/3
 */
function buildPlan(now, wakeMinutes, fallAsleepMin, cyclesList) {
  const cycles = cyclesList || [5, 4, 3]
  const today = startOfDay(now)
  const buffer = fallAsleepMin * MINUTE_MS

  let nowWake = clockTs(today, wakeMinutes)
  if (nowWake - buffer <= now) nowWake += DAY_MS

  const toSlots = (wakeTs) => cycles.map((count) => {
    const sleepMin = count * CYCLE_MIN
    const at = wakeTs - buffer - sleepMin * MINUTE_MS
    return {
      cycles: count,
      sleepMin,
      at,
      passed: at <= now
    }
  })

  let slotWake = nowWake
  let slots = toSlots(slotWake)
  let rolled = false

  if (slots.every((slot) => slot.passed)) {
    rolled = true
    slotWake = nowWake + DAY_MS
    slots = toSlots(slotWake).map((slot) => Object.assign({}, slot, { passed: false }))
  }

  const availableMin = Math.max(0, Math.floor((nowWake - now) / MINUTE_MS) - fallAsleepMin)
  const fullCycles = Math.floor(availableMin / CYCLE_MIN)
  const remainder = availableMin - fullCycles * CYCLE_MIN

  return {
    nowWakeAt: nowWake,
    slotWakeAt: slotWake,
    rolled,
    slots,
    availableMin,
    cycles: fullCycles,
    remainder,
    cycleMin: CYCLE_MIN
  }
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
  buildPlan
}
