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
      // 国际站需要可缓存：配置是低频写、高频读，且后台保存会覆写进程内缓存。
      // 30s 浏览器缓存 + 5min SWR，兼顾即时性与海外回源成本。
      res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=300')
      res.set('Vary', 'Origin')
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
