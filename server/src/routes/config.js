const express = require('express')
const { wrap } = require('../lib/http')

function createConfigRoute(options) {
  const store = options.store
  const config = options.config || {}
  const router = express.Router()

  router.get(
    '/config',
    wrap(async (req, res) => {
      const current = await store.get()
      const stored = (current && current.config) || {}
      const reminder = stored.reminder || {}
      res.set('Cache-Control', 'no-store')
      res.json(
        Object.assign({}, stored, {
          // 模板 ID 不是密钥；客户端需要它来发起一次性订阅授权。
          // 后台配置优先，env 兜底（兼容只有 WX_REMINDER_TEMPLATE_ID 的历史部署）；
          // page 不带前导斜杠，符合微信订阅消息的跳转路径规范。
          reminder: {
            enabled: reminder.enabled !== false,
            templateId:
              reminder.templateId || (config.wx && config.wx.reminderTemplateId) || '',
            page: reminder.page || 'pages/sleep/sleep?end=1'
          },
          serverTime: Date.now()
        })
      )
    })
  )

  return router
}

module.exports = { createConfigRoute }
