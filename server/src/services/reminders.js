const { sendSubscribeMessage } = require('./wx')

function formatClock(timestamp) {
  // 产品只面向国内，固定按北京时间展示模板里的时间
  return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(11, 16)
}

/**
 * 结束入睡提醒调度器。
 * 只处理“待发送”的一次性订阅消息；发送成功/被取消后不会再重试。
 *
 * 模板 ID 已迁到后台可视化配置：调度器必须每轮读取当前配置，
 * 不能像旧实现那样在启动时判定“没有模板就永不启动”——否则后台填好模板仍不生效。
 */
function createReminderService(options) {
  const db = options.db
  const wx = options.wx || {}
  const logger = options.logger || console
  const now = options.now || Date.now
  const intervalMs = options.intervalMs || 30 * 1000
  const getReminder = typeof options.getReminder === 'function' ? options.getReminder : null
  const fallbackTemplateId = options.templateId || ''
  const fallbackPage = options.page || 'pages/sleep/sleep?end=1'
  let timer = null
  let running = false

  async function resolveReminder() {
    let current = null
    if (getReminder) {
      try {
        current = await getReminder()
      } catch (e) {
        current = null
      }
    }
    return {
      enabled: !current || current.enabled !== false,
      templateId: (current && current.templateId) || fallbackTemplateId,
      page: (current && current.page) || fallbackPage
    }
  }

  async function tick() {
    if (running || !db || !db.dueReminders) return
    running = true
    try {
      const reminder = await resolveReminder()
      // 运营在后台关闭后，已排队但未发送的任务也不再推：避免“关了还收到”
      if (!reminder.enabled || !reminder.templateId) return
      const due = await db.dueReminders(now(), 50)
      for (let i = 0; i < due.length; i += 1) {
        const item = due[i]
        try {
          await sendSubscribeMessage(wx, {
            openid: item.openid,
            // 任务上记录的模板优先：更换模板不应让已排队任务用错字段
            templateId: item.templateId || reminder.templateId,
            page: item.page || reminder.page,
            data: {
              thing1: { value: '结束入睡' },
              time2: { value: formatClock(item.fireAt) }
            }
          })
          await db.markReminder(item.openid, item.sessionId, 'sent', now())
        } catch (error) {
          // 43101=用户未订阅/已取消；其余失败标记为 failed，避免无限重试
          const status = error && Number(error.errcode) === 43101 ? 'cancelled' : 'failed'
          await db.markReminder(item.openid, item.sessionId, status, now())
          logger.error('[reminder] send failed', item.sessionId, error && error.errcode)
        }
      }
      if (db.cleanupReminders) {
        await db.cleanupReminders(now() - 7 * 24 * 60 * 60 * 1000)
      }
    } catch (error) {
      logger.error('[reminder] tick failed', error && error.message)
    } finally {
      running = false
    }
  }

  function start() {
    // 始终起表：模板 ID 可能稍后在后台填入；空配置时 tick 直接返回，开销可忽略
    if (timer) return
    timer = setInterval(tick, intervalMs)
    if (timer.unref) timer.unref()
  }

  function stop() {
    if (timer) clearInterval(timer)
    timer = null
  }

  return { start, stop, tick }
}

module.exports = { createReminderService }
