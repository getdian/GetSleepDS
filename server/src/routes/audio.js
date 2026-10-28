const express = require('express')
const { wrap } = require('../lib/http')
const { rateLimited, dbUnavailable, invalidBody } = require('../lib/errors')

/** 后台配置的人气基数：只影响展示起点，真实收藏在其上累加 */
function favBaseOf(config) {
  const map = {}
  ;((config && config.audio) || []).forEach((item) => {
    if (!item || typeof item.id !== 'string') return
    const base = Math.floor(Number(item.favBase))
    map[item.id] = Number.isFinite(base) && base > 0 ? base : 0
  })
  return map
}

function createAudioRoute(options) {
  const { config, db, codeToOpenid, limitIp, limitOpenid, now, store, logger } = options
  const log = logger || console
  // 收藏与解锁分桶计数：复用一个桶时，连点几首收藏就会把「看广告解锁」的额度吃光
  const limitFavIp = options.limitFavIp || limitIp
  const limitFavOpenid = options.limitFavOpenid || limitOpenid
  const router = express.Router()

  /**
   * 收藏人数（展示值）= 后台人气基数 + 真实收藏数。
   * 统计失败只降级为基数：音频列表不能因为计数查询挂掉而整屏空白。
   */
  async function countsOf(audio, ids) {
    const bases = favBaseOf({ audio })
    const counts = {}
    ids.forEach((id) => {
      counts[id] = bases[id] || 0
    })
    try {
      const real = await db.countAudioFavorites(ids)
      ids.forEach((id) => {
        counts[id] = (counts[id] || 0) + (Number(real && real[id]) || 0)
      })
    } catch (e) {
      log.error('[db] audio favorites count failed:', e.message)
    }
    return counts
  }

  /** 公开的收藏人数：抽屉打开时拉一次，用于列表文案与排序 */
  router.get(
    '/audio/favorites',
    wrap(async (req, res) => {
      if (!limitFavIp(req.ip || 'unknown')) throw rateLimited()

      const current = await store.get()
      const audio = ((current && current.config) || {}).audio || []
      const ids = audio.map((item) => item.id).filter(Boolean)
      const counts = await countsOf(audio, ids)

      // 与 /api/config 同口径：低频写、高频读，30s 浏览器缓存足够
      res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=120')
      res.json({ counts, updatedAt: (current && current.updatedAt) || 0 })
    })
  )

  /** 收藏 / 取消收藏：需要 code 换 openid，主键去重保证一人只算一次 */
  router.post(
    '/audio/favorite',
    wrap(async (req, res) => {
      if (!limitFavIp(req.ip || 'unknown')) throw rateLimited()

      const code = req.body && req.body.code
      if (!code) throw invalidBody('缺少 code')

      const trackId = req.body && req.body.trackId
      if (!trackId || typeof trackId !== 'string') throw invalidBody('缺少 trackId')
      const on = req.body.on !== false

      const current = await store.get()
      const audio = ((current && current.config) || {}).audio || []
      const track = audio.filter((item) => item.id === trackId)[0]
      // 只接受当前上架的曲目：否则任意字符串都能往统计表里灌数据
      if (!track) throw invalidBody('未知的环境音')

      const openid = await codeToOpenid(code, config.wx)
      if (!limitFavOpenid(openid)) throw rateLimited()

      let real = 0
      try {
        real = await db.setAudioFavorite(openid, trackId, on)
      } catch (e) {
        log.error('[db] audio favorite failed:', req.id || '', e.message)
        throw dbUnavailable()
      }

      const base = favBaseOf({ audio })[trackId] || 0
      res.json({ trackId, on, count: base + (Number(real) || 0) })
    })
  )

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
