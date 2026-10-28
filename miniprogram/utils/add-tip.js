/**
 * 「添加到我的小程序」引导的出现策略。
 *
 * 纯函数，不依赖 wx，可在 Node 里直接单测（门禁：tests/add-tip.test.js）。
 *
 * 口径（2026-10-28 产品定，改规则先改这里再改文案）：
 * - 只在用户完成过至少一条睡眠记录后出现（没数据的用户先解决“有没有用”，不是“留不留得住”）；
 * - `added === true` 永久静默；判断失败（低版本/接口异常）按“未确认已添加”处理，同样受频次约束；
 * - 未添加时每个自然周最多 1 次、每个自然月最多 5 次（周频≈月频，月上限只是兜底：
 *   跨周界时一周可能落到相邻两天，月上限防止月初+月末叠加）；
 * - 23:00–06:00 不弹（睡眠产品的使用高峰就是这段时间，弹窗只会被当成打扰）。
 *
 * 气泡是「提示」不是「拦截」：不遮页面、不抢焦点、6 秒自动收起，展开即记账，
 * 所以用户点 × 或自动收起后，本周不会再出现（不再额外提供“永久静默”开关）。
 *
 * 周期按北京时间切分（与归档/统计同口径，避免跨时区把同一周算成两周）；
 * 夜间用设备本地时间，因为“夜里别打扰我”说的是用户所在时区的夜。
 */

const T = require('./time')

const MINUTE_MS = T.MINUTE_MS
const BEIJING_OFFSET_MIN = T.DEFAULT_TZ_OFFSET_MIN

// 每自然月最多展示次数：一周一次时一个月通常落 4–5 次，5 是硬上限
const MONTH_LIMIT = 5
// [23:00, 次日 06:00) 不弹
const NIGHT_START_HOUR = 23
const NIGHT_END_HOUR = 6

const EMPTY_STATE = {
  lastShownAt: 0,
  weekKey: '',
  monthKey: '',
  monthCount: 0
}

/** 把本地存的对象收敛成固定形状：旧版本/脏数据不能把逻辑带崩 */
function normalizeState(raw) {
  const value = raw && typeof raw === 'object' ? raw : {}
  return {
    lastShownAt: Number(value.lastShownAt) || 0,
    weekKey: typeof value.weekKey === 'string' ? value.weekKey : '',
    monthKey: typeof value.monthKey === 'string' ? value.monthKey : '',
    monthCount: Math.max(0, Math.floor(Number(value.monthCount) || 0))
  }
}

/** 北京时间的年月日对象（用 UTC getter 读，避免受设备时区影响） */
function beijingDate(timestamp) {
  return new Date(Number(timestamp) + BEIJING_OFFSET_MIN * MINUTE_MS)
}

/** 自然月：2026-10 */
function monthKeyOf(timestamp) {
  const d = beijingDate(timestamp)
  return d.getUTCFullYear() + '-' + T.pad2(d.getUTCMonth() + 1)
}

/** ISO 周：2026-W44（周一为一周第一天，含 1 月 4 日的那一周是当年第一周） */
function weekKeyOf(timestamp) {
  const d = beijingDate(timestamp)
  const cursor = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  // 移到本周四：ISO 周归属看周四落在哪一年
  const dayOfWeek = cursor.getUTCDay() || 7
  cursor.setUTCDate(cursor.getUTCDate() + 4 - dayOfWeek)
  const year = cursor.getUTCFullYear()
  const yearStart = Date.UTC(year, 0, 1)
  const week = Math.ceil(((cursor.getTime() - yearStart) / T.DAY_MS + 1) / 7)
  return year + '-W' + T.pad2(week)
}

/** 夜间：设备本地 23:00–06:00 */
function isNight(timestamp) {
  const hour = new Date(Number(timestamp)).getHours()
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR
}

/** 有没有任何一条已完成记录（补记也算；全删光后回到“没有记录”） */
function hasAnyRecord(records) {
  if (!records || typeof records !== 'object') return false
  return Object.keys(records).length > 0
}

/**
 * 现在该不该弹。
 * @param {object} input
 * @param {number} input.now 当前时间戳
 * @param {object} input.state meta.addTip
 * @param {boolean} input.hasRecord 是否完成过记录
 * @param {boolean} [input.added] 是否已添加（undefined = 判断失败/低版本）
 * @param {boolean} [input.busy] 是否正在入睡/熄灯（不能打断）
 * @returns {{show: boolean, reason: string}} reason 只用于调试与单测，不上报
 */
function shouldShow(input) {
  const options = input || {}
  const state = normalizeState(options.state)
  const now = Number(options.now) || Date.now()

  if (options.added === true) return { show: false, reason: 'added' }
  if (!options.hasRecord) return { show: false, reason: 'no-record' }
  if (options.busy) return { show: false, reason: 'busy' }
  if (isNight(now)) return { show: false, reason: 'night' }
  if (weekKeyOf(now) === state.weekKey) return { show: false, reason: 'week-done' }

  const monthKey = monthKeyOf(now)
  const used = state.monthKey === monthKey ? state.monthCount : 0
  if (used >= MONTH_LIMIT) return { show: false, reason: 'month-cap' }

  return { show: true, reason: 'ok' }
}

/** 展示后记账：写本周、本月与累计次数（换月自动从 1 重新计） */
function markShown(state, now) {
  const current = normalizeState(state)
  const ts = Number(now) || Date.now()
  const monthKey = monthKeyOf(ts)
  const used = current.monthKey === monthKey ? current.monthCount : 0
  return {
    lastShownAt: ts,
    weekKey: weekKeyOf(ts),
    monthKey,
    monthCount: used + 1
  }
}

module.exports = {
  MONTH_LIMIT,
  NIGHT_START_HOUR,
  NIGHT_END_HOUR,
  EMPTY_STATE,
  normalizeState,
  monthKeyOf,
  weekKeyOf,
  isNight,
  hasAnyRecord,
  shouldShow,
  markShown
}
