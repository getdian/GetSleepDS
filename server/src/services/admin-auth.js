const crypto = require('crypto')

const COOKIE_NAME = 'sleep_admin'
// v2 起令牌携带「凭据版本」：改密码后版本变化，旧 Cookie 立即失效（无需重启/改 secret）。
// v1 令牌在升级后一次性失效，管理员需重新登录一次。
const TOKEN_VERSION = 'v2'
const SESSION_MS = 7 * 24 * 60 * 60 * 1000
const SCRYPT_KEYLEN = 64
const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 64

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest()
}

function scryptHex(password, salt) {
  return crypto.scryptSync(String(password), String(salt), SCRYPT_KEYLEN).toString('hex')
}

/**
 * 生成一条可入库的凭据：scrypt + 随机盐，version 单调递增（每次改密 +1）。
 * 只存 salt/hash/version/updatedAt，任何地方都不落明文。
 */
function makeCredential(password, version, updatedAt) {
  const salt = crypto.randomBytes(16).toString('hex')
  return {
    salt,
    hash: scryptHex(password, salt),
    version: Math.max(1, Number(version) || 1),
    updatedAt: Number(updatedAt) || Date.now()
  }
}

/** 校验密码与凭据是否匹配（scrypt 定长 hex，timingSafeEqual 前先比长度） */
function verifyCredential(password, credential) {
  if (!credential || !credential.salt || !credential.hash) return false
  const actual = Buffer.from(scryptHex(password, credential.salt), 'hex')
  const expected = Buffer.from(String(credential.hash), 'hex')
  if (actual.length !== expected.length) return false
  try {
    return crypto.timingSafeEqual(actual, expected)
  } catch (e) {
    return false
  }
}

/**
 * 单管理员会话。
 * - 密码来源：数据库凭据（options.credentials）优先；没有时才回退环境变量密码（首次引导）。
 *   一旦落库，env 密码不再可用——否则轮换后 env 会变成永久后门。
 * - Cookie 为 HttpOnly + SameSite=Strict，生产环境加 Secure。
 */
function createAdminAuth(options) {
  const envPassword = String(options.password || '')
  const secret = String(options.secret || envPassword)
  const secure = !!options.secureCookie
  let credentials =
    options.credentials && options.credentials.hash && options.credentials.salt
      ? options.credentials
      : null

  if (!credentials && !envPassword) throw new Error('后台密码未配置')

  const envHash = sha256(envPassword)

  function credentialVersion() {
    return credentials ? Number(credentials.version) || 0 : 0
  }

  function sign(version, exp) {
    return crypto
      .createHmac('sha256', secret)
      .update(TOKEN_VERSION + '.' + version + '.' + exp)
      .digest('hex')
  }

  function issue() {
    const version = credentialVersion()
    const exp = Date.now() + SESSION_MS
    return TOKEN_VERSION + '.' + version + '.' + exp + '.' + sign(version, exp)
  }

  function verify(token) {
    const parts = String(token || '').split('.')
    if (parts.length !== 4 || parts[0] !== TOKEN_VERSION) return false
    // 凭据版本不匹配 = 改过密码（或换了凭据来源），旧令牌一律作废
    if (parts[1] !== String(credentialVersion())) return false

    const exp = Number(parts[2])
    if (!Number.isFinite(exp) || exp < Date.now()) return false

    const expected = sign(parts[1], exp)
    const actual = parts[3]
    // 比较字节长度，而不是 JS 字符串长度：多字节字符长度相等时字节长度可能不同，
    // timingSafeEqual 会抛 RangeError 并让鉴权接口 500。
    const actualBuffer = Buffer.from(actual, 'utf8')
    const expectedBuffer = Buffer.from(expected, 'utf8')
    if (actualBuffer.length !== expectedBuffer.length) return false

    try {
      return crypto.timingSafeEqual(actualBuffer, expectedBuffer)
    } catch (e) {
      return false
    }
  }

  function checkPassword(input) {
    if (typeof input !== 'string' || !input) return false
    if (credentials) return verifyCredential(input, credentials)
    return crypto.timingSafeEqual(sha256(input), envHash)
  }

  function setCredentials(next) {
    credentials = next && next.hash && next.salt ? next : null
  }

  /** 'db' = 已落库（env 密码不再可用）；'env' = 首次引导 */
  function credentialSource() {
    return credentials ? 'db' : 'env'
  }

  function credentialUpdatedAt() {
    return credentials ? Number(credentials.updatedAt) || 0 : 0
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
        try {
          return decodeURIComponent(parts[i].slice(index + 1).trim())
        } catch (e) {
          return ''
        }
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
    setCredentials,
    credentialSource,
    credentialUpdatedAt,
    credentialVersion,
    cookieOptions,
    isAuthenticated,
    requireAuth,
    clearCookie
  }
}

module.exports = {
  createAdminAuth,
  makeCredential,
  verifyCredential,
  COOKIE_NAME,
  SESSION_MS,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH
}
