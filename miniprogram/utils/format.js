const T = require('./time')

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

function fmtClock(minutes) {
  const m = T.wrapMinutes(minutes)
  return T.pad2(Math.floor(m / 60)) + ':' + T.pad2(m % 60)
}

function fmtClockTs(timestamp) {
  return fmtClock(T.minutesOf(timestamp))
}

/** 时段名称：比“今天/明天”更适合跨午夜的睡眠时间展示 */
function periodLabel(timestamp) {
  const hour = new Date(timestamp).getHours()
  if (hour < 5) return '凌晨'
  if (hour < 9) return '早晨'
  if (hour < 12) return '上午'
  if (hour < 14) return '中午'
  if (hour < 18) return '下午'
  if (hour < 20) return '傍晚'
  return '晚上'
}

/**
 * 文案分支用的四段时段（设备本地时区，不写死任何“夜间”假设）：
 * morning 5–11 / day 11–18 / evening 18–23 / late 23–5。
 * 只用于“此刻”的问候与页脚；描述睡眠本身（入睡/起床/这一段）的文案必须中性，
 * 不能按此刻时段改写，否则白天小睡会被说成“今晚”。
 */
function daypartOf(timestamp) {
  const hour = new Date(timestamp).getHours()
  if (hour >= 5 && hour < 11) return 'morning'
  if (hour >= 11 && hour < 18) return 'day'
  if (hour >= 18 && hour < 23) return 'evening'
  return 'late'
}

function fmtDuration(minutes) {
  const total = Math.max(0, Math.round(minutes))
  if (total < 60) return total + ' 分钟'
  return Math.floor(total / 60) + ' 小时 ' + T.pad2(total % 60) + ' 分'
}

function fmtHours(minutes) {
  return (Math.round(minutes / 6) / 10).toFixed(1) + ' 小时'
}

/**
 * 日历格内紧凑时长：6h05 / 45m；无记录返回空串。
 * 必须与详情卡「共 6 小时 05 分」同源：旧的 0.1 小时取整会把 365 分钟显示成 6.1h，
 * 用户点开看到 6 小时 05 分，会以为日历和详情是两个不同的数。
 */
function fmtHoursShort(minutes) {
  const total = Math.max(0, Math.round(minutes || 0))
  if (!total) return ''
  if (total < 60) return total + 'm'
  return Math.floor(total / 60) + 'h' + T.pad2(total % 60)
}

function fmtDateCN(timestamp) {
  const d = new Date(timestamp)
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + WEEKDAYS[d.getDay()]
}

function fmtDayCN(dayKey) {
  const d = new Date(T.parseDateKey(dayKey))
  return (d.getMonth() + 1) + '月' + d.getDate() + '日'
}

function greeting(timestamp) {
  const hour = new Date(timestamp).getHours()
  if (hour >= 5 && hour < 11) return '早上好'
  if (hour >= 11 && hour < 13) return '中午好'
  if (hour >= 13 && hour < 18) return '下午好'
  if (hour >= 18 && hour < 23) return '晚上好'
  return '夜深了'
}

function signedMinutes(value) {
  const abs = Math.abs(value)
  if (abs < 60) return abs + ' 分钟'
  return Math.floor(abs / 60) + ' 小时 ' + T.pad2(abs % 60) + ' 分'
}

/**
 * 万位紧凑写法：12345 → '1.2'，98765 → '9.9'；不足 1 万返回 null（调用方用原数）。
 * 环境音收藏人数与背景使用次数共用同一套缩写口径。
 */
function compactWan(count) {
  const num = Math.floor(Number(count) || 0)
  if (num < 10000) return null
  return String(Math.round(num / 1000) / 10)
}

module.exports = {
  fmtClock,
  fmtClockTs,
  periodLabel,
  daypartOf,
  fmtDuration,
  fmtHours,
  fmtHoursShort,
  fmtDateCN,
  fmtDayCN,
  greeting,
  signedMinutes,
  compactWan
}
