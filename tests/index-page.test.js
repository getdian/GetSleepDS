/**
 * 计算器页面级回归：
 * 1) 结果面调整「入睡耗时」不能重置计算锚点（否则跨过 30 分钟宽限后整组推荐静默推后一天）；
 * 2) 跨日推荐必须写出「明天」，不能只给「早晨」让用户读成今天。
 */
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
  },
  showToast() {},
  showModal() {},
  vibrateShort() {},
  switchTab() {},
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

require('../miniprogram/pages/index/index')

const backgrounds = require('../miniprogram/utils/backgrounds')
const storage = require('../miniprogram/utils/storage')

function makePage() {
  const page = Object.assign({}, config)
  page.data = JSON.parse(JSON.stringify(config.data))
  page.setData = function setData(patch, cb) {
    Object.assign(this.data, patch)
    if (typeof cb === 'function') cb()
  }
  page.selectComponent = () => null
  page._anchorAt = 0
  return page
}

// 凌晨 2:00：01:00 已过 30 分钟宽限 → 入睡时刻顺延到明天
const NOW = new Date(2026, 9, 22, 2, 0, 0, 0).getTime()

test('结果面改入睡耗时不清计算锚点（防止推荐静默推后一天）', () => {
  const originalNow = Date.now
  Date.now = () => NOW
  try {
    const page = makePage()
    page.setData({ mode: 'sleep', flipped: true, sleepTime: '01:00', fallAsleep: 15 })
    page._anchorAt = NOW

    page.onFallAsleepTap({ currentTarget: { dataset: { min: 20 } } })
    assert.equal(page.data.fallAsleep, 20)
    assert.equal(page._anchorAt, NOW, '改耗时不换计算会话的“现在”')

    page.cycleFall()
    assert.notEqual(page.data.fallAsleep, 20)
    assert.equal(page._anchorAt, NOW, '结果面循环耗时同样不能清锚点')
  } finally {
    Date.now = originalNow
  }
})

test('切换付费背景前提示剩余时长，确认后才覆盖解锁', () => {
  storage.setBackgroundUnlock(null)
  backgrounds.unlock('bg-a', 24)
  const page = makePage()
  page.setData({
    bgUnlockHours: 24,
    backgrounds: [
      { id: 'bg-a', title: 'A', url: 'https://img.example.com/a.jpg' },
      { id: 'bg-b', title: 'B', url: 'https://img.example.com/b.jpg' }
    ]
  })
  const originalModal = global.wx.showModal
  let modal = null
  global.wx.showModal = (options) => {
    modal = options
  }
  try {
    page.onBgSelect({ detail: { id: 'bg-b' } })
    assert.ok(modal, '切到另一张背景前必须确认')
    assert.equal(modal.title, '切换背景？')
    assert.match(modal.content, /还剩/)
    // 取消：原解锁保留
    modal.success({ confirm: false })
    assert.equal(backgrounds.getUnlocked().id, 'bg-a')
    // 确认：才覆盖为 bg-b
    page.onBgSelect({ detail: { id: 'bg-b' } })
    assert.equal(modal.title, '切换背景？')
    modal.success({ confirm: true })
    assert.equal(backgrounds.getUnlocked().id, 'bg-b')
  } finally {
    global.wx.showModal = originalModal
    storage.setBackgroundUnlock(null)
  }
})

test('凌晨跨日：推荐写成「明天 早晨」，note 保留日期前缀', () => {
  const originalNow = Date.now
  Date.now = () => NOW
  try {
    const page = makePage()
    page.setData({ mode: 'sleep', sleepTime: '01:00', fallAsleep: 15 })
    page.calc(true)

    const view = page.data.view
    assert.ok(view, '结果面必须生成')
    assert.equal(view.mainTime, '08:45')
    assert.match(view.mainDay, /^明天 /, '跨日推荐必须带日期，不能只有时段词')
    assert.match(view.note, /明天 01:00 上床/, 'late 分支也要保留日期')
  } finally {
    Date.now = originalNow
  }
})
