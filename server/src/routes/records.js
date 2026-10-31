const crypto = require('crypto')
const express = require('express')
const { wrap } = require('../lib/http')
const { validateRecords, validateDeletions } = require('../lib/validate')
const { apiError, rateLimited, dbUnavailable, invalidBody, featureOff } = require('../lib/errors')

function createRecordsRoute(options) {
  const {
    config,
    db,
    codeToOpenid,
    limitIp,
    limitSyncOpenid,
    limitErase,
    limitEraseOpenid,
    now,
    store,
    logger
  } = options
  const log = logger || console
  const eraseLimit = limitErase || limitIp
  const router = express.Router()

  const DEVICE_TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/

  /**
   * 身份解析：小程序走 wx.login code → openid；国际站走匿名 deviceToken。
   * device 身份只存 sha256 前缀（`d_` + 40 hex），数据库泄露也拿不到原始 token。
   * 两条通道共用同一套墓碑/水位/LWW 逻辑，subject 就是那一行的 openid。
   */
  async function subjectOf(body) {
    const code = body && body.code
    if (code) return codeToOpenid(code, config.wx)
    const token = body && body.deviceToken
    if (typeof token === 'string' && DEVICE_TOKEN_RE.test(token)) {
      return 'd_' + crypto.createHash('sha256').update(token).digest('hex').slice(0, 40)
    }
    throw invalidBody('缺少 code 或 deviceToken')
  }

  router.post(
    '/records/sync',
    wrap(async (req, res) => {
      if (!limitIp(req.ip || 'unknown')) throw rateLimited()

      // 请求开始时间必须在任何 await 之前取：全量清除与在途同步交错时，
      // 服务端用“请求是否早于清除水位”判定，而不是继续信任客户端时间戳。
      const requestStartedAt = now()

      // 服务端总闸：运营在后台关闭云端备份后，任何客户端都不能再写入
      // 注意 /records/erase 不受此限制（合规删除通道必须始终可用）
      if (store) {
        const currentConfig = await store.get()
        const features = (currentConfig.config && currentConfig.config.features) || {}
        if (features.sync === false) throw featureOff('云同步未开放')
      }

      // 参数校验必须全部前置：includeAll 非法时若已写库再返回 400，
      // 客户端会按失败重试，造成重复上传与误导性错误码；也避免为坏请求换取 openid。
      const rawIncludeAll = req.body && req.body.includeAll
      if (rawIncludeAll !== undefined && typeof rawIncludeAll !== 'boolean') {
        throw invalidBody('includeAll 必须是布尔值')
      }
      const includeAll = rawIncludeAll !== false
      const current = now()
      const parsed = validateRecords(req.body && req.body.records, { now: current })
      const deletedDays = validateDeletions(req.body && req.body.deletedDays, { now: current })
      const openid = await subjectOf(req.body)
      // subject 维度限流：反代漏配 TRUST_PROXY 时 IP 桶全站共用，这里是第二道闸
      if (limitSyncOpenid && !limitSyncOpenid(openid)) throw rateLimited()

      // 没有 syncRecords 的旧/自定义存储无法处理墓碑与 erasure 水位；
      // 继续用 upsert 降级会静默绕过合规删除（旧设备可把已删记录写回），故 fail-closed。
      if (!db.syncRecords) {
        throw apiError('NOT_SUPPORTED', '当前存储不支持增量同步语义', 501)
      }
      let result = null
      try {
        result = await db.syncRecords(openid, parsed.records, deletedDays, current, requestStartedAt)
      } catch (e) {
        if (e && e.status) throw e
        log.error('[db] records sync failed:', req.id || '', e.message)
        throw dbUnavailable()
      }

      // 分片上传时只有首片需要云端全量回填；后续片省掉 records/deletedDays，
      // 避免 400 条历史 × 7 片 = 7 倍全量下载。
      res.json({
        synced: result.accepted,
        dropped: parsed.dropped + result.dropped,
        records: includeAll ? result.records : [],
        deletedDays: includeAll ? result.deletedDays : [],
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

      const rawCloudOnly = req.body && req.body.cloudOnly
      if (rawCloudOnly !== undefined && typeof rawCloudOnly !== 'boolean') {
        throw invalidBody('cloudOnly 必须是布尔值')
      }
      const cloudOnly = rawCloudOnly === true
      const openid = await subjectOf(req.body)
      // 反代后 req.ip 可能是同一个代理地址；再按 subject 做一层维度限流。
      if (limitEraseOpenid && !limitEraseOpenid(openid)) throw rateLimited()
      const current = now()
      let result = null
      try {
        if (cloudOnly) {
          // 只删云端副本，不写 erasure 水位：本机记录保留且不会被下次同步清掉。
          // 存储不支持时必须 fail-closed：降级成 eraseUserData 会把“只删云端”
          // 变成“连本机一起清”（客户端会按 erasedAt 删除本地记录）。
          if (!db.eraseCloudData) {
            throw apiError('NOT_SUPPORTED', '当前存储不支持仅删除云端副本', 501)
          }
          result = await db.eraseCloudData(openid)
        } else {
          if (!db.eraseUserData) {
            throw apiError('NOT_SUPPORTED', '当前存储不支持全量清除', 501)
          }
          result = await db.eraseUserData(openid, current)
        }
      } catch (e) {
        if (e && e.status) throw e
        log.error('[db] records erase failed:', req.id || '', e.message)
        throw dbUnavailable()
      }

      res.json({
        deleted: result.records,
        deletedUnlocks: result.unlocks,
        deletedEvents: result.events,
        deletedReminders: result.reminders,
        deletedFeedback: result.feedback,
        deletedFavorites: result.favorites,
        deletedBackgroundUses: result.backgroundUses,
        erasedAt: result.erasedAt,
        serverTime: current
      })
    })
  )

  return router
}

module.exports = { createRecordsRoute }
