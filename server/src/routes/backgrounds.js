const { createPopularityRoute } = require('./popularity')

function createBackgroundsRoute(options) {
  const { config, db, codeToOpenid, limitIp, limitOpenid, store, logger } = options

  return createPopularityRoute({
    config,
    db,
    codeToOpenid,
    limitIp,
    limitOpenid,
    store,
    logger,
    getPath: '/backgrounds/uses',
    postPath: '/backgrounds/use',
    listKey: 'backgrounds',
    idField: 'bgId',
    readCount: (ids) => db.countBackgroundUses(ids),
    writeCount: (openid, id) => db.addBackgroundUse(openid, id),
    unknownLabel: '未知的背景图'
  })
}

module.exports = { createBackgroundsRoute }
