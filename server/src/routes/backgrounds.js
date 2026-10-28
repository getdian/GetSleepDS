const express = require('express')
const { wrap } = require('../lib/http')
const { rateLimited, dbUnavailable, invalidBody } = require('../lib/errors')

/** 后台配置的人气基数：只影响展示起点，真实使用次数在其上累加 */
function useBaseOf(config) {
  const map = {}
  ;((config && config.backgrounds) || []).forEach((item) => {
    if (!item || typeof item.id !== 'string') return
    const base = Math.floor(Number(item.useBase))
    map[item.id] = Number.isFinite(base) && base > 0 ? base : 0
  })
  return map
}

function createBackgroundsRoute(options) {
  const { config, db, codeToOpenid, limitIp, limitOpenid, now, store, logger } = options
  const log = logger || console
  const router = express.Router()

  /**
   * 使用次数（展示值）= 后台人气基数 + 真实累计次数。
   * 统计失败只降级为基数：背景选择器不能因为计数查询挂掉而整屏空白。
   */
  async function countsOf(backgrounds, ids) {
    const bases = useBaseOf({ backgrounds })
    const counts = {}
    ids.forEach((id) => {
      counts[id] = bases[id] || 0
    })
    try {
      const real = await db.countBackgroundUses(ids)
      ids.forEach((id) => {
        counts[id] = (counts[id] || 0) + (Number(real && real[id]) || 0)
      })
    } catch (e) {
      log.error('[db] background uses count failed:', e.message)
    }
    return counts
  }

  /** 公开的使用次数：打开背景选择器时拉一次 */
  router.get(
    '/backgrounds/uses',
    wrap(async (req, res) => {
      if (!limitIp(req.ip || 'unknown')) throw rateLimited()

      const current = await store.get()
      const backgrounds = ((current && current.config) || {}).backgrounds || []
      const ids = backgrounds.map((item) => item.id).filter(Boolean)
      const counts = await countsOf(backgrounds, ids)

      // 与 /api/config 同口径：低频写、高频读，30s 浏览器缓存足够
      res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=120')
      res.json({ counts, updatedAt: (current && current.updatedAt) || 0 })
    })
  )

  /** 记录一次背景使用：需要 code 换 openid；同一人多次使用算多次（真实使用行为） */
  router.post(
    '/backgrounds/use',
    wrap(async (req, res) => {
      if (!limitIp(req.ip || 'unknown')) throw rateLimited()

      const code = req.body && req.body.code
      if (!code) throw invalidBody('缺少 code')

      const bgId = req.body && req.body.bgId
      if (!bgId || typeof bgId !== 'string') throw invalidBody('缺少 bgId')

      const current = await store.get()
      const backgrounds = ((current && current.config) || {}).backgrounds || []
      const track = backgrounds.filter((item) => item.id === bgId)[0]
      // 只接受配置里存在的背景：否则任意字符串都能往统计表里灌数据
      if (!track) throw invalidBody('未知的背景图')

      const openid = await codeToOpenid(code, config.wx)
      if (!limitOpenid(openid)) throw rateLimited()

      let real = 0
      try {
        real = await db.addBackgroundUse(openid, bgId)
      } catch (e) {
        log.error('[db] background use failed:', req.id || '', e.message)
        throw dbUnavailable()
      }

      const base = useBaseOf({ backgrounds })[bgId] || 0
      res.json({ bgId, count: base + (Number(real) || 0) })
    })
  )

  return router
}

module.exports = { createBackgroundsRoute }
