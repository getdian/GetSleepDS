const express = require('express')
const { wrap } = require('../lib/http')
const { apiError, invalidBody, rateLimited, dbUnavailable, featureOff } = require('../lib/errors')

// 三类诉求：功能建议 / 想听的音乐 / 遇到的问题。
// 与小程序 utils/feedback-form.js 的 TYPES 必须一字不差地同步（客户端只做展示与预校验，
// 服务端才是权威校验；两边任一侧改名都会让提交被 400 拒绝）。
const TYPES = ['SUGGEST', 'MUSIC', 'ISSUE']
const MAX_CONTENT = 500
const MAX_CONTACT = 64

// 去掉控制字符（保留换行/制表）：反馈内容是纯文本，后台按 textContent 渲染，
// 但仍然要清掉 \u0000 这类会破坏 JSON/数据库的字符。
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

function cleanText(value) {
  if (typeof value !== 'string') return ''
  return value.replace(CONTROL_RE, '').trim()
}

function cleanContact(value) {
  return cleanText(value).replace(/[\r\n\t]+/g, ' ')
}

function createFeedbackRoute(options) {
  const { config, db, codeToOpenid, limitIp, limitOpenid, now, store, logger } = options
  const log = logger || console
  const router = express.Router()

  router.post(
    '/feedback',
    wrap(async (req, res) => {
      if (!limitIp(req.ip || 'unknown')) throw rateLimited()

      // 服务端总闸：运营在后台关掉后，客户端入口也会隐藏；这里仍然是权威拦截，
      // 避免旧版本客户端继续写入（与 /records/sync 的 features.sync 同口径）。
      if (store) {
        const current = await store.get()
        const features = (current.config && current.config.features) || {}
        if (features.feedback === false) throw featureOff('反馈入口暂未开放')
      }

      const body = req.body || {}
      // 参数校验全部前置：不为坏请求换取 openid（code 是一次性凭证，换错就废）。
      const type = typeof body.type === 'string' ? body.type.trim().toUpperCase() : ''
      if (TYPES.indexOf(type) < 0) throw invalidBody('反馈类型不合法')

      const content = cleanText(body.content)
      if (!content) throw invalidBody('请先写下你的想法')
      if (content.length > MAX_CONTENT) throw invalidBody('反馈最多 ' + MAX_CONTENT + ' 字')

      const contact = cleanContact(body.contact)
      if (contact.length > MAX_CONTACT) throw invalidBody('联系方式最多 ' + MAX_CONTACT + ' 字')

      const openid = await codeToOpenid(body.code, config.wx)
      // 反代漏配 TRUST_PROXY 时 IP 桶会全站共用，按 openid 再补一层（与 erase 同款）
      if (limitOpenid && !limitOpenid(openid)) throw rateLimited()

      if (!db.insertFeedback) {
        throw apiError('NOT_SUPPORTED', '当前存储不支持反馈提交', 501)
      }

      let saved = null
      try {
        saved = await db.insertFeedback(openid, {
          type,
          content,
          contact,
          createdAt: now()
        })
      } catch (e) {
        log.error('[db] feedback insert failed:', req.id || '', e.message)
        throw dbUnavailable()
      }

      res.status(201).json({ id: saved.id, createdAt: saved.createdAt })
    })
  )

  return router
}

module.exports = { createFeedbackRoute, TYPES, MAX_CONTENT, MAX_CONTACT }
