const { test } = require('node:test')
const assert = require('node:assert/strict')

const FF = require('../miniprogram/utils/feedback-form')

test('反馈类型与服务端白名单一致（SUGGEST/MUSIC/ISSUE）', () => {
  assert.deepEqual(
    FF.TYPES.map((item) => item.key),
    ['SUGGEST', 'MUSIC', 'ISSUE']
  )
  assert.equal(FF.DEFAULT_TYPE, 'SUGGEST')
  assert.equal(FF.MAX_CONTENT, 500)
  assert.equal(FF.MAX_CONTACT, 64)
})

test('isType/typeOf 只认白名单', () => {
  assert.equal(FF.isType('MUSIC'), true)
  assert.equal(FF.isType('music'), false)
  assert.equal(FF.isType('SPAM'), false)
  assert.equal(FF.typeOf('ISSUE').label, '问题反馈')
  assert.equal(FF.typeOf('SPAM'), null)
})

test('空内容或纯空白不能提交', () => {
  const result = FF.buildPayload({ type: 'SUGGEST', content: '   \n\t ', contact: '' })
  assert.equal(result.ok, false)
  assert.equal(result.error, '写点什么再提交吧')
  assert.equal(FF.canSubmit({ type: 'SUGGEST', content: '' }), false)
})

test('首尾空白被裁掉，正文中间的换行保留', () => {
  const result = FF.buildPayload({
    type: 'ISSUE',
    content: '  第一行\n第二行  ',
    contact: ''
  })
  assert.equal(result.ok, true)
  assert.equal(result.payload.content, '第一行\n第二行')
})

test('控制字符被清除', () => {
  const result = FF.buildPayload({ type: 'SUGGEST', content: 'a\u0000b\u0007c' })
  assert.equal(result.payload.content, 'abc')
})

test('正文超过 500 字被拒', () => {
  const result = FF.buildPayload({ type: 'SUGGEST', content: 'a'.repeat(501) })
  assert.equal(result.ok, false)
  assert.equal(result.error, '反馈最多 500 字')
  assert.equal(FF.buildPayload({ type: 'SUGGEST', content: 'a'.repeat(500) }).ok, true)
})

test('联系方式换行压成空格且可留空', () => {
  const withContact = FF.buildPayload({
    type: 'MUSIC',
    content: '想听雨声',
    contact: ' wx:abc\nmail@x.com '
  })
  assert.equal(withContact.payload.contact, 'wx:abc mail@x.com')

  const empty = FF.buildPayload({ type: 'MUSIC', content: '想听雨声' })
  assert.equal(empty.payload.contact, '')
})

test('联系方式超过 64 字被拒', () => {
  const result = FF.buildPayload({
    type: 'SUGGEST',
    content: '正文',
    contact: 'x'.repeat(65)
  })
  assert.equal(result.ok, false)
  assert.equal(result.error, '联系方式最多 64 字')
})

test('未知类型回落默认类型（页面只会传 chips 的 key）', () => {
  const result = FF.buildPayload({ type: 'SPAM', content: '正文' })
  assert.equal(result.ok, true)
  assert.equal(result.payload.type, 'SUGGEST')
})

test('counterText 与服务端 500 字上限同口径', () => {
  assert.equal(FF.counterText(''), '0/500')
  assert.equal(FF.counterText('12345'), '5/500')
  assert.equal(FF.counterText(null), '0/500')
})
