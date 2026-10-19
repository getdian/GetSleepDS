const express = require('express')
const { wrap } = require('../lib/http')
const { validateRecords, validateDeletions } = require('../lib/validate')
const { rateLimited, dbUnavailable, invalidBody, featureOff } = require('../lib/errors')

function createRecordsRoute(options) {
  const { config, db, codeToOpenid, limitIp, limitErase, now, store } = options
  const eraseLimit = limitErase || limitIp
  const router = express.Router()

  router.post(
    '/records/sync',
    wrap(async (req, res) => {
      if (!limitIp(req.ip || 'unknown')) throw rateLimited()

      // 服务端总闸：运营在后台关闭云端备份后，任何客户端都不能再写入
      // 注意 /records/erase 不受此限制（合规删除通道必须始终可用）
      if (store) {
        const currentConfig = await store.get()
        const features = (currentConfig.config && currentConfig.config.features) || {}
        if (features.sync === false) throw featureOff('云同步未开放')
      }

      const code = req.body && req.body.code
      if (!code) throw invalidBody('缺少 code')

      const openid = await codeToOpenid(code, config.wx)
      const current = now()
      const parsed = validateRecords(req.body && req.body.records, { now: current })
      const deletedDays = validateDeletions(req.body && req.body.deletedDays, { now: current })

      let result = null
      try {
        result = db.syncRecords
          ? await db.syncRecords(openid, parsed.records, deletedDays, current)
          : await (async () => {
              await db.upsertRecords(openid, parsed.records)
              return {
                accepted: parsed.records.length,
                dropped: 0,
                records: await db.getRecords(openid),
                deletedDays: [],
                erasedAt: 0
              }
            })()
      } catch (e) {
        throw dbUnavailable()
      }

      res.json({
        synced: result.accepted,
        dropped: parsed.dropped + result.dropped,
        records: result.records,
        deletedDays: result.deletedDays,
        erasedAt: result.erasedAt,
        serverTime: current
      })
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
      const current = now()
      const cloudOnly = !!(req.body && req.body.cloudOnly === true)
      let result = null
      try {
        if (cloudOnly && db.eraseCloudData) {
          // 只删云端副本，不写 erasure 水位：本机记录保留且不会被下次同步清掉
          result = await db.eraseCloudData(openid)
        } else {
          result = db.eraseUserData
            ? await db.eraseUserData(openid, current)
            : { records: await db.deleteRecords(openid), unlocks: 0, events: 0, erasedAt: current }
        }
      } catch (e) {
        throw dbUnavailable()
      }

      res.json({
        deleted: result.records,
        deletedUnlocks: result.unlocks,
        deletedEvents: result.events,
        erasedAt: result.erasedAt,
        serverTime: current
      })
    })
  )

  return router
}

module.exports = { createRecordsRoute }
