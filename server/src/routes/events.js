const express = require('express')
const { wrap } = require('../lib/http')
const { invalidBody, payloadTooLarge, rateLimited, dbUnavailable, featureOff } = require('../lib/errors')

// manual_sleep：入睡页/统计页补记成功时上报。缺它会让整批事件被 400 拒绝，
// 客户端按"永久脏数据"丢弃整批（含同批的 app_open/checkin），属于静默丢数。
const TYPES = [
  'app_open',
  'checkin',
  'audio_play',
  'audio_unlock',
  'audio_error',
  'ad_show',
  'ad_error',
  'manual_sleep'
]
const MAX_EVENTS = 20
const MAX_AGE = 7 * 24 * 60 * 60 * 1000

function createEventsRoute(options) {
  const { config, db, codeToOpenid, limitIp, now, store } = options
  const router = express.Router()

  router.post(
    '/events',
    wrap(async (req, res) => {
      if (!limitIp(req.ip || 'unknown')) throw rateLimited()

      if (store) {
        const currentConfig = await store.get()
        const features = (currentConfig.config && currentConfig.config.features) || {}
        if (features.events === false) throw featureOff('匿名事件统计未开放')
      }

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
        // 由 DB 在同一事务/锁内重新读取 erasure 水位，避免删除后旧事件被写回。
        const accepted = await db.insertEvents(openid, events)
        res.json({ accepted })
      } catch (e) {
        if (e && e.status) throw e
        throw dbUnavailable()
      }
    })
  )

  return router
}

module.exports = { createEventsRoute, TYPES }
