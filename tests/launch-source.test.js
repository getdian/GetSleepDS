const test = require('node:test')
const assert = require('node:assert/strict')

const { launchSourceOf } = require('../miniprogram/utils/launch-source')

test('转发打开：scene + 打开页 + from 参数', () => {
  assert.equal(
    launchSourceOf({ scene: 1007, path: '/pages/index/index', query: { from: 'share' } }),
    '1007|pages/index/index|share'
  )
})

test('朋友圈单页打开：from=timeline', () => {
  assert.equal(
    launchSourceOf({ scene: 1154, path: '/pages/index/index', query: { from: 'timeline' } }),
    '1154|pages/index/index|timeline'
  )
})

test('普通启动：没有 from 参数时省略', () => {
  assert.equal(
    launchSourceOf({ scene: 1001, path: '/pages/index/index', query: {} }),
    '1001|pages/index/index'
  )
})

test('异常输入兜底', () => {
  assert.equal(launchSourceOf(null), '0')
  assert.equal(launchSourceOf(undefined), '0')
  assert.equal(launchSourceOf({}), '0')
  assert.equal(launchSourceOf({ scene: 1001 }), '1001')
})

test('总长不超过服务端 target 上限 64 字符', () => {
  const long = launchSourceOf({
    scene: 1007,
    path: '/pages/index/index',
    query: { from: 'x'.repeat(60) }
  })
  assert.ok(long.length <= 64)
  assert.ok(long.startsWith('1007|pages/index/index|'))
})
