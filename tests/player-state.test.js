const test = require('node:test')
const assert = require('node:assert/strict')

const playerState = require('../miniprogram/utils/player-state')

test('回退标记只对同一 URL 生效', () => {
  playerState.markFallback('https://cdn.example.com/a.mp3')
  assert.equal(playerState.isFallbacking('https://cdn.example.com/a.mp3'), true)
  assert.equal(playerState.isFallbacking('https://cdn.example.com/b.mp3'), false)
  assert.equal(playerState.isFallbacking(), true)

  playerState.clearFallback()
  assert.equal(playerState.isFallbacking(), false)
})

test('回退标记不会永久残留', () => {
  const originalNow = Date.now
  let now = 1000
  Date.now = () => now
  try {
    playerState.markFallback('https://cdn.example.com/a.mp3')
    now += 9000
    assert.equal(playerState.isFallbacking('https://cdn.example.com/a.mp3'), false)
  } finally {
    Date.now = originalNow
    playerState.clearFallback()
  }
})
