const { createPopularityRoute } = require('./popularity')

function createBackgroundsRoute(options) {
  const { config, db, codeToOpenid, limitIp, limitOpenid, store, logger, now } = options

  return createPopularityRoute({
    config,
    db,
    codeToOpenid,
    limitIp,
    limitOpenid,
    store,
    logger,
    now,
    getPath: '/backgrounds/uses',
    postPath: '/backgrounds/use',
    listKey: 'backgrounds',
    idField: 'bgId',
    readCount: (ids) => db.countBackgroundUses(ids),
    writeCount: (openid, id, body, requestStartedAt) => db.addBackgroundUse(openid, id, requestStartedAt),
    unknownLabel: '未知的背景图'
  })
}

module.exports = { createBackgroundsRoute }
