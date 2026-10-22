const test = require('node:test')
const assert = require('node:assert/strict')

const F = require('../miniprogram/utils/format')

function at(hour, minute = 0) {
  return new Date(2026, 9, 20, hour, minute, 0, 0).getTime()
}

test('daypartOf 四段按本地时区：5/11/18/23 边界', () => {
  assert.equal(F.daypartOf(at(0)), 'late')
  assert.equal(F.daypartOf(at(4, 59)), 'late')
  assert.equal(F.daypartOf(at(5)), 'morning')
  assert.equal(F.daypartOf(at(10, 59)), 'morning')
  assert.equal(F.daypartOf(at(11)), 'day')
  assert.equal(F.daypartOf(at(17, 59)), 'day')
  assert.equal(F.daypartOf(at(18)), 'evening')
  assert.equal(F.daypartOf(at(22, 59)), 'evening')
  assert.equal(F.daypartOf(at(23)), 'late')
  assert.equal(F.daypartOf(at(23, 59)), 'late')
})

test('时段标签覆盖凌晨/早晨/上午/中午/下午/傍晚/晚上边界', () => {
  assert.equal(F.periodLabel(at(0)), '凌晨')
  assert.equal(F.periodLabel(at(4, 59)), '凌晨')
  assert.equal(F.periodLabel(at(5)), '早晨')
  assert.equal(F.periodLabel(at(8, 59)), '早晨')
  assert.equal(F.periodLabel(at(9)), '上午')
  assert.equal(F.periodLabel(at(11, 59)), '上午')
  assert.equal(F.periodLabel(at(12)), '中午')
  assert.equal(F.periodLabel(at(13, 59)), '中午')
  assert.equal(F.periodLabel(at(14)), '下午')
  assert.equal(F.periodLabel(at(17, 59)), '下午')
  assert.equal(F.periodLabel(at(18)), '傍晚')
  assert.equal(F.periodLabel(at(19, 59)), '傍晚')
  assert.equal(F.periodLabel(at(20)), '晚上')
  assert.equal(F.periodLabel(at(23, 59)), '晚上')
})
