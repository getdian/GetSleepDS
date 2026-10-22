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
  page._alive = true
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

test('脚注打开 90 分钟说明弹层，关闭/页面隐藏后收起', () => {
  const page = makePage()
  assert.equal(page.data.whyOpen, false)

  page.openWhy()
  assert.equal(page.data.whyOpen, true, '点脚注应打开说明')
  page.closeWhy()
  assert.equal(page.data.whyOpen, false, '点遮罩/关闭应收起')

  page.openWhy()
  page.onHide()
  assert.equal(page.data.whyOpen, false, '切走页面时不能把弹层和隐藏的 tabBar 留在一起')
})

test('结果面追加 6 周期「补觉」档，5 周期仍是主推荐', () => {
  const originalNow = Date.now
  const evening = new Date(2026, 9, 22, 20, 0, 0, 0).getTime()
  Date.now = () => evening
  try {
    const page = makePage()
    page.setData({ mode: 'wake', wakeTime: '07:30', fallAsleep: 15 })
    page.calc(false)

    assert.equal(page.data.view.label, '推荐入睡时间')
    assert.equal(page.data.view.mainTime, '23:45', '主推荐仍是 5 个周期')
    const rows = page.data.view.rows
    const extra = rows[rows.length - 1]
    assert.equal(extra.cycles, 6)
    assert.equal(extra.time, '22:15')
    assert.equal(extra.extra, true)
    assert.equal(extra.guideLabel, '充足')
    assert.equal(rows.filter((row) => row.extra).length, 1, '补觉档只出现一次')

    // 23:00：6 周期已过 → 补觉档不渲染
    Date.now = () => new Date(2026, 9, 22, 23, 0, 0, 0).getTime()
    page.setData({ flipped: false })
    page.calc(false)
    assert.equal(page.data.view.rows.filter((row) => row.extra).length, 0)

    // 入睡模式：起床时刻在将来，始终给出 6 周期档
    Date.now = () => evening
    page.setData({ mode: 'sleep', sleepTime: '23:00', flipped: false })
    page.calc(false)
    const sleepRows = page.data.view.rows
    assert.equal(sleepRows[sleepRows.length - 1].cycles, 6)
    assert.equal(sleepRows[sleepRows.length - 1].time, '08:15')
  } finally {
    Date.now = originalNow
  }
})

test('入睡模式时间轮下写「今天 晚上 22:30 入睡」，不再显示当前时间', () => {
  const originalNow = Date.now
  const at = new Date(2026, 9, 22, 15, 31, 0, 0).getTime()
  Date.now = () => at
  try {
    const page = makePage()
    page.setData({ mode: 'sleep' })
    page.onTimeChange({ detail: { value: '22:30' } })
    assert.equal(page.data.sleepContext, '今天 晚上 22:30 入睡')
    assert.equal(page.data.nowText, undefined, 'nowText 已移除，提示不能再漂回“当前时刻”')

    page.onTimeChange({ detail: { value: '08:00' } })
    assert.equal(page.data.sleepContext, '明天 早晨 08:00 入睡', '已过 30 分钟宽限按次日，与结果面一致')
  } finally {
    Date.now = originalNow
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
