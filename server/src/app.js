const path = require('path')
const crypto = require('crypto')
const express = require('express')
const { wrap } = require('./lib/http')
const { createRateLimiter } = require('./lib/rate-limit')
const { createConfigStore } = require('./services/config-store')
const { createAdminAuth } = require('./services/admin-auth')
const { createStorageSettings } = require('./services/storage-settings')
const { createAnalytics } = require('./services/analytics')
const { createSecretBox } = require('./lib/secret-box')
const { createConfigRoute } = require('./routes/config')
const { createAdminRoute } = require('./routes/admin')
const { createAudioRoute } = require('./routes/audio')
const { createEventsRoute } = require('./routes/events')
const { createSummaryRoute } = require('./routes/summary')
const { createRecordsRoute } = require('./routes/records')
const { createShareRoute } = require('./routes/share')

const ADMIN_DIR = path.join(__dirname, '..', 'public', 'admin')
const SITE_DIR = path.join(__dirname, '..', 'public', 'site')
const ADMIN_CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "media-src https:",
  "style-src 'self'",
  "script-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'"
].join('; ')

function setAdminHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Content-Security-Policy', ADMIN_CSP)
  res.setHeader('Cache-Control', 'no-store')
}

function createErrorHandler(logger) {
  return function errorHandler(err, req, res, next) {
    if (res.headersSent) return next(err)

    let status = err.status || 500
    let code = err.code || 'INTERNAL'

    if (err.type === 'entity.parse.failed') {
      status = 400
      code = 'INVALID_BODY'
    } else if (err.type === 'entity.too.large') {
      status = 413
      code = 'PAYLOAD_TOO_LARGE'
    } else if (err.name === 'MulterError') {
      status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400
      code = err.code || 'UPLOAD_ERROR'
    }

    if (!Number.isInteger(status) || status < 400) status = 500

    if (status >= 500) {
      logger.error('[api]', req.id || '-', code, err.message)
    }

    res.status(status).json({
      error: {
        code,
        message: status >= 500 ? '服务暂时不可用' : err.message
      }
    })
  }
}

function createApp(options) {
  const config = options.config
  const db = options.db
  const logger = options.logger || console
  const codeToOpenid = options.codeToOpenid || require('./services/wx').codeToOpenid
  const now = options.now || (() => Date.now())

  const store =
    options.configStore || createConfigStore({ db, fileConfig: config.app, logger })
  const auth = createAdminAuth(config.admin)
  const secretBox = options.secretBox || createSecretBox(config.security.key)
  const storageSettings =
    options.storageSettings ||
    createStorageSettings({ db, secretBox, securityReady: config.security.ready })
  const analytics = options.analytics || createAnalytics({ db, store })

  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', config.trustProxy || 0)
  app.use(express.json({ limit: '64kb' }))

  app.use((req, res, next) => {
    const start = Date.now()
    // Express 会在路由/静态中间件里改写 req.url，这里先固化原始路径。
    // 后台按 openid 查询/删除的路径含用户标识，日志里必须脱敏。
    const logPath = req.originalUrl
      .split('?')[0]
      .replace(/^\/api\/admin\/users\/[^/]+/, '/api/admin/users/:openid')
    const incomingId = req.headers['x-request-id']
    req.id =
      typeof incomingId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(incomingId)
        ? incomingId
        : crypto.randomBytes(8).toString('hex')
    res.setHeader('X-Request-Id', req.id)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    if (config.nodeEnv === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    }

    res.on('finish', () => {
      logger.log(
        JSON.stringify({
          level: 'info',
          requestId: req.id,
          method: req.method,
          path: logPath,
          status: res.statusCode,
          ms: Date.now() - start
        })
      )
    })
    next()
  })

  app.get(
    '/api/health',
    wrap(async (req, res) => {
      let dbStatus = 'down'
      try {
        dbStatus = await db.health()
      } catch (e) {
        dbStatus = 'down'
      }
      res.json({
        ok: true,
        db: dbStatus,
        mode: db.mode,
        uptime: Math.round(process.uptime())
      })
    })
  )

  // 给容器/网关用的就绪探针：数据库不可用时返回 503
  app.get(
    '/api/ready',
    wrap(async (req, res) => {
      let dbStatus = 'down'
      try {
        dbStatus = await db.health()
      } catch (e) {
        dbStatus = 'down'
      }
      if (dbStatus !== 'ok') {
        res.status(503).json({ ok: false, db: dbStatus })
        return
      }
      res.json({ ok: true, db: dbStatus })
    })
  )

  const limits = config.rateLimit
  const unlockIp = createRateLimiter(limits.windowMs, limits.maxUnlockPerIp)
  const unlockOpenid = createRateLimiter(limits.windowMs, limits.maxUnlockPerOpenid)
  const summaryIp = createRateLimiter(limits.windowMs, limits.maxSummaryPerIp)
  const loginIp = createRateLimiter(60 * 1000, 5)
  const eventsIp = createRateLimiter(limits.windowMs, 120)
  const recordsIp = createRateLimiter(60 * 1000, 120)
  const eraseIp = createRateLimiter(60 * 1000, 3)
  const shareIp = createRateLimiter(60 * 1000, 3)

  app.use('/admin', express.static(ADMIN_DIR, { index: 'index.html', setHeaders: setAdminHeaders }))

  app.use('/api', createConfigRoute({ store }))
  app.use(
    '/api',
    createAdminRoute({
      auth,
      store,
      db,
      storage: storageSettings,
      analytics,
      limitLogin: loginIp,
      now,
      logger
    })
  )
  app.use(
    '/api',
    createAudioRoute({
      config,
      db,
      codeToOpenid,
      limitIp: unlockIp,
      limitOpenid: unlockOpenid,
      now,
      store
    })
  )
  app.use('/api', createSummaryRoute({ limitIp: summaryIp, now }))
  app.use('/api', createEventsRoute({ config, db, codeToOpenid, limitIp: eventsIp, now }))
  app.use(
    '/api',
    createRecordsRoute({
      config,
      db,
      codeToOpenid,
      limitIp: recordsIp,
      limitErase: eraseIp,
      now
    })
  )
  app.use('/api', createShareRoute({ config, codeToOpenid, limitIp: shareIp }))

  // 落地页与 H5 交互演示
  app.get(['/demo', '/demo/'], (req, res) => {
    res.sendFile(path.join(SITE_DIR, 'demo.html'))
  })
  app.use('/', express.static(SITE_DIR, { index: 'index.html', extensions: ['html'] }))

  app.use((req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在' } })
  })

  app.use(createErrorHandler(logger))

  return app
}

module.exports = { createApp }
