const express = require('express')
const { wrap } = require('../lib/http')
const { rateLimited, invalidBody } = require('../lib/errors')
const { getUnlimitedQrCode } = require('../services/wx')

// 海报二维码固定拉新到计算器页；scene 'p' = poster（≤32 字符）
const QR_PAGE = 'pages/index/index'
const QR_SCENE = 'p'
const QR_TTL_MS = 6 * 60 * 60 * 1000

// scene/page 恒定 ⇒ 返回 PNG 对所有用户字节相同。进程内缓存 + in-flight 去重，
// 避免每次生成海报都打一次微信接口（同时叠加 3/min 的 IP 限流会直接 429）。
let qrCache = { key: '', buffer: null, at: 0, inflight: null }

function loadQr(config) {
  const key = QR_SCENE + '|' + QR_PAGE
  if (qrCache.key === key && qrCache.buffer && Date.now() - qrCache.at < QR_TTL_MS) {
    return Promise.resolve(qrCache.buffer)
  }
  if (qrCache.key === key && qrCache.inflight) return qrCache.inflight

  const pending = getUnlimitedQrCode(config.wx, QR_SCENE, QR_PAGE)
    .then((buffer) => {
      qrCache = { key, buffer, at: Date.now(), inflight: null }
      return buffer
    })
    .catch((error) => {
      // 失败不写缓存，下一次请求可以立即重试。
      if (qrCache.key === key && qrCache.inflight === pending) qrCache.inflight = null
      throw error
    })
  qrCache = { key, buffer: qrCache.key === key ? qrCache.buffer : null, at: qrCache.at, inflight: pending }
  return pending
}

/**
 * GET /api/share/qrcode?code=xxx
 * 用登录 code 鉴权防止匿名刷接口，openid 不参与码内容；
 * 返回 PNG buffer，客户端失败时自动降级为纯文案海报。
 */
function createShareRoute(options) {
  const { config, codeToOpenid, limitIp, limitOpenid } = options
  const router = express.Router()

  router.get(
    '/share/qrcode',
    wrap(async (req, res) => {
      if (!limitIp(req.ip || 'unknown')) throw rateLimited()

      const code = req.query && req.query.code
      if (typeof code !== 'string' || !code) throw invalidBody('缺少 code')
      const openid = await codeToOpenid(code, config.wx)
      if (limitOpenid && !limitOpenid(openid)) throw rateLimited()

      const buffer = await loadQr(config)
      res.set('Content-Type', 'image/png')
      res.set('Cache-Control', 'private, max-age=3600')
      res.send(buffer)
    })
  )

  return router
}

module.exports = { createShareRoute, QR_PAGE, QR_SCENE, loadQr }
