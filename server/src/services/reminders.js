const { sendSubscribeMessage } = require('./wx')

function formatClock(timestamp) {
  // 产品只面向国内，固定按北京时间展示模板里的时间
  return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(11, 16)
}

/**
 * 结束入睡提醒调度器。
 * 只处理“待发送”的一次性订阅消息；发送成功/被取消后不会再重试。
 */
function createReminderService(options) {
  const db = options.db
  const wx = options.wx || {}
  const templateId = options.templateId || ''
  const page = options.page || 'pages/sleep/sleep?end=1'
  const logger = options.logger || console
  const now = options.now || Date.now
  const intervalMs = options.intervalMs || 30 * 1000
  let timer = null
  let running = false

  async function tick() {
    if (running || !templateId || !db || !db.dueReminders) return
    running = true
    try {
      const due = await db.dueReminders(now(), 50)
      for (let i = 0; i < due.length; i += 1) {
        const item = due[i]
        try {
          await sendSubscribeMessage(wx, {
            openid: item.openid,
            templateId: item.templateId || templateId,
            page: item.page || page,
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
    if (!templateId || timer) return
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
