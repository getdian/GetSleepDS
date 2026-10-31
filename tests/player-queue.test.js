const test = require('node:test')
const assert = require('node:assert/strict')

const {
  normalizeQueueMode,
  queueIdsOf,
  resolveQueueIds,
  nextInQueue,
  nextTrackInList,
  nextTrackManual
} = require('../miniprogram/utils/player-queue')

const tracks = [
  { id: 'a', title: '雨声' },
  { id: 'b', title: '风声' },
  { id: 'c', title: '壁炉' }
]

test('播放模式只有单曲与列表；历史 favorites 归一到列表循环', () => {
  assert.equal(normalizeQueueMode(undefined), 'single')
  assert.equal(normalizeQueueMode(''), 'single')
  assert.equal(normalizeQueueMode('single'), 'single')
  assert.equal(normalizeQueueMode('list'), 'list')
  assert.equal(normalizeQueueMode('favorites'), 'list')
})

test('队列快照：过滤非法项、去重、保持可见顺序', () => {
  const list = [{ id: 'b' }, { id: 'a' }, { id: 'b' }, { id: '' }, null, { title: '无 id' }]
  assert.deepEqual(queueIdsOf(list), ['b', 'a'])
  assert.deepEqual(queueIdsOf(null), [])
})

test('队列兜底：有快照用快照，无快照回退全部音源', () => {
  // 老版本“收藏连播”升级 / 从未点播过：列表循环在非入睡页也必须有队列
  assert.deepEqual(resolveQueueIds(tracks, ['c', 'a']), ['c', 'a'])
  assert.deepEqual(resolveQueueIds(tracks, undefined), ['a', 'b', 'c'])
  assert.deepEqual(resolveQueueIds(tracks, []), ['a', 'b', 'c'])
  // 快照里的空值不算数：全部为空同样回退
  assert.deepEqual(resolveQueueIds(tracks, ['', null]), ['a', 'b', 'c'])
})

test('列表循环：按队列快照顺序走，末尾回到第一首', () => {
  assert.equal(nextInQueue(tracks, 'a', ['c', 'a', 'b']).id, 'b')
  assert.equal(nextInQueue(tracks, 'b', ['c', 'a', 'b']).id, 'c')
  assert.equal(nextInQueue(tracks, 'c', ['c', 'a', 'b']).id, 'a')
})

test('列表循环：当前曲目不在快照里（换分类后点播）从第一首开始', () => {
  assert.equal(nextInQueue(tracks, 'b', ['c', 'a']).id, 'c')
})

test('列表循环：快照不足 2 首时返回 null，调用方回退单曲', () => {
  assert.equal(nextInQueue(tracks, 'a', ['a']), null)
  assert.equal(nextInQueue(tracks, 'a', []), null)
  assert.equal(nextInQueue(tracks, 'a', undefined), null)
})

test('列表循环：配置里已下架的 id 被过滤，剩不足 2 首同样回退单曲', () => {
  assert.equal(nextInQueue(tracks, 'a', ['a', 'gone']), null)
  assert.equal(nextInQueue(tracks, 'a', ['a', 'gone', 'b']).id, 'b')
})

test('手动下一首兜底：按配置列表循环，末尾回到第一首', () => {
  assert.equal(nextTrackInList(tracks, 'a').id, 'b')
  assert.equal(nextTrackInList(tracks, 'b').id, 'c')
  assert.equal(nextTrackInList(tracks, 'c').id, 'a')
})

test('手动下一首兜底：少于 2 首返回 null（提示只有一个音源）', () => {
  assert.equal(nextTrackInList([{ id: 'a' }], 'a'), null)
  assert.equal(nextTrackInList([], 'a'), null)
  assert.equal(nextTrackInList(null, 'a'), null)
})

test('手动下一首兜底：当前曲目不在配置里（已下架）从第一首开始', () => {
  assert.equal(nextTrackInList(tracks, 'gone').id, 'a')
})

test('手动下一首统一口径：列表循环优先快照，单曲模式按配置列表', () => {
  assert.equal(nextTrackManual(tracks, 'a', ['a', 'c'], 'list').id, 'c')
  assert.equal(nextTrackManual(tracks, 'a', ['a', 'c'], 'single').id, 'b')
  // 快照不足两首：退化成列表下一首，而不是“没反应”
  assert.equal(nextTrackManual(tracks, 'a', ['a'], 'list').id, 'b')
  // 历史 favorites 模式按列表循环处理
  assert.equal(nextTrackManual(tracks, 'a', ['a', 'c'], 'favorites').id, 'c')
})
