const test = require('node:test')
const assert = require('node:assert/strict')

const fallback = require('../miniprogram/config/fallback')
const seed = require('../server/config/app.config.json')

test('客户端 fallback 音频 URL 与服务端种子一致', () => {
  assert.ok(fallback.audio.length > 0)
  assert.ok(seed.audio.length > 0)
  assert.equal(fallback.audio[0].url, seed.audio[0].url)
  assert.match(fallback.audio[0].url, /^https:\/\/img\.qfmaster\.com\//)
})
