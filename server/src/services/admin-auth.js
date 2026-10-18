const crypto = require('crypto')

const COOKIE_NAME = 'sleep_admin'
const TOKEN_VERSION = 'v1'
const SESSION_MS = 7 * 24 * 60 * 60 * 1000

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest()
}

/**
 * 单管理员会话：密码来自环境变量（未设置时启动期生成临时密码）。
 * Cookie 为 HttpOnly + SameSite=Strict，生产环境加 Secure。
 */
function createAdminAuth(options) {
  const password = String(options.password || '')
  const secret = String(options.secret || password)
  const secure = !!options.secureCookie

  if (!password) throw new Error('后台密码未配置')

  const passwordHash = sha256(password)

  function sign(exp) {
    return crypto
      .createHmac('sha256', secret)
      .update(TOKEN_VERSION + '.' + exp)
      .digest('hex')
  }

  function issue() {
    const exp = Date.now() + SESSION_MS
    return TOKEN_VERSION + '.' + exp + '.' + sign(exp)
  }

  function verify(token) {
    const parts = String(token || '').split('.')
    if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return false

    const exp = Number(parts[1])
    if (!Number.isFinite(exp) || exp < Date.now()) return false

    const expected = sign(exp)
    const actual = parts[2]
    if (actual.length !== expected.length) return false

    return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  }

  function checkPassword(input) {
    if (typeof input !== 'string' || !input) return false
    return crypto.timingSafeEqual(sha256(input), passwordHash)
  }

  function cookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'strict',
      secure,
      path: '/',
      maxAge: SESSION_MS
    }
  }

  function readToken(req) {
    const header = req.headers.cookie || ''
    const parts = header.split(';')
    for (let i = 0; i < parts.length; i += 1) {
      const index = parts[i].indexOf('=')
      if (index < 0) continue
      if (parts[i].slice(0, index).trim() === COOKIE_NAME) {
        return decodeURIComponent(parts[i].slice(index + 1).trim())
      }
    }
    return ''
  }

  function isAuthenticated(req) {
    return verify(readToken(req))
  }

  function requireAuth(req, res, next) {
    if (!isAuthenticated(req)) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: '请先登录' } })
      return
    }
    next()
  }

  function clearCookie(res) {
    res.clearCookie(COOKIE_NAME, { path: '/' })
  }

  return {
    COOKIE_NAME,
    issue,
    verify,
    checkPassword,
    cookieOptions,
    isAuthenticated,
    requireAuth,
    clearCookie
  }
}

module.exports = { createAdminAuth, COOKIE_NAME, SESSION_MS }
