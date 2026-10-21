const T = require('./time')
const F = require('./format')

const CYCLE = T.CYCLE_MIN
const CYCLES = [5, 4, 3]

function dayLabel(timestamp, now) {
  const diff = Math.round((T.startOfDay(timestamp) - T.startOfDay(now)) / T.DAY_MS)
  if (diff === 0) return '今天'
  if (diff === 1) return '明天'
  if (diff === -1) return '昨天'
  const date = new Date(timestamp)
  return date.getMonth() + 1 + '月' + date.getDate() + '日'
}

/** 下一次该起床时刻：留出入睡耗时后仍来不及，就顺延到明天 */
function nextWakeAt(now, wakeMinutes, fallMinutes) {
  let wakeAt = T.clockTs(T.startOfDay(now), wakeMinutes)
  if (wakeAt - fallMinutes * T.MINUTE_MS <= now) wakeAt += T.DAY_MS
  return wakeAt
}

/**
 * 起床选择的上下文：今天/明天 + 时段词 + 24 小时制。
 * 12 小时制的“下午 11:26 / 上午 12:26”在中文里既不合习惯也容易和中午混淆；
 * 统一用“晚上 23:26 / 凌晨 00:26”，与结果面时段词保持一致。
 */
function wakeContextText(now, wakeMinutes, fallMinutes) {
  const wakeAt = nextWakeAt(now, wakeMinutes, fallMinutes)
  return (
    dayLabel(wakeAt, now) +
    ' ' +
    F.periodLabel(wakeAt) +
    ' ' +
    F.fmtClock(wakeMinutes) +
    ' 起床'
  )
}

/**
 * 给定起床时间，倒推 3 个入睡时刻（5/4/3 个周期）。
 * 目标起床时间取“下一次”该时刻；若连 3 个周期都来不及，slots 会标记 passed。
 */
function bedtimesForWake(now, wakeMinutes, fallMinutes) {
  const wakeAt = nextWakeAt(now, wakeMinutes, fallMinutes)

  const slots = CYCLES.map((cycles) => {
    const at = wakeAt - (fallMinutes + cycles * CYCLE) * T.MINUTE_MS
    return {
      cycles,
      at,
      passed: at <= now,
      dayLabel: dayLabel(at, now),
      durationMin: cycles * CYCLE
    }
  })

  const availableMin = Math.max(0, Math.floor((wakeAt - now) / T.MINUTE_MS) - fallMinutes)

  return {
    wakeAt,
    wakeDayLabel: dayLabel(wakeAt, now),
    slots,
    allPassed: slots.every((slot) => slot.passed),
    availableMin,
    fallMinutes
  }
}

/**
 * 给定上床时间，计算 5/4/3 个周期后的起床时间。
 * 选中的时间若已过去超过 30 分钟，按次日处理。
 */
function wakeTimesForSleep(now, sleepMinutes, fallMinutes) {
  let sleepAt = T.clockTs(T.startOfDay(now), sleepMinutes)
  if (sleepAt < now - 30 * T.MINUTE_MS) sleepAt += T.DAY_MS

  const slots = CYCLES.map((cycles) => {
    const at = sleepAt + (fallMinutes + cycles * CYCLE) * T.MINUTE_MS
    return {
      cycles,
      at,
      passed: false,
      dayLabel: dayLabel(at, now),
      durationMin: cycles * CYCLE
    }
  })

  return {
    sleepAt,
    sleepDayLabel: dayLabel(sleepAt, now),
    slots,
    allPassed: false,
    fallMinutes
  }
}

module.exports = {
  CYCLE,
  CYCLES,
  dayLabel,
  nextWakeAt,
  wakeContextText,
  bedtimesForWake,
  wakeTimesForSleep
}
