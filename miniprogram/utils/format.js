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

function fmtDuration(minutes) {
  const total = Math.max(0, Math.round(minutes))
  if (total < 60) return total + ' 分钟'
  return Math.floor(total / 60) + ' 小时 ' + T.pad2(total % 60) + ' 分'
}

function fmtHours(minutes) {
  return (Math.round(minutes / 6) / 10).toFixed(1) + ' 小时'
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

module.exports = {
  fmtClock,
  fmtClockTs,
  periodLabel,
  fmtDuration,
  fmtHours,
  fmtDateCN,
  fmtDayCN,
  greeting,
  signedMinutes
}
