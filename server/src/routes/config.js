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
      res.set('Cache-Control', 'no-store')
      res.json(
        Object.assign({}, current.config, {
          // 模板 ID 不是密钥；客户端需要它来发起一次性订阅授权
          reminder: {
            templateId: (config.wx && config.wx.reminderTemplateId) || '',
            page: '/pages/sleep/sleep?end=1'
          },
          serverTime: Date.now()
        })
      )
    })
  )

  return router
}

module.exports = { createConfigRoute }
