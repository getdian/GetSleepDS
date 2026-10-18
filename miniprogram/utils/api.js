const { request } = require('./request')

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

function syncRecords(code, records) {
  return request({
    path: '/api/records/sync',
    method: 'POST',
    data: { code, records },
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

module.exports = {
  fetchConfig,
  unlockAudio,
  fetchSummary,
  syncRecords,
  eraseRecords,
  trackEvents
}
