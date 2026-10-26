/**
 * 完成态「每日一句」：按日历日固定一句，同一天多次进入不跳变。
 *
 * 选取约束（与 2026-10-22 文案中性化口径一致）：
 * - 只用公版（先秦至清）诗句/典籍/歌谣，避免现代作家与译作的版权风险；
 * - 不写「今夜/晚安/月光」这类预设夜间的词——白天补觉、午休、跨时区醒来都成立；
 * - 完成态是「已经醒来」，优先取睡醒/闲适/作息类，而不是教人怎么入睡。
 *
 * 取模基准是「日期字符串 → 自 1970 起的天数」，不是字符哈希：
 * 前者保证相邻两天必然换句，且每 QUOTES.length 天回到同一句。
 */

const DAY_MS = 24 * 60 * 60 * 1000

const QUOTES = [
  { text: '先睡心，后睡眼。', source: '宋·蔡元定《睡诀》' },
  { text: '其寝不梦，其觉无忧。', source: '《庄子·大宗师》' },
  { text: '眠食二者，为养生之要务。', source: '清·李渔《闲情偶寄》' },
  { text: '不觅仙方觅睡方。', source: '宋·陆游《午梦》' },
  { text: '闲来无事不从容，睡觉东窗日已红。', source: '宋·程颢《秋日偶成》' },
  { text: '日长睡起无情思，闲看儿童捉柳花。', source: '宋·杨万里《闲居初夏午睡起》' },
  { text: '睡起莞然成独笑，数声渔笛在沧浪。', source: '宋·蔡确《夏日登车盖亭》' },
  { text: '枕上诗书闲处好，门前风景雨来佳。', source: '宋·李清照《摊破浣溪沙》' },
  { text: '竹斋眠听雨，梦里长青苔。', source: '宋·方岳《听雨》' },
  { text: '枕上片时春梦中，行尽江南数千里。', source: '唐·岑参《春梦》' },
  { text: '春眠不觉晓，处处闻啼鸟。', source: '唐·孟浩然《春晓》' },
  { text: '起居有常，不妄作劳。', source: '《黄帝内经·素问》' },
  { text: '食饮有节，起居有常。', source: '《黄帝内经·素问》' },
  { text: '早卧早起，与鸡俱兴。', source: '《黄帝内经·素问》' },
  { text: '日出而作，日入而息。', source: '先秦《击壤歌》' },
  { text: '食不语，寝不言。', source: '《论语·乡党》' }
]

/** 'YYYY-MM-DD' → 自 1970-01-01 起的天数；非法日期一律 null */
function dayIndex(key) {
  const parts = String(key == null ? '' : key).split('-')
  if (parts.length !== 3) return null
  const y = Number(parts[0])
  const m = Number(parts[1])
  const d = Number(parts[2])
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const ms = Date.UTC(y, m - 1, d)
  if (!Number.isFinite(ms)) return null
  // Date.UTC 会把 2026-02-31 滚到 3 月：回读校验，别让非法日期抢占别人的句子
  const back = new Date(ms)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) {
    return null
  }
  return Math.floor(ms / DAY_MS)
}

/**
 * 取某天的语录；key 非法或缺失返回 null（调用方回落到固定页脚文案）。
 * 入参用 dateKey（设备本地日历日）：这是 UI 文案，不是归档归属。
 */
function quoteOf(key) {
  const index = dayIndex(key)
  if (index === null) return null
  const i = ((index % QUOTES.length) + QUOTES.length) % QUOTES.length
  return { text: QUOTES[i].text, source: QUOTES[i].source }
}

module.exports = {
  QUOTES,
  quoteOf
}
