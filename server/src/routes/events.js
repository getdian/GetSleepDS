const express = require('express')
const { wrap } = require('../lib/http')
const { invalidBody, payloadTooLarge, rateLimited, dbUnavailable } = require('../lib/errors')

const TYPES = ['app_open', 'checkin', 'audio_play', 'audio_unlock', 'ad_show', 'ad_error']
const MAX_EVENTS = 20
const MAX_AGE = 7 * 24 * 60 * 60 * 1000

function createEventsRoute(options) {
  const { config, db, codeToOpenid, limitIp, now } = options
  const router = express.Router()

  router.post(
    '/events',
    wrap(async (req, res) => {
      if (!limitIp(req.ip || 'unknown')) throw rateLimited()

      const code = req.body && req.body.code
      if (!code) throw invalidBody('缺少 code')

      const list = req.body && req.body.events
      if (!Array.isArray(list) || !list.length) throw invalidBody('events 不能为空')
      if (list.length > MAX_EVENTS) throw payloadTooLarge('单次最多 ' + MAX_EVENTS + ' 个事件')

      const current = now()
      const events = list.map((item, index) => {
        if (!item || TYPES.indexOf(item.type) < 0) {
          throw invalidBody('第 ' + (index + 1) + ' 个事件类型不合法')
        }
        const ts = Number(item.ts) || current
        if (Math.abs(ts - current) > MAX_AGE) {
          throw invalidBody('第 ' + (index + 1) + ' 个事件时间超出范围')
        }
        return {
          type: item.type,
          target: typeof item.target === 'string' ? item.target.slice(0, 64) : '',
          ts
        }
      })

      const openid = await codeToOpenid(code, config.wx)

      try {
        // 全量清除后，清除前发出的在途事件不能再落库
        const erasedAt = db.getErasure ? await db.getErasure(openid) : 0
        const accepted = erasedAt
          ? events.filter((event) => event.ts > erasedAt)
          : events
        if (accepted.length) await db.insertEvents(openid, accepted)
        res.json({ accepted: accepted.length })
      } catch (e) {
        if (e && e.status) throw e
        throw dbUnavailable()
      }
    })
  )

  return router
}

module.exports = { createEventsRoute, TYPES }
