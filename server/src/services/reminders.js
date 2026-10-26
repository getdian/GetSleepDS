const { sendSubscribeMessage } = require('./wx')
const { reminderConfigOf } = require('../lib/reminder-config')

// 允许的最大迟到：超过这个窗口的任务只标记 expired、不调用微信接口。
// 停机/后台关闭期间 pending 会累积，恢复后不能把几小时前的“结束入睡”补发出去。
const MAX_LATE_MS = 15 * 60 * 1000

/**
 * 事项文案按来源区分：
 * - plan-s-：结果面“提醒我入睡” → 该睡了
 * - plan-w-：结果面“提醒我起床” → 该起床了
 * - 其他（sleep- 打卡会话）：到点结束入睡 → 结束入睡
 * 前缀编码在 sessionId 里，避免给已有表加列做迁移。
 */
function thingTextOf(sessionId) {
  const id = String(sessionId || '')
  if (id.indexOf('plan-s-') === 0) return '该睡了'
  if (id.indexOf('plan-w-') === 0) return '该起床了'
  return '结束入睡'
}

/**
 * 点击消息后的落地页：
 * - 打卡会话（sleep-）沿用后台配置（默认 pages/sleep/sleep?end=1，直接打开结束面板）；
 * - 结果面计划提醒不能带 end=1：「该睡了」点进来若已在计时会被直接弹出结束面板，
 *   未计时则提示“这次入睡已经结束过了”，都是错的。改为 remind=sleep|wake，由入睡页分流。
 * 发送时也按此重算：上线前已排队、page 里仍是 end=1 的计划提醒同样被纠正，无需迁移。
 */
const PLAN_PAGE = 'pages/sleep/sleep'
function pageFor(sessionId, page) {
  const id = String(sessionId || '')
  if (id.indexOf('plan-s-') === 0) return PLAN_PAGE + '?remind=sleep'
  if (id.indexOf('plan-w-') === 0) return PLAN_PAGE + '?remind=wake'
  return page
}

function formatDateTime(timestamp) {
  // 模板「提醒时间」的示例通常是完整日期时间（如 2019年11月11日 20:30）。
  // time 类型两种格式都接受，但发完整格式与审核示例一致，用户也能看到“哪一天”。
  const d = new Date(timestamp + 8 * 60 * 60 * 1000)
  const pad = (n) => (n < 10 ? '0' + n : String(n))
  return (
    d.getUTCFullYear() +
    '年' +
    (d.getUTCMonth() + 1) +
    '月' +
    d.getUTCDate() +
    '日 ' +
    pad(d.getUTCHours()) +
    ':' +
    pad(d.getUTCMinutes())
  )
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
    return reminderConfigOf(current, {
      fallbackTemplateId,
      fallbackPage
    })
  }

  async function tick() {
    if (running || !db || !db.dueReminders) return
    running = true
    try {
      const reminder = await resolveReminder()
      const current = now()
      // 清理必须独立于 enabled：关闭期间 pending 行会持续累积，
      // 恢复后不能把历史任务当成“刚到期”一次性补发。
      if (db.cleanupReminders) {
        await db.cleanupReminders(current - 7 * 24 * 60 * 60 * 1000)
      }
      // 运营在后台关闭后，已排队但未发送的任务也不再推：避免“关了还收到”
      if (!reminder.enabled || !reminder.templateId) return
      const due = await db.dueReminders(current, 50)
      for (let i = 0; i < due.length; i += 1) {
        const item = due[i]
        // 迟到太久的提醒不再发送：停机/关闭期间累积的旧任务会在起床数小时/数天后
        // 弹出“结束入睡”，既误导用户又白白消耗一次性订阅。标记 expired 让 due 查询不再命中。
        if (current - Number(item.fireAt) > MAX_LATE_MS) {
          try {
            await db.markReminder(item.openid, item.sessionId, 'expired', current)
          } catch (e) {
            logger.error('[reminder] expire failed', item.sessionId, e && e.message)
          }
          continue
        }
        try {
          // 字段名由后台按模板配置（thing1/time2、time1/thing2…），不能写死：
          // 写死时换一个关键词不同的模板，微信直接返回 47003，提醒永远发不出去。
          // 任务上有快照就优先用快照：运营换模板后，已排队任务仍按创建时的字段发送，
          // 否则“旧模板 + 新字段”会被微信拒绝（47003），提醒永久丢失。
          const thingKey = item.thingKey || reminder.thingKey
          const timeKey = item.timeKey || reminder.timeKey
          const data = {}
          data[thingKey] = { value: thingTextOf(item.sessionId) }
          data[timeKey] = { value: formatDateTime(item.fireAt) }
          await sendSubscribeMessage(wx, {
            openid: item.openid,
            // 任务上记录的模板优先：更换模板不应让已排队任务用错字段
            templateId: item.templateId || reminder.templateId,
            page: pageFor(item.sessionId, item.page || reminder.page),
            data
          })
          await db.markReminder(item.openid, item.sessionId, 'sent', current)
        } catch (error) {
          // 43101=用户未订阅/已取消：不再重试，直接撤销。
          if (error && Number(error.errcode) === 43101) {
            await db.markReminder(item.openid, item.sessionId, 'cancelled', current)
          } else {
            // 微信/网络瞬时故障不再永久标 failed：最多 3 次，按 1/2 分钟退避。
            // 仍受 MAX_LATE_MS 约束：超过 15 分钟的旧任务直接 expired，不会无限重发。
            const attempts = (Number(item.attempts) || 0) + 1
            if (attempts >= 3 || !db.scheduleReminderRetry) {
              await db.markReminder(item.openid, item.sessionId, 'failed', current)
            } else {
              await db.scheduleReminderRetry(item.openid, item.sessionId, {
                attempts,
                retryAt: current + attempts * 60 * 1000,
                at: current
              })
            }
          }
          logger.error('[reminder] send failed', item.sessionId, error && error.errcode)
        }
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

module.exports = { createReminderService, pageFor, thingTextOf }
