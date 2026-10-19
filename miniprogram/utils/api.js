const { request } = require('./request')
const { apiBase } = require('../config/env')

function fetchConfig() {
  return request({ path: '/api/config' })
}

function unlockAudio(code) {
  return request({
    path: '/api/audio/unlock',
    method: 'POST',
    data: { code }
  })
}

function fetchSummary(records) {
  return request({
    path: '/api/summary',
    method: 'POST',
    data: { records }
  })
}

function syncRecords(code, records, deletedDays) {
  return request({
    path: '/api/records/sync',
    method: 'POST',
    data: { code, records, deletedDays: deletedDays || [] },
    timeout: 12000
  })
}

function trackEvents(code, events) {
  return request({
    path: '/api/events',
    method: 'POST',
    data: { code, events },
    timeout: 6000
  })
}

function eraseRecords(code) {
  return request({
    path: '/api/records/erase',
    method: 'POST',
    data: { code },
    timeout: 12000
  })
}

/**
 * 拉取海报用小程序码（PNG arraybuffer）。
 * 服务端失败时返回非 2xx，调用方按"没有码"降级，海报仍会生成。
 */
function fetchPosterQr(code) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: apiBase + '/api/share/qrcode?code=' + encodeURIComponent(code),
      method: 'GET',
      responseType: 'arraybuffer',
      timeout: 6000,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300 && res.data && res.data.byteLength) {
          resolve(res.data)
          return
        }
        const error = new Error('小程序码生成失败')
        error.status = res.statusCode
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

module.exports = {
  fetchConfig,
  unlockAudio,
  fetchSummary,
  syncRecords,
  eraseRecords,
  trackEvents,
  fetchPosterQr
}
