const express = require('express')
const { wrap } = require('../lib/http')
const { rateLimited, invalidBody } = require('../lib/errors')
const { getUnlimitedQrCode } = require('../services/wx')

// 海报二维码固定拉新到计算器页；scene 'p' = poster（≤32 字符）
const QR_PAGE = 'pages/index/index'
const QR_SCENE = 'p'

/**
 * GET /api/share/qrcode?code=xxx
 * 用登录 code 鉴权防止匿名刷接口，openid 不参与码内容；
 * 返回 PNG buffer，客户端失败时自动降级为纯文案海报。
 */
function createShareRoute(options) {
  const { config, codeToOpenid, limitIp } = options
  const router = express.Router()

  router.get(
    '/share/qrcode',
    wrap(async (req, res) => {
      if (!limitIp(req.ip || 'unknown')) throw rateLimited()

      const code = req.query && req.query.code
      if (typeof code !== 'string' || !code) throw invalidBody('缺少 code')
      await codeToOpenid(code, config.wx)

      const buffer = await getUnlimitedQrCode(config.wx, QR_SCENE, QR_PAGE)
      res.set('Content-Type', 'image/png')
      res.set('Cache-Control', 'private, max-age=3600')
      res.send(buffer)
    })
  )

  return router
}

module.exports = { createShareRoute, QR_PAGE, QR_SCENE }
