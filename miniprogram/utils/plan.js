const T = require('./time')
const F = require('./format')

const CYCLE = T.CYCLE_MIN
// 主推荐只在这三档里选；6 个周期是「充足/补觉」附加档，永远不抢主推荐位
const CYCLES = [5, 4, 3]
const EXTRA_CYCLES = 6

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
 * 入睡选择的上下文：今天/明天 + 时段词 + 24 小时制。
 * 与 wakeTimesForSleep 共用 sleepAtOf，翻日规则（超 30 分钟宽限按次日）与结果面完全一致。
 */
function sleepContextText(now, sleepMinutes) {
  const sleepAt = sleepAtOf(now, sleepMinutes)
  return (
    dayLabel(sleepAt, now) +
    ' ' +
    F.periodLabel(sleepAt) +
    ' ' +
    F.fmtClock(sleepMinutes) +
    ' 入睡'
  )
}

/**
 * 给定起床时间，倒推 3 个入睡时刻（5/4/3 个周期）。
 * 目标起床时间取“下一次”该时刻；若连 3 个周期都来不及，slots 会标记 passed。
 * progressNow：只用于“是否已错过 / 还能睡多久”，让结果面的倒计时随真实时间走，
 * 而 wakeAt 仍以调用方的 now（结果面的锚点）为准，避免推荐时间整日漂移。
 */
function bedtimesForWake(now, wakeMinutes, fallMinutes, progressNow) {
  const wakeAt = nextWakeAt(now, wakeMinutes, fallMinutes)
  const progressAt = Number(progressNow) || now

  const makeSlot = (cycles, at) => ({
    cycles,
    at,
    passed: at <= progressAt,
    dayLabel: dayLabel(at, now),
    durationMin: cycles * CYCLE
  })
  const bedtimeOf = (cycles) => wakeAt - (fallMinutes + cycles * CYCLE) * T.MINUTE_MS

  const slots = CYCLES.map((cycles) => makeSlot(cycles, bedtimeOf(cycles)))
  // 附加档：多睡一个周期（9 小时），只作为“想补觉”的备选
  const extra = makeSlot(EXTRA_CYCLES, bedtimeOf(EXTRA_CYCLES))

  const availableMin = Math.max(
    0,
    Math.floor((wakeAt - progressAt) / T.MINUTE_MS) - fallMinutes
  )

  return {
    wakeAt,
    wakeDayLabel: dayLabel(wakeAt, now),
    slots,
    extra,
    allPassed: slots.every((slot) => slot.passed),
    availableMin,
    fallMinutes
  }
}

/**
 * 选中的入睡时刻：取当天该时刻；已过去超过 30 分钟按次日处理。
 * 时间轮下的上下文与结果面共用此函数，避免“提示写今天、结果算明天”。
 */
function sleepAtOf(now, sleepMinutes) {
  const sleepAt = T.clockTs(T.startOfDay(now), sleepMinutes)
  return sleepAt < now - 30 * T.MINUTE_MS ? sleepAt + T.DAY_MS : sleepAt
}

/** 给定上床时间，计算 5/4/3 个周期后的起床时间。 */
function wakeTimesForSleep(now, sleepMinutes, fallMinutes) {
  const sleepAt = sleepAtOf(now, sleepMinutes)

  const makeSlot = (cycles, at) => ({
    cycles,
    at,
    passed: false,
    dayLabel: dayLabel(at, now),
    durationMin: cycles * CYCLE
  })
  const wakeAtOf = (cycles) => sleepAt + (fallMinutes + cycles * CYCLE) * T.MINUTE_MS

  const slots = CYCLES.map((cycles) => makeSlot(cycles, wakeAtOf(cycles)))
  // 附加档：多睡一个周期（9 小时），只作为“想补觉”的备选
  const extra = makeSlot(EXTRA_CYCLES, wakeAtOf(EXTRA_CYCLES))

  return {
    sleepAt,
    sleepDayLabel: dayLabel(sleepAt, now),
    slots,
    extra,
    allPassed: false,
    fallMinutes
  }
}

module.exports = {
  CYCLE,
  CYCLES,
  EXTRA_CYCLES,
  dayLabel,
  nextWakeAt,
  wakeContextText,
  sleepContextText,
  sleepAtOf,
  bedtimesForWake,
  wakeTimesForSleep
}
