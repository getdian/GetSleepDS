/**
 * 睡眠时长提示：只做“成人 7–9 小时”的边界解释，不改变 90 分钟倒推算法。
 * 这是通用睡眠卫生信息，不是医疗建议。
 */
const T = require('./time')

const ADULT_MIN_HOURS = 7
const ADULT_MAX_HOURS = 9
const CYCLE_MIN = T.CYCLE_MIN

function hoursText(hours) {
  const rounded = Math.round(hours * 10) / 10
  return (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)) + ' 小时'
}

function guidanceOf(cycles) {
  const count = Number(cycles) || 0
  const hours = (count * CYCLE_MIN) / 60
  if (hours >= ADULT_MIN_HOURS && hours <= ADULT_MAX_HOURS) {
    return { tone: 'ok', label: '推荐', note: '', hours }
  }
  if (hours > ADULT_MAX_HOURS) {
    return {
      tone: 'long',
      label: '偏长',
      hours,
      note:
        count +
        ' 个周期约 ' +
        hoursText(hours) +
        '；高于成人常见区间 ' +
        ADULT_MIN_HOURS +
        '–' +
        ADULT_MAX_HOURS +
        ' 小时'
    }
  }
  if (hours >= 6) {
    return {
      tone: 'short',
      label: '偏短',
      hours,
      // 文案按真实时长生成：后台若调整周期档位，不能继续写死“约 6 小时”
      note:
        count +
        ' 个周期约 ' +
        hoursText(hours) +
        '；成人常见睡眠时长为 ' +
        ADULT_MIN_HOURS +
        '–' +
        ADULT_MAX_HOURS +
        ' 小时'
    }
  }
  return {
    tone: 'low',
    label: '不足',
    hours,
    note:
      count +
      ' 个周期约 ' +
      hoursText(hours) +
      '；成人常见睡眠时长为 ' +
      ADULT_MIN_HOURS +
      '–' +
      ADULT_MAX_HOURS +
      ' 小时，仅作极限参考'
  }
}

/** 凌晨 1 点到 6 点之间入睡，提示后半夜 REM 被压缩 */
function isLateNight(timestamp) {
  const hour = new Date(timestamp).getHours()
  return hour >= 1 && hour < 6
}

function lateNote() {
  return '后半夜 REM 更集中，晚睡会压缩恢复性睡眠'
}

module.exports = {
  guidanceOf,
  isLateNight,
  lateNote
}
