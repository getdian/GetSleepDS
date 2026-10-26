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
  // 激励视频解锁失败：target = skipped|busy|error|unavailable|<trackId>
  'audio_unlock_fail',
  'audio_error',
  // 外部中断（来电/闹钟/其他 App）：target = begin|trackId 或 end|秒|resume|skip
  'audio_interrupt',
  'ad_show',
  'ad_error',
  'manual_sleep',
  // 分享次数：分享 → 打开 → 首次打卡 漏斗的分母
  'share'
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
      // 按条跳过脏数据：旧实现只要一条非法就 400，客户端会按“永久脏数据”
      // 丢弃整批（≤20 条），一条坏事件能带走同批的 app_open/checkin。
      const events = []
      let dropped = 0
      list.forEach((item) => {
        if (!item || TYPES.indexOf(item.type) < 0) {
          dropped += 1
          return
        }
        const ts = Number(item.ts) || current
        if (Math.abs(ts - current) > MAX_AGE) {
          dropped += 1
          return
        }
        events.push({
          type: item.type,
          target: typeof item.target === 'string' ? item.target.slice(0, 64) : '',
          ts
        })
      })
      // 整批都不可用：与旧行为一致返回 400，客户端丢弃本批即可
      if (!events.length) throw invalidBody('没有可记录的事件')

      const openid = await codeToOpenid(code, config.wx)

      try {
        // 由 DB 在同一事务/锁内重新读取 erasure 水位，避免删除后旧事件被写回。
        const accepted = await db.insertEvents(openid, events)
        res.json({ accepted, dropped })
      } catch (e) {
        if (e && e.status) throw e
        throw dbUnavailable()
      }
    })
  )

  return router
}

module.exports = { createEventsRoute, TYPES }
