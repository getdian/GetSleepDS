const express = require('express')
const { wrap } = require('../lib/http')
const { rateLimited, dbUnavailable, invalidBody } = require('../lib/errors')

function createAudioRoute(options) {
  const { config, db, codeToOpenid, limitIp, limitOpenid, now, store, logger } = options
  const log = logger || console
  const router = express.Router()

  router.post(
    '/audio/unlock',
    wrap(async (req, res) => {
      if (!limitIp(req.ip || 'unknown')) throw rateLimited()

      const code = req.body && req.body.code
      if (!code) throw invalidBody('缺少 code')

      const openid = await codeToOpenid(code, config.wx)

      if (!limitOpenid(openid)) throw rateLimited()

      // 有效期以后台配置为准，改完立即生效
      const current = await store.get()
      const configured = current.config.unlock && Number(current.config.unlock.ttlHours)
      const ttlHours = configured > 0 ? configured : config.unlockTtlHours

      const expireAt = now() + ttlHours * 60 * 60 * 1000

      try {
        await db.saveUnlock(openid, expireAt)
      } catch (e) {
        // 不记录原始错误时，唯一性冲突/连接池耗尽/语法错全部塌缩成 503，排障只能靠猜
        log.error('[db] audio unlock failed:', req.id || '', e.message)
        throw dbUnavailable()
      }

      res.json({ expireAt, ttlHours })
    })
  )

  return router
}

module.exports = { createAudioRoute }
