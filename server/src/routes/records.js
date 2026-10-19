const express = require('express')
const { wrap } = require('../lib/http')
const { validateRecords } = require('../lib/validate')
const { rateLimited, dbUnavailable, invalidBody } = require('../lib/errors')

function createRecordsRoute(options) {
  const { config, db, codeToOpenid, limitIp, limitErase, now } = options
  const eraseLimit = limitErase || limitIp
  const router = express.Router()

  router.post(
    '/records/sync',
    wrap(async (req, res) => {
      if (!limitIp(req.ip || 'unknown')) throw rateLimited()

      const code = req.body && req.body.code
      if (!code) throw invalidBody('缺少 code')

      const openid = await codeToOpenid(code, config.wx)
      const records = validateRecords(req.body && req.body.records)

      let stored = []
      try {
        await db.upsertRecords(openid, records)
        // 把云端记录一起返回，客户端据此回填（换机/清缓存恢复）
        stored = await db.getRecords(openid)
      } catch (e) {
        throw dbUnavailable()
      }

      res.json({ synced: records.length, records: stored, serverTime: now() })
    })
  )

  // 合规删除通道：按 openid 物理删除全部云端记录，客户端收到成功后再清本地
  router.post(
    '/records/erase',
    wrap(async (req, res) => {
      if (!eraseLimit(req.ip || 'unknown')) throw rateLimited()

      const code = req.body && req.body.code
      if (!code) throw invalidBody('缺少 code')

      const openid = await codeToOpenid(code, config.wx)
      let result = null
      try {
        result = db.deleteUserData
          ? await db.deleteUserData(openid)
          : { records: await db.deleteRecords(openid), unlocks: 0, events: 0 }
      } catch (e) {
        throw dbUnavailable()
      }

      res.json({
        deleted: result.records,
        deletedUnlocks: result.unlocks,
        deletedEvents: result.events,
        serverTime: now()
      })
    })
  )

  return router
}

module.exports = { createRecordsRoute }
