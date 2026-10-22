/**
 * 「补记一段睡眠」的共享编排（纯函数，不读写 storage）。
 *
 * 为什么有这个模块：入睡页与统计页各有一块补记面板，UI 可以各自持有，
 * 但默认时间、错误文案与保存入参必须单源——否则改一处文案/降级逻辑就会漂移，
 * 而两页的补记入口是同一个产品语义（"这段睡眠我忘了记"）。
 *
 * 职责边界：
 * - 本模块只做「算出区间 / 给出错误文案 / 拼保存参数」；
 * - 真正落库仍由页面调用 storage.saveSession（需要页面刷新与同步编排）；
 * - 区间合法性的唯一真源仍是 sessions.rangeForDay / findOverlap。
 */
const T = require('./time')
const X = require('./sessions')

/** 日历可翻看的历史范围（月）。统计页的月份翻页复用同一常量 */
const MONTH_LOOKBACK = 24

/**
 * 可补记窗口（天）：必须与 utils/sync.js 的 SPAN_DAYS 一致。
 * 同步只上传最近 400 天（服务端 validate.inWindow 同边界），窗口外的补记
 * 会变成"只存本机、永远不上云、换机即丢"的静默丢失——所以补记下限对齐它，
 * 而不是对齐日历的 24 个月可翻范围。改动任一侧必须同步另一侧。
 */
const EDIT_WINDOW_DAYS = 400

/** 一天最多的睡眠段数 / 当天总时长上限：与 storage.saveSession 的落库限制保持一致 */
const MAX_SESSIONS_PER_DAY = 8
const MAX_DAY_MINUTES = 24 * 60

/**
 * 补记日期选择器的最早可选日（醒来日下限）。
 * 取 now-399 天：醒来日再早一天时，跨午夜补记的 bedAt 就会越出同步窗口
 * （最坏 bedAt = 醒来日前一天 00:00，now - bedAt = 401 天 > 400 天）。
 */
function minDayKey(now) {
  const ts = Number(now) || Date.now()
  return T.dateKey(T.addDays(T.startOfDay(ts), -(EDIT_WINDOW_DAYS - 1)))
}

/**
 * 空格子的补记入口按窗口收口：canAdd 为 true 但早于 minDay 的格子改为 false。
 * 直接修改传入的 cells（页面在 setData 前调用），返回同一引用便于链式。
 */
function limitCanAdd(cells, minDay) {
  const list = Array.isArray(cells) ? cells : []
  list.forEach((cell) => {
    if (cell && cell.canAdd && cell.day && cell.day < minDay) cell.canAdd = false
  })
  return list
}

/**
 * 补记面板的默认时间。
 * - preset（默认）：按「醒来日」补一段整夜 23:00 → 07:00；当天把起床压到 now-10min，
 *   避免默认值直接落在未来。
 * - preset:false：入睡页「补记入睡」的"刚发生的小睡"，30 分钟前 → 现在。
 */
function defaultTimesFor(dayKey, now, options) {
  const opts = options || {}
  const ts = Number(now) || Date.now()
  const todayKey = T.dateKey(ts)
  const d = new Date(ts)
  const nowMinutes = d.getHours() * 60 + d.getMinutes()

  if (opts.preset === false) {
    let bedMinutes = nowMinutes - 30
    if (bedMinutes < 0) bedMinutes += 24 * 60
    return { bedMinutes, wakeMinutes: nowMinutes }
  }

  let bedMinutes = 23 * 60
  let wakeMinutes = 7 * 60
  if (dayKey === todayKey) {
    // 至少留 1 分钟，避免 now < 10 分钟时出现负数或 0 时长
    wakeMinutes = Math.max(1, Math.min(wakeMinutes, nowMinutes - 10))
  }
  return { bedMinutes, wakeMinutes }
}

/**
 * 五类区间错误 + 重叠的统一文案。
 * 入睡页（范围/结束/编辑）与统计页（页内补记）都从这里取，禁止各自写 if 链。
 */
