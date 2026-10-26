/**
 * 完成态「每日一句」纯函数：
 * 同一天恒定、相邻天换句、整轮不重句、非法日期回落 null（页面用固定文案兜底）。
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const Q = require('../miniprogram/utils/sleep-quotes')

const DAY_MS = 24 * 60 * 60 * 1000

function pad2(n) {
  return n < 10 ? '0' + n : String(n)
}

function keyAfter(key, days) {
  const parts = key.split('-').map(Number)
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]) + days * DAY_MS)
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate())
}

test('语录库：每条都有正文与出处，长度可控', () => {
  assert.ok(Q.QUOTES.length >= 12, '语录太少会频繁撞句')
  Q.QUOTES.forEach((q) => {
    assert.ok(q.text && q.text.length >= 4, q.text)
    // 一行约 20 字，超过就会折三行、把页脚撑高
    assert.ok(q.text.length <= 24, '过长会折行：' + q.text)
    assert.ok(q.source && q.source.length >= 4, q.text)
  })
})

test('语录库：不预设夜间（白天补觉/午休/跨时区醒来同样成立）', () => {
  Q.QUOTES.forEach((q) => {
    const all = q.text + q.source
    assert.ok(!/今晚|今夜|夜色|晚安|昨夜|明早/.test(all), all)
  })
})

test('每日一句：同一天恒定，相邻两天必须换句', () => {
  const a = Q.quoteOf('2026-10-22')
  const b = Q.quoteOf('2026-10-22')
  assert.deepEqual(a, b)
  assert.notEqual(a.text, Q.quoteOf('2026-10-23').text)
})

test('每日一句：整轮不重句，一轮之后回到同一句', () => {
  const start = '2026-03-01'
  const seen = []
  for (let i = 0; i < Q.QUOTES.length; i += 1) {
    const q = Q.quoteOf(keyAfter(start, i))
    assert.ok(q, '第 ' + i + ' 天没有语录')
    seen.push(q.text)
  }
  assert.equal(new Set(seen).size, Q.QUOTES.length, '一轮内不应重复')
  assert.equal(Q.quoteOf(keyAfter(start, Q.QUOTES.length)).text, seen[0], '一轮后应回到第一句')
})

test('每日一句：跨月/跨年连续换句，不出现空档', () => {
  const edge = ['2026-01-31', '2026-02-01', '2026-12-31', '2027-01-01']
  edge.forEach((key, i) => {
    const q = Q.quoteOf(key)
    assert.ok(q && q.text, key)
    if (i > 0) assert.notEqual(q.text, Q.quoteOf(edge[i - 1]).text, key)
  })
})

test('每日一句：非法日期返回 null，交给页面回落固定文案', () => {
  assert.equal(Q.quoteOf(''), null)
  assert.equal(Q.quoteOf(null), null)
  assert.equal(Q.quoteOf(undefined), null)
  assert.equal(Q.quoteOf('abc'), null)
  assert.equal(Q.quoteOf('2026-1'), null)
  assert.equal(Q.quoteOf('2026-13-01'), null)
  assert.equal(Q.quoteOf('2026-02-31'), null)
})

test('每日一句：返回副本，页面改动不会污染语录库', () => {
  const q = Q.quoteOf('2026-10-22')
  q.text = '被改掉了'
  assert.notEqual(Q.quoteOf('2026-10-22').text, '被改掉了')
})
