const express = require('express')
const { wrap } = require('../lib/http')
const { rateLimited, dbUnavailable, invalidBody } = require('../lib/errors')

/**
 * 「人气计数」路由工厂：环境音收藏与背景使用共用同一套骨架——
 * 公开读计数、登录写一次、统计失败只降级不挂接口。
 * 差异（列表键、id 字段、读写库函数）全部参数化，避免两份镜像各自漂移。
 *
 * 接口语义：**只下发真实计数 real，不含后台人气基数**。
 * 展示值由客户端用「自己的配置基数 + real」合成——若由服务端合成，
 * 运营调低基数后，客户端缓存的旧展示值会压住新基数（配置轮询到达也回不去）。
 */
function createPopularityRoute(options) {
  const {
    config,
    db,
    codeToOpenid,
    limitIp,
    limitOpenid,
    store,
    logger,
    getPath,
    postPath,
    listKey,
    idField,
    readCount,
    writeCount,
    unknownLabel
  } = options
  const log = logger || console
  const router = express.Router()

  /** 统计失败只降级为 0：列表不能因为计数查询挂掉而整屏空白 */
  async function realCountsOf(ids) {
    const counts = {}
    ids.forEach((id) => {
      counts[id] = 0
    })
    try {
      const real = await readCount(ids)
      ids.forEach((id) => {
        const value = Number(real && real[id])
        if (Number.isFinite(value) && value > 0) counts[id] = value
      })
    } catch (e) {
      log.error('[db] ' + listKey + ' popularity count failed:', e.message)
    }
    return counts
  }

  /** 公开的真实计数：客户端打开抽屉/选择器时拉一次 */
  router.get(
    getPath,
    wrap(async (req, res) => {
      if (!limitIp(req.ip || 'unknown')) throw rateLimited()

      const current = await store.get()
      const items = ((current && current.config) || {})[listKey] || []
      const ids = items.map((item) => item.id).filter(Boolean)
      const real = await realCountsOf(ids)

      // 与 /api/config 同口径：低频写、高频读，30s 浏览器缓存足够
      res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=120')
      res.json({ real, updatedAt: (current && current.updatedAt) || 0 })
    })
  )

  /** 写一次（收藏/取消收藏、记录使用）：需要 code 换 openid，只接受当前配置里的 id */
  router.post(
    postPath,
    wrap(async (req, res) => {
      if (!limitIp(req.ip || 'unknown')) throw rateLimited()

      const code = req.body && req.body.code
      if (!code) throw invalidBody('缺少 code')

      const id = req.body && req.body[idField]
      if (!id || typeof id !== 'string') throw invalidBody('缺少 ' + idField)

      const current = await store.get()
      const items = ((current && current.config) || {})[listKey] || []
      // 只接受配置里存在的条目：否则任意字符串都能往统计表里灌数据
      if (!items.some((item) => item.id === id)) throw invalidBody(unknownLabel)

      const openid = await codeToOpenid(code, config.wx)
      if (!limitOpenid(openid)) throw rateLimited()

      let real = 0
      try {
        real = await writeCount(openid, id, req.body)
      } catch (e) {
        log.error('[db] ' + listKey + ' popularity write failed:', req.id || '', e.message)
        throw dbUnavailable()
      }

      res.json({ id, real: Number(real) || 0 })
    })
  )

  return router
}

module.exports = { createPopularityRoute }
