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

function intEnv(value, fallback, name, min, max) {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(name + ' 必须是 ' + min + '–' + max + ' 的整数')
  }
  return parsed
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

  const rawDbMode = source.DB_MODE
    ? String(source.DB_MODE).trim().toLowerCase()
    : source.DATABASE_URL
      ? 'postgres'
      : 'memory'
  if (rawDbMode !== 'memory' && rawDbMode !== 'postgres') {
    throw new Error('DB_MODE 只能是 memory 或 postgres，当前为：' + source.DB_MODE)
  }
  const dbMode = rawDbMode
  if (isProd && dbMode === 'memory' && source.ALLOW_MEMORY_DB !== '1') {
    throw new Error('生产环境不允许使用内存数据库（如确需请显式设置 ALLOW_MEMORY_DB=1）')
  }

  const ttlHours = intEnv(
    source.UNLOCK_TTL_HOURS,
    Number(file.unlock.ttlHours) || 24,
    'UNLOCK_TTL_HOURS',
    1,
    168
  )

  // 后台密码：只认显式环境变量。开发环境未设置时生成随机临时密码并打印，
  // 不再使用公开的 password123（否则可离线伪造后台 Cookie）。
  const configuredPassword = source.ADMIN_PASSWORD ? String(source.ADMIN_PASSWORD) : ''
  const generatedPassword = configuredPassword || generatePassword()
  const admin = {
    password: generatedPassword,
    secret: source.ADMIN_SECRET || configuredPassword || generatedPassword,
    generated: !configuredPassword,
    secureCookie: isProd
  }

  // COS 凭证加密密钥：只认显式 CONFIG_SECRET/ADMIN_SECRET/ADMIN_PASSWORD。
  // 临时随机密码每次启动都变，不能作为稳定加密密钥。
  const securityKey = source.CONFIG_SECRET || admin.secret
  const securityReady = !!(source.CONFIG_SECRET || source.ADMIN_SECRET || configuredPassword)

  if (isProd && !configuredPassword) {
    throw new Error('生产环境必须配置 ADMIN_PASSWORD，不能依赖启动期临时密码')
  }

  const trustProxy = intEnv(source.TRUST_PROXY, 0, 'TRUST_PROXY', 0, 10)
  if (isProd && trustProxy === 0) {
    // 仓库部署方案是 1Panel/nginx 反代；不信任代理时 req.ip 恒为代理地址，
    // 所有用户会共用同一个限流桶（erase 3/min、qrcode 3/min、登录 5/min）。
    // 不阻断启动（避免已有部署因漏配置直接不可用），但必须显式告警。
    console.warn(
      '[config] TRUST_PROXY=0 且当前为生产环境：若前面有反向代理，所有用户会共用同一限流桶，请在 .env 设置 TRUST_PROXY=1'
    )
  }

  return {
    nodeEnv,
    port: intEnv(source.PORT, 3000, 'PORT', 1, 65535),
    trustProxy,
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
      maxUnlockPerIp: intEnv(source.RATE_UNLOCK_IP, 60, 'RATE_UNLOCK_IP', 1, 100000),
      maxUnlockPerOpenid: intEnv(source.RATE_UNLOCK_OPENID, 5, 'RATE_UNLOCK_OPENID', 1, 100000),
      maxSummaryPerIp: intEnv(source.RATE_SUMMARY_IP, 30, 'RATE_SUMMARY_IP', 1, 100000)
    },
    app: {
      version: file.version,
      audio: file.audio,
      ads: file.ads,
      backgrounds: file.backgrounds,
      defaultBackgroundId: file.defaultBackgroundId,
      backgroundUnlockHours: file.backgroundUnlockHours,
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
