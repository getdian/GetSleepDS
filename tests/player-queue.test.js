const test = require('node:test')
const assert = require('node:assert/strict')

const {
  normalizeQueueMode,
  nextTrackInQueue,
  nextTrackInList,
  nextTrackManual
} = require('../miniprogram/utils/player-queue')

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

test('手动下一首：按配置列表循环，末尾回到第一首', () => {
  assert.equal(nextTrackInList(tracks, 'a').id, 'b')
  assert.equal(nextTrackInList(tracks, 'b').id, 'c')
  assert.equal(nextTrackInList(tracks, 'c').id, 'a')
})

test('手动下一首：少于 2 首返回 null（按钮提示只有一个音源）', () => {
  assert.equal(nextTrackInList([{ id: 'a' }], 'a'), null)
  assert.equal(nextTrackInList([], 'a'), null)
  assert.equal(nextTrackInList(null, 'a'), null)
})

test('手动下一首：当前曲目不在配置里（已下架）从第一首开始', () => {
  assert.equal(nextTrackInList(tracks, 'gone').id, 'a')
})

test('手动下一首统一口径：收藏连播优先收藏队列，单曲模式回退列表', () => {
  assert.equal(nextTrackManual(tracks, 'a', ['a', 'c'], 'favorites').id, 'c')
  assert.equal(nextTrackManual(tracks, 'a', ['a', 'c'], 'single').id, 'b')
  // 收藏不足两首：退化成列表下一首，而不是“没反应”
  assert.equal(nextTrackManual(tracks, 'a', ['a'], 'favorites').id, 'b')
})
