function apiError(code, message, status) {
  const error = new Error(message)
  error.code = code
  error.status = status || 400
  return error
}

function invalidBody(message) {
  return apiError('INVALID_BODY', message || '请求参数不合法', 400)
}

function invalidCode(message) {
  return apiError('INVALID_CODE', message || '登录凭证无效', 401)
}

function payloadTooLarge(message) {
  return apiError('PAYLOAD_TOO_LARGE', message || '数据量超出限制', 413)
}

function rateLimited() {
  return apiError('RATE_LIMITED', '操作太频繁，稍后再试', 429)
}

function featureOff(message) {
  return apiError('FEATURE_OFF', message || '功能暂未开放', 403)
}

function dbUnavailable() {
  return apiError('DB_UNAVAILABLE', '数据库暂时不可用', 503)
}

module.exports = {
  apiError,
  invalidBody,
  invalidCode,
  payloadTooLarge,
  rateLimited,
  featureOff,
  dbUnavailable
}
