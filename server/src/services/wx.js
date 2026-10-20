const { invalidCode, apiError } = require('../lib/errors')

function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms)
  }
  return undefined
}

// access_token 进程内缓存：单实例口径，与限流/配置缓存一致
const tokenCache = { key: '', token: '', expiresAt: 0 }

/**
 * 获取接口调用凭证。优先 stable_token：多次获取不会互相顶掉旧 token，
 * 与线上其他使用同一 AppSecret 的服务并存时是安全的。
 */
async function getAccessToken(options) {
  const config = options || {}
  const appid = config.appid || ''
  const secret = config.secret || ''
  if (!appid || !secret) {
    throw apiError('WX_NOT_CONFIGURED', '微信接口未配置 AppSecret', 503)
  }

  const nowMs = Date.now()
  if (tokenCache.key === appid && tokenCache.token && nowMs < tokenCache.expiresAt) {
    return tokenCache.token
  }

  const fetchImpl = config.fetchImpl || globalThis.fetch
  let data = null
  try {
    const response = await fetchImpl('https://api.weixin.qq.com/cgi-bin/stable_token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credential', appid, secret }),
      signal: timeoutSignal(8000)
    })
    data = await response.json()
  } catch (e) {
    data = null
  }

  if (!data || !data.access_token) {
    console.error('[wx] stable_token failed:', data ? data.errcode : 'network')
    throw apiError('WX_UNAVAILABLE', '微信服务暂时不可用', 503)
  }

  tokenCache.key = appid
  tokenCache.token = data.access_token
  // 过期前 5 分钟刷新，避免边界请求失败
  tokenCache.expiresAt = nowMs + (Number(data.expires_in) || 7200) * 1000 - 5 * 60 * 1000
  return tokenCache.token
}

/**
 * 获取不数量限制的小程序码（getwxacodeunlimit），返回 PNG Buffer。
 * scene ≤32 字符；小程序未发布 / page 不合法时接口报错，调用方应自行降级。
 */
async function getUnlimitedQrCode(options, scene, page) {
  const config = options || {}
  const token = await getAccessToken(config)

  const fetchImpl = config.fetchImpl || globalThis.fetch
  let response = null
  try {
    response = await fetchImpl(
      'https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=' + encodeURIComponent(token),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scene: String(scene || '').slice(0, 32), page, check_path: false, width: 280 }),
        signal: timeoutSignal(8000)
      }
    )
  } catch (e) {
    throw apiError('WX_UNAVAILABLE', '微信服务暂时不可用', 503)
  }

  if (!response.ok) {
    throw apiError('WX_UNAVAILABLE', '微信服务暂时不可用', 503)
  }

  const contentType = response.headers.get('content-type') || ''
  if (contentType.indexOf('application/json') >= 0) {
    let data = null
    try {
      data = await response.json()
    } catch (e) {
      data = null
    }
    console.error('[wx] getwxacodeunlimit failed:', data ? data.errcode : 'unknown')
    throw apiError('WX_QR_FAILED', '小程序码生成失败，请确认小程序已发布', 502)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (!buffer.length) {
    throw apiError('WX_QR_FAILED', '小程序码生成失败', 502)
  }
  return buffer
}

/**
 * code2session：code 只在服务端使用，openid 不下发给前端。
 * 开发环境可开启 allowDevLogin，避免本地必须配置真实 AppSecret。
 */
async function codeToOpenid(code, options) {
  const config = options || {}

  if (typeof code !== 'string' || !code || code.length > 128) {
    throw invalidCode()
  }

  if (config.allowDevLogin) {
    // 本地开发固定一个 openid，方便反复联调同一条数据
    return 'dev_openid'
  }

  const appid = config.appid || ''
  const secret = config.secret || ''
  if (!appid || !secret) {
    throw apiError('WX_NOT_CONFIGURED', '微信登录未配置', 503)
  }

  const url =
    'https://api.weixin.qq.com/sns/jscode2session?appid=' +
    encodeURIComponent(appid) +
    '&secret=' +
    encodeURIComponent(secret) +
    '&js_code=' +
    encodeURIComponent(code) +
    '&grant_type=authorization_code'

  const fetchImpl = config.fetchImpl || globalThis.fetch
  let response = null

  try {
    response = await fetchImpl(url, { signal: timeoutSignal(8000) })
  } catch (e) {
    throw apiError('WX_UNAVAILABLE', '微信服务暂时不可用', 503)
  }

  if (!response.ok) {
    throw apiError('WX_UNAVAILABLE', '微信服务暂时不可用', 503)
  }

  let data = null
  try {
    data = await response.json()
  } catch (e) {
    data = null
  }

  if (!data || !data.openid) {
    throw invalidCode()
  }

  return data.openid
}

module.exports = { codeToOpenid, getAccessToken, getUnlimitedQrCode }
