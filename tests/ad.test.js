const test = require('node:test')
const assert = require('node:assert/strict')

let created = 0
let destroyed = 0

function makeAd() {
  created += 1
  return {
    onLoad() {},
    onError() {},
    onClose() {},
    offLoad() {},
    offError() {},
    offClose() {},
    show() {
      return Promise.resolve()
    },
    load() {
      return Promise.resolve()
    },
    destroy() {
      destroyed += 1
    }
  }
}

global.wx = {
  createRewardedVideoAd: makeAd
}

const ad = require('../miniprogram/utils/ad')

test('激励视频广告位 ID 变化会重建实例', () => {
  assert.equal(ad.init('adunit-a'), true)
  assert.equal(ad.init('adunit-a'), true)
  assert.equal(created, 1)

  assert.equal(ad.init('adunit-b'), true)
  assert.equal(created, 2)
  assert.equal(destroyed, 1)
})
