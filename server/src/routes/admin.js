const crypto = require('crypto')
const path = require('path')
const express = require('express')
const multer = require('multer')

const { wrap } = require('../lib/http')
const { rateLimited, invalidBody, apiError, dbUnavailable } = require('../lib/errors')
const { orphanKeys } = require('../lib/cos-keys')
const cos = require('../services/cos')

const AUDIO_TYPES = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg'
}

function fileExtension(file) {
  const byMime = AUDIO_TYPES[file.mimetype]
  if (byMime) return byMime
  const ext = path.extname(file.originalname || '').replace('.', '').toLowerCase()
  return /^[a-z0-9]{2,5}$/.test(ext) ? ext : 'mp3'
}

function readOpenid(value) {
  const openid = String(value || '').trim()
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(openid)) throw invalidBody('openid 格式不正确')
  return openid
}

function openidTag(openid) {
  return crypto.createHash('sha256').update(openid).digest('hex').slice(0, 12)
}

function createUploader() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter(req, file, callback) {
      if (AUDIO_TYPES[file.mimetype] || /\.(mp3|m4a|aac|wav|ogg)$/i.test(file.originalname || '')) {
        callback(null, true)
        return
      }
      const error = new Error('只支持 mp3 / m4a / aac / wav / ogg 音频')
      error.status = 400
      error.code = 'INVALID_FILE_TYPE'
      callback(error)
    }
  })
}

const IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
}

function imageExtension(file) {
  const byMime = IMAGE_TYPES[file.mimetype]
  if (byMime) return byMime
  const ext = path.extname(file.originalname || '').replace('.', '').toLowerCase()
  if (ext === 'jpeg') return 'jpg'
  return ['jpg', 'png', 'webp'].indexOf(ext) >= 0 ? ext : 'jpg'
}

function createImageUploader() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter(req, file, callback) {
      if (IMAGE_TYPES[file.mimetype] || /\.(jpg|jpeg|png|webp)$/i.test(file.originalname || '')) {
        callback(null, true)
        return
      }
      const error = new Error('只支持 jpg / png / webp 图片')
      error.status = 400
      error.code = 'INVALID_FILE_TYPE'
      callback(error)
    }
  })
}

