const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const CONFIG_FILE = path.join(__dirname, '..', '..', 'config', 'app.config.json')
const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

function readAppConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
}

function generatePassword() {
  const bytes = crypto.randomBytes(12)
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) {
    out += PASSWORD_ALPHABET[bytes[i] % PASSWORD_ALPHABET.length]
  }
  return out
}

/**
 * 读取配置并做启动期校验。
 * 生产环境宁可起不来，也不要带着假登录或内存库上线。
 */
function loadConfig(env) {
  const source = env || process.env
  const nodeEnv = source.NODE_ENV || 'development'
  const isProd = nodeEnv === 'production'
  const file = readAppConfig()

  const allowDevLogin = source.ALLOW_DEV_LOGIN === '1'
  if (isProd && allowDevLogin) {
    throw new Error('ALLOW_DEV_LOGIN 不允许在生产环境开启')
  }

  const appid = source.WX_APPID || ''
  const secret = source.WX_SECRET || ''
  if (isProd && (!appid || !secret)) {
    throw new Error('生产环境必须配置 WX_APPID 和 WX_SECRET')
  }

  const dbMode = source.DB_MODE || (source.DATABASE_URL ? 'postgres' : 'memory')
  if (isProd && dbMode === 'memory' && source.ALLOW_MEMORY_DB !== '1') {
    throw new Error('生产环境不允许使用内存数据库（如确需请显式设置 ALLOW_MEMORY_DB=1）')
  }

  const ttlHours = Number(source.UNLOCK_TTL_HOURS || file.unlock.ttlHours || 24)

  // 后台密码：优先环境变量；开发环境未设置时默认使用 password123；生产环境必须显式设置
  const configuredPassword = source.ADMIN_PASSWORD
    ? String(source.ADMIN_PASSWORD)
    : (isProd ? '' : 'password123')
  const admin = {
    password: configuredPassword || generatePassword(),
    secret: source.ADMIN_SECRET || configuredPassword,
    generated: !source.ADMIN_PASSWORD && !configuredPassword,
    secureCookie: isProd
  }
  if (!admin.secret) admin.secret = admin.password

  // COS 凭证加密密钥：优先 CONFIG_SECRET；否则退化为后台密码相关密钥。
  // 后台密码若是每次启动随机生成，则不具备稳定密钥，禁止保存 COS 凭证。
  const securityKey = source.CONFIG_SECRET || admin.secret
  const securityReady = !!(source.CONFIG_SECRET || source.ADMIN_SECRET || configuredPassword)

  if (isProd && !configuredPassword) {
    throw new Error('生产环境必须配置 ADMIN_PASSWORD，不能依赖启动期临时密码')
  }

  return {
    nodeEnv,
    port: Number(source.PORT || 3000),
    trustProxy: Number(source.TRUST_PROXY || 0),
    dbMode,
    databaseUrl: source.DATABASE_URL || '',
    wx: {
      appid,
      secret,
      allowDevLogin: !isProd && allowDevLogin
    },
    unlockTtlHours: ttlHours,
    admin,
    security: { key: securityKey, ready: securityReady },
    rateLimit: {
      windowMs: 60 * 1000,
      maxUnlockPerIp: Number(source.RATE_UNLOCK_IP || 60),
      maxUnlockPerOpenid: Number(source.RATE_UNLOCK_OPENID || 5),
      maxSummaryPerIp: Number(source.RATE_SUMMARY_IP || 30)
    },
    app: {
      version: file.version,
      audio: file.audio,
      features: file.features,
      cache: file.cache,
      copy: file.copy,
      unlock: Object.assign({}, file.unlock, {
        ttlHours,
        adUnitId: source.AD_UNIT_ID || file.unlock.adUnitId
      })
    }
  }
}

module.exports = { loadConfig }
