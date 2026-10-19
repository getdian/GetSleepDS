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

test('背景图分类去重且带“全部”', () => {
  assert.deepEqual(B.categories(B.normalize(CONFIG.backgrounds)), ['全部', '山川', '夜色'])
})
