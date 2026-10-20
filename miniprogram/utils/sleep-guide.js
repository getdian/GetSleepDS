/**
 * 睡眠时长提示：只做“成人 7–9 小时”的边界解释，不改变 90 分钟倒推算法。
 * 这是通用睡眠卫生信息，不是医疗建议。
 */
const ADULT_MIN_HOURS = 7
const ADULT_MAX_HOURS = 9
const CYCLE_MIN = 90

function guidanceOf(cycles) {
  const minutes = (Number(cycles) || 0) * CYCLE_MIN
  const hours = minutes / 60
  if (hours >= ADULT_MIN_HOURS && hours <= ADULT_MAX_HOURS) {
    return { tone: 'ok', label: '推荐', note: '' }
  }
  if (hours >= 6) {
    return {
      tone: 'short',
      label: '偏短',
      note: cycles + ' 个周期约 6 小时，低于成人 ' + ADULT_MIN_HOURS + '–' + ADULT_MAX_HOURS + ' 小时建议'
    }
  }
  return {
    tone: 'low',
    label: '不足',
    note: cycles + ' 个周期约 4.5 小时，明显不足，仅作极限参考'
  }
}

/** 凌晨 1 点到 6 点之间入睡，提示后半夜 REM 被压缩 */
function isLateNight(timestamp) {
  const hour = new Date(timestamp).getHours()
  return hour >= 1 && hour < 6
}

function lateNote() {
  return '晚睡会压缩后半夜 REM；建议保证 7 小时以上'
}

module.exports = {
  guidanceOf,
  isLateNight,
  lateNote
}