function errorTextOf(code) {
  if (code === 'future') return '起床时间不能晚于现在'
  if (code === 'short') return '睡眠时长至少 1 分钟'
  if (code === 'order') return '入睡时间需早于起床时间，请检查醒来日'
  if (code === 'long') return '单段睡眠不能超过 24 小时'
  if (code === 'overlap') return '与已有睡眠段重叠，请调整时间'
  if (code === 'pending') return '与你正在进行的睡眠重叠，请先结束计时或调整时间'
  if (code === 'toomany') return '当天最多记录 8 段，请先删除其中一段'
  if (code === 'dayfull') return '当天总睡眠不能超过 24 小时，请调整时间'
  return ''
}

/**
 * 补记面板的完整校验：时间区间 + 跨天重叠 + 进行中的睡眠。
 * records 由调用方传入（页面持有 storage.getRecords()），保持本模块可单测。
 * pending 不在 records 里（它是独立的 storage key），不一起比对会出现
 * “补记一段与正在计时的那段相交、保存成功，之后结束计时反被这段挡住”的死结。
 */
function evaluateManualRange(options) {
  const opts = options || {}
  const range = X.rangeForDay(opts.dayTs, opts.bedMinutes, opts.wakeMinutes, opts.now)
  let code = range.error || ''
  if (!code && X.findOverlap(opts.records || {}, range.bedAt, range.wakeAt)) {
    code = 'overlap'
  }
  if (!code && pendingOverlaps(opts.pending, range, opts.now)) {
    code = 'pending'
  }
  if (!code) {
    code = capacityErrorOf({
      records: opts.records,
      // 归档日固定北京时间：与 storage.saveSession 写入的 day 同口径
      dayKey: T.calendarDayKey(range.wakeAt),
      durationMin: range.durationMin
    })
  }
  return {
    bedAt: range.bedAt,
    wakeAt: range.wakeAt,
    durationMin: range.durationMin,
    code,
    error: errorTextOf(code)
  }
}

/**
 * 保存前的容量预检：当天段数上限 + 当天总时长上限。
 *
 * storage.saveSession 对超限是静默返回 false，页面只能提示“写入失败/请重试”，
 * 用户没有任何可行动出口。提前给出原因，避免在结束面板里反复重试。
 * excludeId 用于编辑：先扣掉旧段再判断。
 */
function capacityErrorOf(options) {
  const opts = options || {}
  const records = opts.records || {}
  const dayKey = opts.dayKey || ''
  const record = dayKey ? records[dayKey] : null
  const list = X.sessionsOf(record)
  const excludeId = opts.excludeId ? String(opts.excludeId) : ''
  const kept = excludeId ? list.filter((item) => item.id !== excludeId) : list
  const durationMin = Math.max(0, Number(opts.durationMin) || 0)
  if (!excludeId && kept.length >= MAX_SESSIONS_PER_DAY) return 'toomany'
  if (X.totalDurationOf(kept) + durationMin > MAX_DAY_MINUTES) return 'dayfull'
  return ''
}

/** 进行中的那段按「打卡时刻 → 现在」估算，只用于重叠判断，不落库 */
function pendingOverlaps(pending, range, now) {
  if (!pending || typeof pending !== 'object') return false
  const startAt = Number(pending.bedAt)
  if (!Number.isFinite(startAt)) return false
  const endAt = Number(now) || Date.now()
  if (endAt <= startAt) return false
  return X.overlaps({ startAt, endAt }, { startAt: range.bedAt, endAt: range.wakeAt })
}

/** storage.saveSession 的补记入参（id 带时间戳，source 固定 manual） */
function buildSaveArgs(bedAt, wakeAt, now) {
  const ts = Number(now) || Date.now()
  return {
    id: 'manual-' + ts,
    startAt: bedAt,
    endAt: wakeAt,
    durationMin: Math.round((wakeAt - bedAt) / 60000),
    source: 'manual',
    editedAt: ts
  }
}

module.exports = {
  MONTH_LOOKBACK,
  EDIT_WINDOW_DAYS,
  MAX_SESSIONS_PER_DAY,
  MAX_DAY_MINUTES,
  minDayKey,
  limitCanAdd,
  defaultTimesFor,
  errorTextOf,
  evaluateManualRange,
  capacityErrorOf,
  buildSaveArgs
}
