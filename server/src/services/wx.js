const { invalidCode, apiError } = require('../lib/errors')

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
    response = await fetchImpl(url)
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

module.exports = { codeToOpenid }
