const {
  calendarDayOf,
  minutesOf,
  formatClock,
  circularMeanMinutes,
  clockDelta,
  addDaysKey,
  weekStartKey
} = require('../lib/time')

// 合规红线：总结里出现这些词直接报错，不返回给用户
const FORBIDDEN_WORDS = [
  '建议', '应该', '必须', '注意', '尽量', '改善', '提升', '治疗', '疾病',
  '诊断', '评估', '质量', '健康', '专家', '推荐', '熬夜', '早点睡',
  '少熬夜', '伤身', '风险', '症状', '失眠', '焦虑', '抑郁', '医嘱'
]

const MIN_COUNT = 3

function durationText(minutes) {
  const total = Math.max(0, Math.round(minutes))
  if (total < 60) return total + ' 分钟'
  return Math.floor(total / 60) + ' 小时 ' + (total % 60 < 10 ? '0' : '') + (total % 60) + ' 分'
}

function digest(list) {
  if (!list.length) return null
  const beds = list.map((r) => minutesOf(r.bedAt))
  const wakes = list.map((r) => minutesOf(r.wakeAt))
  const totalDuration = list.reduce((acc, r) => acc + r.durationMin, 0)

  return {
    count: list.length,
    avgBedMin: circularMeanMinutes(beds),
    avgWakeMin: circularMeanMinutes(wakes),
    avgDurationMin: Math.round(totalDuration / list.length),
    afterMidnightDays: beds.filter((m) => m < 6 * 60).length
  }
}

const FIRST_SENTENCES = [
  (s) => `本周你记录了 ${s.count} 次睡眠，平均 ${s.avgBed} 入睡、${s.avgWake} 起床，平均 ${s.avgDurationText}。`,
  (s) => `本周 ${s.count} 次记录里，平均 ${s.avgBed} 入睡、${s.avgWake} 起床，平均 ${s.avgDurationText}。`,
  (s) => `本周共 ${s.count} 次打卡：平均 ${s.avgBed} 入睡、${s.avgWake} 起床，平均 ${s.avgDurationText}。`
]

function assertClean(text) {
  for (let i = 0; i < FORBIDDEN_WORDS.length; i += 1) {
    const word = FORBIDDEN_WORDS[i]
    if (text.indexOf(word) >= 0) {
      const error = new Error('总结命中禁词：' + word)
      error.code = 'FORBIDDEN_WORD'
      error.status = 500
      throw error
    }
  }
}

/**
 * 只用模板陈述事实，不接大模型。
 * @param {Array} records 已校验、已完成的记录
 * @param {number} now 当前时间戳
 */
function summarize(records, now) {
  // “本周”按北京时间自然周（周一 00:00）统计；不能用睡眠日，
  // 否则周一 00:00–12:00 会把上周日所在的睡眠周当成“本周”。
  const today = calendarDayOf(now)
  const weekStart = weekStartKey(today)
  const prevStart = addDaysKey(weekStart, -7)
  const prevEnd = addDaysKey(weekStart, -1)

  const current = records.filter((r) => r.day >= weekStart && r.day <= today)
  const previous = records.filter((r) => r.day >= prevStart && r.day <= prevEnd)

  const cur = digest(current)
  const prev = digest(previous)

  if (!cur || cur.count < MIN_COUNT || cur.avgBedMin === null || cur.avgWakeMin === null) {
    return {
      available: false,
      text: null,
      stats: {
        count: cur ? cur.count : 0,
        avgBed: null,
        avgWake: null,
        avgDurationMin: null,
        bedDeltaMin: null,
        afterMidnightDays: 0
      }
    }
  }

  const stats = {
    count: cur.count,
    avgBed: formatClock(cur.avgBedMin),
    avgWake: formatClock(cur.avgWakeMin),
    avgDurationMin: cur.avgDurationMin,
    bedDeltaMin: prev && prev.avgBedMin !== null ? clockDelta(cur.avgBedMin, prev.avgBedMin) : null,
    afterMidnightDays: cur.afterMidnightDays
  }

  const parts = [
    FIRST_SENTENCES[cur.count % FIRST_SENTENCES.length]({
      count: stats.count,
      avgBed: stats.avgBed,
      avgWake: stats.avgWake,
      avgDurationText: durationText(stats.avgDurationMin)
    })
  ]

  let second = ''
  if (stats.bedDeltaMin === null) {
    second = ''
  } else if (stats.bedDeltaMin === 0) {
    second = '平均入睡时间与上周持平'
  } else {
    second =
      '平均入睡时间比上周' +
      (stats.bedDeltaMin > 0 ? '晚' : '早') +
      '了 ' + Math.abs(stats.bedDeltaMin) + ' 分钟'
  }

  if (stats.afterMidnightDays > 0) {
    second += (second ? '，' : '') + '有 ' + stats.afterMidnightDays + ' 天在 0 点后入睡'
  }

  if (second) parts.push(second + '。')

  const text = parts.join('')
  assertClean(text)

  return { available: true, text, stats }
}

module.exports = { summarize, assertClean, FORBIDDEN_WORDS, MIN_COUNT }
