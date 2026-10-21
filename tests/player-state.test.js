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

test('claimEnded 同一轮只放行一个组件', () => {
  assert.equal(playerState.claimEnded(), true)
  // audio-dock 与 now-playing 会收到同一个 ended，第二个必须让出处理权
  assert.equal(playerState.claimEnded(), false)
})

test('claimEnded 超过去重窗口后可再次接管', () => {
  const originalNow = Date.now
  let now = originalNow() + 10000
  Date.now = () => now
  try {
    assert.equal(playerState.claimEnded(), true)
    assert.equal(playerState.claimEnded(), false)
    now += 900
    assert.equal(playerState.claimEnded(), true)
  } finally {
    Date.now = originalNow
  }
})
