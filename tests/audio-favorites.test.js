const test = require('node:test')
const assert = require('node:assert/strict')

const fav = require('../miniprogram/utils/audio-favorites')

test('收藏文案：0 人回落「点击播放」，万位缩写', () => {
  assert.equal(fav.formatFavText(0), '点击播放')
  assert.equal(fav.formatFavText(undefined), '点击播放')
  assert.equal(fav.formatFavText(-3), '点击播放')
  assert.equal(fav.formatFavText(713), '713 人收藏和喜欢')
  assert.equal(fav.formatFavText(9999), '9999 人收藏和喜欢')
  assert.equal(fav.formatFavText(12345), '1.2 万人收藏和喜欢')
  assert.equal(fav.formatFavText(98765), '9.9 万人收藏和喜欢')
})

test('合并计数：缺少下发值的曲目回落自己的基数，而不是 0', () => {
  const tracks = [
    { id: 'rain', favBase: 713 },
    { id: 'wave', favBase: 0 }
  ]
  const list = fav.mergeFavCounts(tracks, { rain: 715 })
  assert.equal(list[0].favCount, 715)
  assert.equal(list[0].favText, '715 人收藏和喜欢')
  assert.equal(list[1].favCount, 0)
  assert.equal(list[1].favText, '点击播放')
})

test('合并计数：非法值不污染展示', () => {
  const list = fav.mergeFavCounts([{ id: 'rain', favBase: 9 }], { rain: 'abc' })
  assert.equal(list[0].favCount, 9)
  const negative = fav.mergeFavCounts([{ id: 'rain', favBase: 9 }], { rain: -1 })
  assert.equal(negative[0].favCount, 9)
})

test('排序按收藏降序，同分保持配置顺序（稳定排序）', () => {
  const tracks = [
    { id: 'a', favCount: 5 },
    { id: 'b', favCount: 9 },
    { id: 'c', favCount: 5 },
    { id: 'd', favCount: 0 }
  ]
  const sorted = fav.sortByRank(tracks, fav.rankOf(tracks))
  assert.deepEqual(sorted.map((item) => item.id), ['b', 'a', 'c', 'd'])
  // 原数组不被就地修改：applyFilter 反复调用时不能把 data 里的顺序改掉
  assert.deepEqual(tracks.map((item) => item.id), ['a', 'b', 'c', 'd'])
})

test('排序快照与实时计数解耦：点收藏只改数字不跳位', () => {
  const tracks = [
    { id: 'a', favCount: 5 },
    { id: 'b', favCount: 9 }
  ]
  const rank = fav.rankOf(tracks)
  // 模拟用户收藏 a：数字 +1 后已超过 b，但快照未重建
  const after = tracks.map((item) => (item.id === 'a' ? Object.assign({}, item, { favCount: 10 }) : item))
  const sorted = fav.sortByRank(after, rank)
  assert.deepEqual(sorted.map((item) => item.id), ['b', 'a'], '未重排，避免刚点的那行当场跳走')
})
