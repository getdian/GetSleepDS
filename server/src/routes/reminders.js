const express = require('express')
const { wrap } = require('../lib/http')
const { invalidBody, rateLimited, apiError } = require('../lib/errors')

function createRemindersRoute(options) {
  const { config, db, codeToOpenid, limitIp, now } = options
  const router = express.Router()
  const templateId = (config.wx && config.wx.reminderTemplateId) || ''
  const page = 'pages/sleep/sleep?end=1'

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
        await db.cancelReminder(openid, sessionId)
        res.json({ ok: true })
        return
      }
      if (action !== 'create') throw invalidBody('action 只能是 create/cancel')
      if (!templateId) throw apiError('REMINDER_NOT_CONFIGURED', '结束提醒暂未开放', 503)

      const fireAt = Number(body.fireAt)
      const current = now()
      if (!Number.isFinite(fireAt)) throw invalidBody('fireAt 不合法')
      // 只接受未来 1 分钟到 48 小时的提醒，避免历史/恶意时间
      if (fireAt < current + 60 * 1000 || fireAt > current + 48 * 60 * 60 * 1000) {
        throw invalidBody('提醒时间需在 1 分钟到 48 小时内')
      }
      await db.saveReminder(openid, {
        sessionId,
        fireAt,
        templateId,
        page
      })
      res.json({ ok: true, fireAt })
    })
  )

  return router
}

module.exports = { createRemindersRoute }
