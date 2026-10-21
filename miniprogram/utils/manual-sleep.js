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

/** 日历可翻 / 补记可选的统一回溯范围（月）。统计页的月份翻页复用同一常量 */
const MONTH_LOOKBACK = 24

/** 补记日期选择器的最早可选日：MONTH_LOOKBACK 个月前的 1 号 */
function minDayKey(now) {
  const d = new Date(Number(now) || Date.now())
  return T.dateKey(new Date(d.getFullYear(), d.getMonth() - MONTH_LOOKBACK, 1).getTime())
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
  return ''
}

/**
 * 补记面板的完整校验：时间区间 + 跨天重叠。
 * records 由调用方传入（页面持有 storage.getRecords()），保持本模块可单测。
 */
function evaluateManualRange(options) {
  const opts = options || {}
  const range = X.rangeForDay(opts.dayTs, opts.bedMinutes, opts.wakeMinutes, opts.now)
  let code = range.error || ''
  if (!code && X.findOverlap(opts.records || {}, range.bedAt, range.wakeAt)) {
    code = 'overlap'
  }
  return {
    bedAt: range.bedAt,
    wakeAt: range.wakeAt,
    durationMin: range.durationMin,
    code,
    error: errorTextOf(code)
  }
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
  minDayKey,
  defaultTimesFor,
  errorTextOf,
  evaluateManualRange,
  buildSaveArgs
}
