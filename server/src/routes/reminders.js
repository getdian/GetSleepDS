const express = require('express')
const { wrap } = require('../lib/http')
const { invalidBody, rateLimited, apiError, dbUnavailable } = require('../lib/errors')
const { pageFor } = require('../services/reminders')

const DEFAULT_PAGE = 'pages/sleep/sleep?end=1'

function createRemindersRoute(options) {
  const { config, db, codeToOpenid, limitIp, now, store, logger } = options
  const log = logger || console
  const router = express.Router()

  /**
   * 每次请求读取“当前生效配置”。
   * 订阅消息模板 ID 已迁到后台可视化配置；如果像以前那样在路由创建时读一次闭包，
   * 运营保存后必须重启容器才生效，后台的“保存并生效”会变成假承诺。
   */
  async function currentReminder() {
    let appConfig = null
    if (store) {
      try {
        const loaded = await store.get()
        appConfig = loaded && loaded.config
      } catch (e) {}
    }
    const reminder =
      (appConfig && appConfig.reminder) || (config.app && config.app.reminder) || {}
    return {
      enabled: reminder.enabled !== false,
      // env 兜底：兼容只有 WX_REMINDER_TEMPLATE_ID 的历史部署
      templateId: reminder.templateId || (config.wx && config.wx.reminderTemplateId) || '',
      page: reminder.page || DEFAULT_PAGE
    }
  }

  router.post(
    '/reminders',
    wrap(async (req, res) => {
      if (limitIp && !limitIp(req.ip || 'unknown')) throw rateLimited()
      const body = req.body || {}
      const code = body.code
      if (!code) throw invalidBody('缺少 code')
      const openid = await codeToOpenid(code, config.wx)
      const action = body.action || 'create'
      const sessionId = String(body.sessionId || '').slice(0, 64)
      if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) throw invalidBody('sessionId 不合法')

      // 取消通道永远开放：即使运营临时撤掉模板，也要能停止已存在的提醒
      if (action === 'cancel') {
        try {
          await db.cancelReminder(openid, sessionId)
        } catch (e) {
          // 与 records/events 一致：DB 不可用是 503，不是 500；不记日志只能靠猜。
          log.error('[db] reminder cancel failed:', req.id || '', e.message)
          throw dbUnavailable()
        }
        res.json({ ok: true })
        return
      }
      if (action !== 'create') throw invalidBody('action 只能是 create/cancel')

      const reminderConfig = await currentReminder()
      if (!reminderConfig.enabled || !reminderConfig.templateId) {
        throw apiError('REMINDER_NOT_CONFIGURED', '结束提醒暂未开放', 503)
      }

      const fireAt = Number(body.fireAt)
      const currentTs = now()
      if (!Number.isFinite(fireAt)) throw invalidBody('fireAt 不合法')
      // 只接受未来 1 分钟到 48 小时的提醒，避免历史/恶意时间
      if (fireAt < currentTs + 60 * 1000 || fireAt > currentTs + 48 * 60 * 60 * 1000) {
        throw invalidBody('提醒时间需在 1 分钟到 48 小时内')
      }
      let saved = false
      try {
        saved = await db.saveReminder(openid, {
          sessionId,
          fireAt,
          templateId: reminderConfig.templateId,
          // 计划提醒（plan-s-/plan-w-）不能落到 end=1，见 services/reminders.pageFor
          page: pageFor(sessionId, reminderConfig.page)
        })
      } catch (e) {
        log.error('[db] reminder save failed:', req.id || '', e.message)
        throw dbUnavailable()
      }
      // 没真正写入/恢复就不能回 ok：否则客户端显示“已开启”而服务端没有待发送任务
      if (!saved) throw apiError('REMINDER_NOT_SAVED', '提醒未能保存，请稍后重试', 503)
      res.json({ ok: true, fireAt })
    })
  )

  return router
}

module.exports = { createRemindersRoute, DEFAULT_PAGE }
