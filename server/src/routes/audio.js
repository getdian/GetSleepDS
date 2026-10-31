const { wrap } = require('../lib/http')
const { rateLimited, dbUnavailable, invalidBody } = require('../lib/errors')
const { createPopularityRoute } = require('./popularity')

function createAudioRoute(options) {
  const { config, db, codeToOpenid, limitIp, limitOpenid, now, store, logger } = options
  const log = logger || console
  // 收藏与解锁分桶计数：复用一个桶时，连点几首收藏就会把「看广告解锁」的额度吃光
  const limitFavIp = options.limitFavIp || limitIp
  const limitFavOpenid = options.limitFavOpenid || limitOpenid

  const router = createPopularityRoute({
    config,
    db,
    codeToOpenid,
    limitIp: limitFavIp,
    limitOpenid: limitFavOpenid,
    store,
    logger,
    now,
    getPath: '/audio/favorites',
    postPath: '/audio/favorite',
    listKey: 'audio',
    idField: 'trackId',
    readCount: (ids) => db.countAudioFavorites(ids),
    writeCount: (openid, id, body, requestStartedAt) =>
      db.setAudioFavorite(openid, id, body.on !== false, requestStartedAt),
    unknownLabel: '未知的环境音'
  })

  router.post(
    '/audio/unlock',
    wrap(async (req, res) => {
      if (!limitIp(req.ip || 'unknown')) throw rateLimited()

      const requestStartedAt = now()
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
        await db.saveUnlock(openid, expireAt, requestStartedAt)
      } catch (e) {
        // 不记录原始错误时，唯一性冲突/连接池耗尽/语法错全部塌缩成 503，排障只能靠猜
        if (e && e.status) throw e
        log.error('[db] audio unlock failed:', req.id || '', e.message)
        throw dbUnavailable()
      }

      res.json({ expireAt, ttlHours })
    })
  )

  return router
}

module.exports = { createAudioRoute }