function createAdminRoute(options) {
  const {
    auth,
    store,
    db,
    config,
    storage,
    analytics,
    limitLogin,
    limitUpload,
    now,
    logger
  } = options
  const log = logger || console
  const router = express.Router()
  const upload = createUploader()
  const imageUpload = createImageUploader()

  // 上传在 multer 解析文件之前限流，避免 25MB 文件先落内存再被拒
  function gateUpload(req, res, next) {
    if (!limitUpload || limitUpload(req.ip || 'unknown')) return next()
    next(rateLimited())
  }

  // 上传审计（best-effort）：失败不阻断上传结果，但要留日志
  function auditUpload(action, details) {
    if (!db.logAdminAction) return
    Promise.resolve()
      .then(() => db.logAdminAction(action, '-', details))
      .catch((e) => log.error('[audit] ' + action + ' failed:', e.message))
  }

  /**
   * 保存成功后回收被替换的自家 COS 对象（背景图 / 小程序码）。
   * - 只删 lib/cos-keys.js 白名单目录，音频不在内（可能共用/历史地址）；
   * - 异步执行、失败只记日志：清理失败不影响本次保存结果；
   * - 上传后未保存的情况不会触发，线上引用不会被提前删掉。
   */
  function removeReplacedUploads(prevConfig, nextConfig) {
    if (!prevConfig || !nextConfig || typeof storage.getRaw !== 'function') return
    Promise.resolve()
      .then(() => storage.getRaw())
      .then((settings) => {
        if (!settings || !settings.bucket || !settings.secretId || !settings.secretKey) return
        const keys = orphanKeys(settings, prevConfig, nextConfig)
        return keys.reduce(
          (chain, key) =>
            chain.then(() =>
              cos.deleteObject(settings, key).catch((e) => {
                log.error('[cos] delete replaced object failed:', key, e.code || e.message)
              })
            ),
          Promise.resolve()
        )
      })
      .catch((e) => log.error('[cos] cleanup replaced objects failed:', e.code || e.message))
  }

  router.use('/admin', (req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })

  router.post(
    '/admin/login',
    wrap(async (req, res) => {
      if (!limitLogin(req.ip || 'unknown')) throw rateLimited()

      const password = req.body && req.body.password
      if (typeof password !== 'string' || !password) throw invalidBody('请输入密码')
      if (!auth.checkPassword(password)) throw apiError('UNAUTHORIZED', '密码不正确', 401)

      res.cookie(auth.COOKIE_NAME, auth.issue(), auth.cookieOptions())
      res.json({ ok: true })
    })
  )

  router.post('/admin/logout', (req, res) => {
    auth.clearCookie(res)
    res.json({ ok: true })
  })

  router.get('/admin/session', (req, res) => {
    res.json({ authenticated: auth.isAuthenticated(req) })
  })

  router.get(
    '/admin/config',
    auth.requireAuth,
    wrap(async (req, res) => {
      const current = await store.get()
      res.json({
        config: current.config,
        updatedAt: current.updatedAt,
        source: current.source,
        storage: db.mode
      })
    })
  )

  router.put(
    '/admin/config',
    auth.requireAuth,
    wrap(async (req, res) => {
      // 上一版配置用于回收被替换的二维码/背景图；读取失败不阻断保存
      let previous = null
      try {
        previous = await store.get()
      } catch (e) {
        previous = null
      }
      let saved = null
      try {
        // baseUpdatedAt 由后台在载入配置时记录；不一致返回 409，避免并发保存互相覆盖
        saved = await store.save(req.body, {
          expectedUpdatedAt: req.body && req.body.baseUpdatedAt
        })
      } catch (error) {
        if (error.code === 'DB_UNAVAILABLE') throw dbUnavailable()
        throw error
      }
      // 配置保存原先没有审计：误操作（清空环境音、关掉同步）无法追溯。
      if (db.logAdminAction) {
        try {
          const config = saved.config || {}
          await db.logAdminAction('admin_config_save', '-', {
            version: config.version,
            audioCount: (config.audio || []).length,
            backgroundCount: (config.backgrounds || []).length,
            defaultBackgroundId: config.defaultBackgroundId || '',
            features: config.features || {}
          })
        } catch (e) {
          log.error('[audit] admin_config_save failed:', e.message)
        }
      }
      res.json({
        config: saved.config,
        updatedAt: saved.updatedAt,
        source: saved.source,
        storage: db.mode
      })
      // 响应已发出：旧对象回收放到后台，失败不影响本次保存
      removeReplacedUploads(previous && previous.config, saved.config)
    })
  )

  router.get(
    '/admin/stats',
    auth.requireAuth,
    wrap(async (req, res) => {
      try {
        res.json(await db.adminStats(now()))
      } catch (e) {
        log.error('[db] adminStats failed:', req.id || '', e.message)
        throw dbUnavailable()
      }
    })
  )

  router.get(
    '/admin/analytics',
    auth.requireAuth,
    wrap(async (req, res) => {
      try {
        res.json(await analytics.overview(now()))
      } catch (e) {
        log.error('[db] analytics failed:', req.id || '', e.message)
        throw dbUnavailable()
      }
    })
  )

  // 审计读取：此前只写不读，误操作无法在后台对账
  router.get(
    '/admin/audit',
    auth.requireAuth,
    wrap(async (req, res) => {
      if (!db.readAdminAudit) {
        throw apiError('NOT_SUPPORTED', '当前存储不支持审计读取', 501)
      }
      let items = []
      try {
        items = await db.readAdminAudit(req.query && req.query.limit)
      } catch (e) {
        throw dbUnavailable()
      }
      res.json({ items })
    })
  )

  // 客服/合规：按 openid 精确查询与删除。openid 不写入日志，只记录哈希前缀。
  router.get(
    '/admin/users/:openid',
    auth.requireAuth,
    wrap(async (req, res) => {
      const openid = readOpenid(req.params.openid)
      let records = []
      let unlockExpireAt = 0
      let eventCount = 0
      let erasedAt = 0
      let deletedDayCount = 0
      try {
        records = await db.getRecords(openid)
        unlockExpireAt = db.getUnlock ? await db.getUnlock(openid) : 0
        eventCount = db.countEvents ? await db.countEvents(openid) : 0
        erasedAt = db.getErasure ? await db.getErasure(openid) : 0
        deletedDayCount = db.getRecordDeletions
          ? (await db.getRecordDeletions(openid)).length
          : 0
      } catch (e) {
        log.error('[db] admin user query failed:', req.id || '', e.message)
        throw dbUnavailable()
      }
      records.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
      res.json({
        openid,
        count: records.length,
        records,
        unlockExpireAt,
        eventCount,
        erasedAt,
        deletedDayCount
      })
    })
  )

  router.delete(
    '/admin/users/:openid/records',
    auth.requireAuth,
    wrap(async (req, res) => {
      const openid = readOpenid(req.params.openid)
      const current = now()
      let result = null
      try {
        // fail-closed：能力缺失时不能假装写入了 erasure 水位，
        // 否则面板会展示“已清除”，但用户下次同步仍会把记录全部传回来。
        if (!db.eraseUserData) {
          throw apiError('NOT_SUPPORTED', '当前存储不支持全量清除', 501)
        }
        result = await db.eraseUserData(openid, current)
      } catch (e) {
        if (e && e.status) throw e
        log.error('[db] admin user erase failed:', req.id || '', e.message)
        throw dbUnavailable()
      }
      const tag = openidTag(openid)
      const audit = {
        requestId: req.id || '',
        deletedRecords: result.records,
        deletedUnlocks: result.unlocks,
        deletedEvents: result.events,
        erasedAt: result.erasedAt
      }
      log.log(
        JSON.stringify(
          Object.assign(
            {
              level: 'warn',
              action: 'admin_delete_user_data',
              openidTag: tag
            },
            audit
          )
        )
      )
      // 审计落库，容器日志轮转后仍可追溯；失败不阻断删除结果。
      if (db.logAdminAction) {
        try {
          await db.logAdminAction('admin_delete_user_data', tag, audit)
        } catch (e) {
          log.error('[audit] admin_delete_user_data failed:', e.message)
        }
      }
      res.json({
        openid,
        deleted: result.records,
        deletedUnlocks: result.unlocks,
        deletedEvents: result.events,
        erasedAt: result.erasedAt
      })
    })
  )

  // 只读环境状态：告诉运营“哪些配置在 .env、是否已就绪”，不返回任何密钥值。
  // 密钥仍只存在服务器环境变量里，后台不接收、不落库。
  router.get(
    '/admin/env',
    auth.requireAuth,
    wrap(async (req, res) => {
      const wx = (config && config.wx) || {}
      res.json({
        nodeEnv: (config && config.nodeEnv) || 'development',
        dbMode: (config && config.dbMode) || '',
        trustProxy: Number(config && config.trustProxy) || 0,
        appidConfigured: !!wx.appid,
        secretConfigured: !!wx.secret,
        reminderTemplateId: wx.reminderTemplateId || ''
      })
    })
  )

  router.get(
    '/admin/storage',
    auth.requireAuth,
    wrap(async (req, res) => {
      res.json(await storage.getPublic())
    })
  )

  router.put(
    '/admin/storage',
    auth.requireAuth,
    wrap(async (req, res) => {
      res.json(await storage.save(req.body))
    })
  )

  router.post(
    '/admin/storage/test',
    auth.requireAuth,
    wrap(async (req, res) => {
      const settings = await storage.getRaw()
      if (!settings || !settings.bucket || !settings.secretKey) {
        throw apiError('STORAGE_NOT_CONFIGURED', 'COS 配置还不完整', 400)
      }
      try {
        await cos.testBucket(settings)
      } catch (error) {
        log.error('[cos] test failed:', error.code || error.message)
        throw apiError('STORAGE_TEST_FAILED', '连接 COS 失败，请检查 Bucket / Region / 密钥 / 权限', 400)
      }
      res.json({ ok: true, bucket: settings.bucket, region: settings.region })
    })
  )

  router.post(
    '/admin/audio/upload',
    auth.requireAuth,
    gateUpload,
    upload.single('file'),
    wrap(async (req, res) => {
      if (!req.file) throw invalidBody('没有收到音频文件')

      const settings = await storage.getRaw()
      if (!settings || !settings.bucket || !settings.secretId || !settings.secretKey) {
        throw apiError('STORAGE_NOT_CONFIGURED', '请先在“存储与上传”里配置 COS', 400)
      }

      const prefix = (settings.prefix || 'sleep').replace(/^\/+|\/+$/g, '')
      const key =
        (prefix ? prefix + '/' : '') +
        Date.now() +
        '-' +
        crypto.randomBytes(4).toString('hex') +
        '.' +
        fileExtension(req.file)

      try {
        await cos.uploadBuffer(settings, {
          key,
          buffer: req.file.buffer,
          contentType: /^audio\//.test(req.file.mimetype || '') ? req.file.mimetype : 'audio/mpeg'
        })
      } catch (error) {
        log.error('[cos] upload failed:', error.code || error.message)
        throw apiError('UPLOAD_FAILED', '上传失败，请检查 COS 配置与权限', 502)
      }

      const title = String(req.body.title || path.basename(req.file.originalname || '', path.extname(req.file.originalname || '')))
        .trim()
        .slice(0, 30)

      auditUpload('admin_audio_upload', { key, size: req.file.size, title })
      res.json({
        key,
        url: cos.objectUrl(settings, key),
        size: req.file.size,
        title: title || '新环境音',
        category: String(req.body.category || '环境音').slice(0, 12)
      })
    })
  )

  // 首页背景图上传：只接受图片，5MB 上限，进 COS 的 backgrounds/ 前缀
  router.post(
    '/admin/backgrounds/upload',
    auth.requireAuth,
    gateUpload,
    imageUpload.single('file'),
    wrap(async (req, res) => {
      if (!req.file) throw invalidBody('没有收到图片文件')

      const settings = await storage.getRaw()
      if (!settings || !settings.bucket || !settings.secretId || !settings.secretKey) {
        throw apiError('STORAGE_NOT_CONFIGURED', '请先在“存储与上传”里配置 COS', 400)
      }

      const prefix = (settings.prefix || 'sleep').replace(/^\/+|\/+$/g, '')
      const key =
        (prefix ? prefix + '/' : '') +
        'backgrounds/bg-' +
        Date.now() +
        '-' +
        crypto.randomBytes(4).toString('hex') +
        '.' +
        imageExtension(req.file)

      try {
        await cos.uploadBuffer(settings, {
          key,
          buffer: req.file.buffer,
          contentType: IMAGE_TYPES[req.file.mimetype] || 'image/jpeg'
        })
      } catch (error) {
        log.error('[cos] background upload failed:', error.code || error.message)
        throw apiError('UPLOAD_FAILED', '上传失败，请检查 COS 配置与权限', 502)
      }

      auditUpload('admin_background_upload', { key, size: req.file.size })
      res.json({
        key,
        url: cos.objectUrl(settings, key),
        size: req.file.size
      })
    })
  )

  // 落地页小程序码上传：只接受图片，5MB 上限，进 COS 的 site/ 前缀
  // 返回 URL 后由后台填入 config.site.mpQrCodeUrl，随“保存并生效”一起下发
  router.post(
    '/admin/site/qrcode',
    auth.requireAuth,
    gateUpload,
    imageUpload.single('file'),
    wrap(async (req, res) => {
      if (!req.file) throw invalidBody('没有收到图片文件')

      const settings = await storage.getRaw()
      if (!settings || !settings.bucket || !settings.secretId || !settings.secretKey) {
        throw apiError('STORAGE_NOT_CONFIGURED', '请先在“存储与上传”里配置 COS', 400)
      }

      const prefix = (settings.prefix || 'sleep').replace(/^\/+|\/+$/g, '')
      const key =
        (prefix ? prefix + '/' : '') +
        'site/mp-qr-' +
        Date.now() +
        '-' +
        crypto.randomBytes(4).toString('hex') +
        '.' +
        imageExtension(req.file)

      try {
        await cos.uploadBuffer(settings, {
          key,
          buffer: req.file.buffer,
          contentType: IMAGE_TYPES[req.file.mimetype] || 'image/png'
        })
      } catch (error) {
        log.error('[cos] qrcode upload failed:', error.code || error.message)
        throw apiError('UPLOAD_FAILED', '上传失败，请检查 COS 配置与权限', 502)
      }

      auditUpload('admin_site_qrcode_upload', { key, size: req.file.size })
      res.json({
        key,
        url: cos.objectUrl(settings, key),
        size: req.file.size
      })
    })
  )

  return router
}

module.exports = { createAdminRoute }
