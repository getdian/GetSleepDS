const crypto = require('crypto')
const path = require('path')
const express = require('express')
const multer = require('multer')

const { wrap } = require('../lib/http')
const { rateLimited, invalidBody, apiError, dbUnavailable } = require('../lib/errors')
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
  const { auth, store, db, storage, analytics, limitLogin, now, logger } = options
  const log = logger || console
  const router = express.Router()
  const upload = createUploader()
  const imageUpload = createImageUploader()

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
      let saved = null
      try {
        saved = await store.save(req.body)
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
    })
  )

  router.get(
    '/admin/stats',
    auth.requireAuth,
    wrap(async (req, res) => {
      try {
        res.json(await db.adminStats(now()))
      } catch (e) {
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
        throw dbUnavailable()
      }
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
