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

/** 环境音收藏人数（展示值 = 后台人气基数 + 真实收藏） */
function fetchAudioFavorites() {
  return request({ path: '/api/audio/favorites', timeout: 6000 })
}

/** 收藏 / 取消收藏，返回该曲目最新展示值 */
function setAudioFavorite(code, trackId, on) {
  return request({
    path: '/api/audio/favorite',
    method: 'POST',
    data: { code, trackId, on: !!on },
    timeout: 6000
  })
}

/** 背景图使用次数（展示值 = 后台人气基数 + 真实累计） */
function fetchBackgroundUses() {
  return request({ path: '/api/backgrounds/uses', timeout: 6000 })
}

/** 记录一次背景使用，返回该背景最新展示值 */
function trackBackgroundUse(code, bgId) {
  return request({
    path: '/api/backgrounds/use',
    method: 'POST',
    data: { code, bgId },
    timeout: 6000
  })
}

function syncRecords(code, records, deletedDays, includeAll) {
  return request({
    path: '/api/records/sync',
    method: 'POST',
    data: {
      code,
      records,
      deletedDays: deletedDays || [],
      includeAll: includeAll !== false
    },
    timeout: 12000
  })
}

function createReminder(code, sessionId, fireAt) {
  return request({
    path: '/api/reminders',
    method: 'POST',
    data: { code, action: 'create', sessionId, fireAt },
    timeout: 8000
  })
}

function cancelReminder(code, sessionId) {
  return request({
    path: '/api/reminders',
    method: 'POST',
    data: { code, action: 'cancel', sessionId },
    timeout: 8000
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

function submitFeedback(code, payload) {
  const data = Object.assign({ code }, payload || {})
  return request({
    path: '/api/feedback',
    method: 'POST',
    data,
    timeout: 10000
  })
}

function eraseRecords(code, options) {
  return request({
    path: '/api/records/erase',
    method: 'POST',
    data: { code, cloudOnly: !!(options && options.cloudOnly) },
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
  fetchAudioFavorites,
  setAudioFavorite,
  fetchBackgroundUses,
  trackBackgroundUse,
  syncRecords,
  createReminder,
  cancelReminder,
  eraseRecords,
  trackEvents,
  submitFeedback,
  fetchPosterQr
}
