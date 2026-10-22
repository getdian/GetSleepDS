/**
 * 统计页页面级回归：切月必须真正重渲染。
 *
 * 为什么需要它：refresh 用签名去重跳过 setData（省掉整块日历过桥），
 * 而空月之间的「格子数 + 色阶序列」完全相同。签名若不含月份，
 * 按 ‹ 后标题/格子/canNextMonth 全部不更新，且 monthOffset 已变 → 双向卡死。
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const store = {}

global.wx = {
  // audio-cache 在模块顶层读取该路径
  env: { USER_DATA_PATH: '/tmp/sleep-test' },
  getStorageSync(key) {
    return store[key] === undefined ? '' : store[key]
  },
  setStorageSync(key, value) {
    store[key] = JSON.parse(JSON.stringify(value))
  },
  removeStorageSync(key) {
    delete store[key]
  },
  showToast() {},
  showModal() {},
  vibrateShort() {},
  getAccountInfoSync() {
    return { miniProgram: { envVersion: 'develop' } }
  }
}
global.getApp = () => ({ globalData: {} })
global.getCurrentPages = () => []

let config = null
global.Page = (value) => {
  config = value
}

require('../miniprogram/pages/stats/stats')

const storage = require('../miniprogram/utils/storage')

function resetStore() {
  Object.keys(store).forEach((key) => delete store[key])
  store[storage.KEYS.records] = {}
  store[storage.KEYS.deleted] = {}
}

function makePage() {
  const page = Object.assign({}, config)
  page.data = JSON.parse(JSON.stringify(config.data))
  page.setData = function setData(patch, cb) {
    Object.assign(this.data, patch)
    if (typeof cb === 'function') cb()
  }
  page._alive = true
  page._records = {}
  page._signature = ''
  return page
}

// 2026-10-22 10:00：10 月 35 格（周四开月），9 月也是 35 格 —— 空月签名冲突的典型月份
const NOW = new Date(2026, 9, 22, 10, 0, 0, 0).getTime()

test('切月：空月之间也必须重渲染（签名含 monthOffset / monthKey）', () => {
  const originalNow = Date.now
  Date.now = () => NOW
  try {
    resetStore()
    const page = makePage()
    page.refresh()
    assert.equal(page.data.calendarTitle, '2026年10月')
    assert.equal(page.data.canNextMonth, false)

    page.onMonthPrev()
    assert.equal(page.data.monthOffset, -1)
    assert.equal(page.data.calendarTitle, '2026年9月', '空月切月不能被签名去重吞掉')
    assert.equal(page.data.canNextMonth, true, '翻到历史月后必须能回来')
    assert.ok(page.data.calendarCells.length > 0)

    page.onMonthNext()
    assert.equal(page.data.monthOffset, 0)
    assert.equal(page.data.calendarTitle, '2026年10月')
    assert.equal(page.data.canNextMonth, false)
  } finally {
    Date.now = originalNow
  }
})
