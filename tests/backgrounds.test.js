const test = require('node:test')
const assert = require('node:assert/strict')

const B = require('../miniprogram/utils/backgrounds')

const CONFIG = {
  backgrounds: [
    { id: 'a', title: '月光', category: '夜色', url: 'https://cdn.example.com/a.jpg', sort: 2, enabled: true },
    { id: 'b', title: '山川', category: '山川', url: 'https://cdn.example.com/b.jpg', sort: 1, enabled: true },
    { id: 'c', title: '禁用', category: '夜色', url: 'https://cdn.example.com/c.jpg', enabled: false }
  ],
  defaultBackgroundId: 'a'
}

test('背景图 normalize 过滤禁用项并按 sort 排序', () => {
  const list = B.normalize(CONFIG.backgrounds)
  assert.deepEqual(list.map((item) => item.id), ['b', 'a'])
})

test('默认背景按 id 查找，找不到回退第一张启用图', () => {
  assert.equal(B.defaultOf(CONFIG).id, 'a')
  assert.equal(B.defaultOf({ backgrounds: CONFIG.backgrounds, defaultBackgroundId: 'missing' }).id, 'b')
})

test('未解锁或过期回退默认，解锁中返回当前图', () => {
  const now = 1000
  assert.equal(B.activeOf(CONFIG, null, now).id, 'a')
  assert.equal(B.activeOf(CONFIG, { id: 'b', expireAt: 999 }, now).id, 'a')
  assert.equal(B.activeOf(CONFIG, { id: 'b', expireAt: 1001 }, now).id, 'b')
})

test('列表缩略图 URL 走 COS 图片处理，已有查询串时正确拼接', () => {
  assert.equal(
    B.thumbUrlOf('https://img.qfmaster.com/bg/a.jpg'),
    'https://img.qfmaster.com/bg/a.jpg?imageMogr2/thumbnail/360x'
  )
  assert.equal(
    B.thumbUrlOf('https://img.qfmaster.com/bg/a.jpg?v=2'),
    'https://img.qfmaster.com/bg/a.jpg?v=2&imageMogr2/thumbnail/360x'
  )
  assert.equal(B.thumbUrlOf('wxfile://a.jpg'), '')
  assert.equal(
    B.thumbUrlOf('https://img.qfmaster.com/bg/a.jpg?imageMogr2/thumbnail/200x'),
    'https://img.qfmaster.com/bg/a.jpg?imageMogr2/thumbnail/200x'
  )
})

test('背景图分类去重且带“全部”', () => {
  assert.deepEqual(B.categories(B.normalize(CONFIG.backgrounds)), ['全部', '山川', '夜色'])
})

test('使用次数文案：0 次回落「可随时更换」，万位缩写', () => {
  assert.equal(B.useTextOf(0), '可随时更换')
  assert.equal(B.useTextOf(undefined), '可随时更换')
  assert.equal(B.useTextOf(-3), '可随时更换')
  assert.equal(B.useTextOf(713), '已被使用 713 次')
  assert.equal(B.useTextOf(9999), '已被使用 9999 次')
  assert.equal(B.useTextOf(12345), '已被使用 1.2 万次')
})

test('使用次数 = 后台基数 + 真实使用；真实数缺失/非法按 0', () => {
  const items = [
    { id: 'a', useBase: 713 },
    { id: 'b', useBase: 0 }
  ]
  const merged = B.withUseCounts(items, { a: 2 })
  assert.equal(merged[0].useCount, 715)
  assert.equal(merged[0].useText, '已被使用 715 次')
  assert.equal(merged[1].useCount, 0)
  assert.equal(merged[1].useText, '可随时更换')

  const dirty = B.withUseCounts([{ id: 'a', useBase: 9 }], { a: 'abc' })
  assert.equal(dirty[0].useCount, 9)
  const negative = B.withUseCounts([{ id: 'a', useBase: 9 }], { a: -1 })
  assert.equal(negative[0].useCount, 9)

  // 调低基数立即跟随：合成取当前 useBase，不被旧展示值压住
  const low = B.withUseCounts([{ id: 'a', useBase: 10 }], { a: 2 })
  assert.equal(low[0].useCount, 12)
})

test('normalize 带出后台人气基数，缺失时按 0', () => {
  const list = B.normalize([
    { id: 'x', title: 'X', url: 'https://a.com/x.jpg', useBase: 713 },
    { id: 'y', title: 'Y', url: 'https://a.com/y.jpg' }
  ])
  assert.equal(list[0].useBase, 713)
  assert.equal(list[1].useBase, 0)
})
