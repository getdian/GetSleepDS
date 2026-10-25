const test = require('node:test')
const assert = require('node:assert/strict')

const { normalizeQueueMode, nextTrackInQueue } = require('../miniprogram/utils/player-queue')

const tracks = [
  { id: 'a', title: '雨声' },
  { id: 'b', title: '风声' },
  { id: 'c', title: '壁炉' }
]

test('默认/未知模式统一归一为单曲循环', () => {
  assert.equal(normalizeQueueMode(undefined), 'single')
  assert.equal(normalizeQueueMode('list'), 'single')
  assert.equal(normalizeQueueMode('favorites'), 'favorites')
})

test('单曲循环模式不出队列', () => {
  assert.equal(nextTrackInQueue(tracks, 'a', ['a', 'b'], 'single'), null)
})

test('收藏连播按收藏列表循环取下一首', () => {
  assert.equal(nextTrackInQueue(tracks, 'a', ['a', 'b'], 'favorites').id, 'b')
  assert.equal(nextTrackInQueue(tracks, 'b', ['a', 'b'], 'favorites').id, 'a')
})

test('收藏不足 2 首时回退单曲循环', () => {
  assert.equal(nextTrackInQueue(tracks, 'a', ['a'], 'favorites'), null)
  assert.equal(nextTrackInQueue(tracks, 'a', [], 'favorites'), null)
})

test('当前曲目不在收藏里（刚取消收藏）从第一首开始', () => {
  assert.equal(nextTrackInQueue(tracks, 'c', ['a', 'b'], 'favorites').id, 'a')
})

test('配置里已下架的收藏 id 会被过滤', () => {
  assert.equal(nextTrackInQueue(tracks, 'a', ['a', 'gone'], 'favorites'), null)
  assert.equal(nextTrackInQueue(tracks, 'a', ['a', 'gone', 'b'], 'favorites').id, 'b')
})
