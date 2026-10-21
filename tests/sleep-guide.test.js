const test = require('node:test')
const assert = require('node:assert/strict')

const G = require('../miniprogram/utils/sleep-guide')

test('5/4/3 个周期分别给出推荐、偏短、不足', () => {
  const ok = G.guidanceOf(5)
  assert.equal(ok.tone, 'ok')
  assert.equal(ok.label, '推荐')
  assert.equal(ok.note, '')
  assert.equal(ok.hours, 7.5)

  const short = G.guidanceOf(4)
  assert.equal(short.tone, 'short')
  assert.equal(short.label, '偏短')
  assert.equal(short.hours, 6)
  assert.match(short.note, /6 小时/)
  assert.match(short.note, /7–9 小时/)

  const low = G.guidanceOf(3)
  assert.equal(low.tone, 'low')
  assert.equal(low.label, '不足')
  assert.equal(low.hours, 4.5)
  assert.match(low.note, /4\.5 小时/)
  assert.match(low.note, /明显不足/)
  assert.match(low.note, /仅作极限参考/)
})

test('文案按真实时长生成，周期档位变化不会写死旧数字', () => {
  const tenHalf = G.guidanceOf(7)
  assert.equal(tenHalf.tone, 'long')
  assert.equal(tenHalf.label, '偏长')
  assert.match(tenHalf.note, /10\.5 小时/)
  assert.match(tenHalf.note, /高于成人 7–9 小时建议/)
  assert.doesNotMatch(tenHalf.note, /低于/)

  const two = G.guidanceOf(2)
  assert.equal(two.tone, 'low')
  assert.match(two.note, /3 小时/)
  assert.doesNotMatch(two.note, /4\.5 小时/)

  assert.equal(G.guidanceOf(6).tone, 'ok')
  assert.equal(G.guidanceOf(6).hours, 9)
})

test('晚睡判定覆盖 01:00–05:59', () => {
  const at = (hour, minute = 0) => new Date(2026, 9, 20, hour, minute, 0, 0).getTime()
  assert.equal(G.isLateNight(at(0, 59)), false)
  assert.equal(G.isLateNight(at(1, 0)), true)
  assert.equal(G.isLateNight(at(5, 59)), true)
  assert.equal(G.isLateNight(at(6, 0)), false)
  assert.ok(G.lateNote().indexOf('REM') >= 0)
})
