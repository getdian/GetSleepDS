const { apiBase } = require('../config/env')

/**
 * wx.request 的 Promise 封装。
 * 失败时返回带 code 的 Error，页面据此决定降级策略。
 */
function request(options) {
  const method = options.method || 'GET'
  return new Promise((resolve, reject) => {
    wx.request({
      url: apiBase + options.path,
      method,
      data: options.data || {},
      timeout: options.timeout || 8000,
      header: {
        'content-type': 'application/json'
      },
      success(res) {
        const body = res.data
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body)
          return
        }
        const error = new Error((body && body.error && body.error.message) || '请求失败')
        error.status = res.statusCode
        error.code = body && body.error ? body.error.code : 'HTTP_' + res.statusCode
        reject(error)
      },
      fail(err) {
        const error = new Error('网络不可用')
        error.code = 'NETWORK'
        error.detail = err && err.errMsg
        reject(error)
      }
    })
  })
}

module.exports = { request }
