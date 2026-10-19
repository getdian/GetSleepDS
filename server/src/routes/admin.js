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

function createAdminRoute(options) {
  const { auth, store, db, storage, analytics, limitLogin, now, logger } = options
  const log = logger || console
  const router = express.Router()
  const upload = createUploader()

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
      try {
        records = await db.getRecords(openid)
      } catch (e) {
        throw dbUnavailable()
      }
      records.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
      res.json({ openid, count: records.length, records })
    })
  )

  router.delete(
    '/admin/users/:openid/records',
    auth.requireAuth,
    wrap(async (req, res) => {
      const openid = readOpenid(req.params.openid)
      let result = null
      try {
        result = db.deleteUserData
          ? await db.deleteUserData(openid)
          : { records: await db.deleteRecords(openid), unlocks: 0, events: 0 }
      } catch (e) {
        throw dbUnavailable()
      }
      log.log(
        JSON.stringify({
          level: 'warn',
          action: 'admin_delete_user_data',
          requestId: req.id || '',
          openidTag: openidTag(openid),
          deleted: result.records,
          unlocks: result.unlocks,
          events: result.events
        })
      )
      res.json({
        openid,
        deleted: result.records,
        deletedUnlocks: result.unlocks,
        deletedEvents: result.events
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

  return router
}

module.exports = { createAdminRoute }
