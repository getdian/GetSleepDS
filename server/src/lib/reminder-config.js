/**
 * 提醒配置归一化：路由层（落库快照）与服务层（发送取配置）共用同一份逻辑。
 *
 * 为什么要抽出来：这两处曾各拼一次，字段名（thingKey/timeKey）在路由层被漏掉，
 * 导致“运营换模板后旧任务仍按创建时字段发送”的保护形同虚设（微信 47003，提醒永久丢失）。
 * 字段名必须与模板一起归一化，缺一不可。
 */
const DEFAULT_PAGE = 'pages/sleep/sleep?end=1'
const DEFAULT_THING_KEY = 'thing1'
const DEFAULT_TIME_KEY = 'time2'

/**
 * @param {object} source 提醒配置（后台可改；可能是 null/undefined）
 * @param {object} [options]
 * @param {string} [options.fallbackTemplateId] 环境变量兜底的模板 ID
 * @param {string} [options.fallbackPage] 默认落地页
 */
function reminderConfigOf(source, options) {
  const opts = options || {}
  const reminder = source || {}
  return {
    enabled: reminder.enabled !== false,
    templateId: reminder.templateId || opts.fallbackTemplateId || '',
    page: reminder.page || opts.fallbackPage || DEFAULT_PAGE,
    thingKey: reminder.thingKey || DEFAULT_THING_KEY,
    timeKey: reminder.timeKey || DEFAULT_TIME_KEY
  }
}

module.exports = {
  reminderConfigOf,
  DEFAULT_PAGE,
  DEFAULT_THING_KEY,
  DEFAULT_TIME_KEY
}
