const test = require('node:test')
const assert = require('node:assert/strict')

const store = {}
global.wx = {
  getStorageSync(key) {
    return store[key] === undefined ? '' : store[key]
  },
  setStorageSync(key, value) {
    store[key] = JSON.parse(JSON.stringify(value))
  },
  removeStorageSync(key) {
    delete store[key]
  }
}

const storage = require('../miniprogram/utils/storage')

test('音频收藏本地切换与去重', () => {
  assert.deepEqual(storage.getFavorites(), [])
  assert.deepEqual(storage.toggleFavorite('rain'), ['rain'])
  assert.deepEqual(storage.toggleFavorite('wave'), ['rain', 'wave'])
  assert.deepEqual(storage.toggleFavorite('rain'), ['wave'])
  assert.deepEqual(storage.getFavorites(), ['wave'])
})

test('清除全部个人数据会移除收藏与偏好', () => {
  storage.setPrefs({ wakeTime: '07:00' })
  storage.toggleFavorite('rain')
  storage.clearAll()
  assert.deepEqual(storage.getFavorites(), [])
  assert.deepEqual(storage.getPrefs(), {})
  assert.equal(storage.getPending(), null)
})
