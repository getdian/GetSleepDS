/**
 * 补记链路：统计页点空格子 → 写 meta.manualDay → 切入睡页 → 自动打开补记面板。
 * 用户反馈「点补记没有弹窗口」，这里用页面级桩把整条链跑一遍。
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const store = {}

global.wx = {
  env: { USER_DATA_PATH: 'wx-user-data' },
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
  showLoading() {},
  hideLoading() {},
  vibrateShort() {},
  switchTab() {},
  getBackgroundAudioManager() {
    return { stop() {}, pause() {} }
  },
  getFileSystemManager() {
    return { writeFile() {} }
  },
  createCanvasContext() {
    return { draw() {} }
  },
  getAccountInfoSync() {
    return { miniProgram: { envVersion: 'develop' } }
  }
}
global.getApp = () => ({ globalData: {} })
global.getCurrentPages = () => []

const storage = require('../miniprogram/utils/storage')

function resetStore() {
  Object.keys(store).forEach((key) => delete store[key])
  store[storage.KEYS.records] = {}
  store[storage.KEYS.deleted] = {}
}

/** 加载 sleep 页的 Page 配置 */
function loadSleepPage() {
  const configs = {}
  global.Page = (value) => {
    configs.sleep = value
  }
  delete require.cache[require.resolve('../miniprogram/pages/sleep/sleep')]
  require('../miniprogram/pages/sleep/sleep')
  return configs.sleep
}

function makeSleepPage() {
  const page = Object.assign({}, loadSleepPage())
  page.data = JSON.parse(JSON.stringify(loadSleepPage().data))
  page.setData = function setData(patch, cb) {
    Object.assign(this.data, patch)
    if (typeof cb === 'function') cb()
  }
  page._alive = true
  page._busy = false
  page._pending = null
  page._editingDay = ''
  page._editingSessionId = ''
  page._endBaseDay = 0
  page._endStartDay = 0
  page._endBedAt = 0
  page._endWakeAt = 0
  page.hideTabbarForSheet = () => {}
  return page
}

test('补记链路：统计页传入日期后，入睡页自动打开预填日期的补记面板', () => {
  resetStore()
  const page = makeSleepPage()
  page.setData({ state: 'idle', endShow: false })
  storage.patchMeta({ manualDay: '2026-10-18' })

  page.openPendingManual()

  assert.equal(storage.getMeta().manualDay, '', '日期必须被消费，避免重复弹窗')
  assert.equal(page.data.endShow, true, '补记面板必须自动打开')
  assert.equal(page.data.endMode, 'manual')
  assert.equal(page.data.endDate, '2026-10-18')
  assert.equal(page.data.endDateText, '10月18日')
  // 过去日期默认一整夜 23:00 → 07:00
  assert.equal(page.data.endBedTime, '23:00')
  assert.equal(page.data.endWakeTime, '07:00')
  assert.equal(page.data.endError, '')
})

test('补记链路：正在入睡中只提示，不抢结束面板', () => {
  resetStore()
  const page = makeSleepPage()
  page.setData({ state: 'sleeping', endShow: false })
  storage.patchMeta({ manualDay: '2026-10-18' })
  const original = global.wx.showToast
  let toast = ''
  global.wx.showToast = (options) => {
    toast = options.title
  }
  try {
    page.openPendingManual()
  } finally {
    global.wx.showToast = original
  }
  assert.equal(page.data.endShow, false)
  assert.match(toast, /结束后可补记/)
  assert.equal(storage.getMeta().manualDay, '', '日期仍然要消费掉')
})

test('补记链路：没有 manualDay 时什么都不做', () => {
  resetStore()
  const page = makeSleepPage()
  page.setData({ state: 'idle', endShow: false })
  page.openPendingManual()
  assert.equal(page.data.endShow, false)
})

test('统计页点补记：写入 meta.manualDay 并切到入睡页', () => {
  resetStore()
  const configs = {}
  global.Page = (value) => {
    configs.stats = value
  }
  delete require.cache[require.resolve('../miniprogram/pages/stats/stats')]
  require('../miniprogram/pages/stats/stats')
  const page = Object.assign({}, configs.stats)
  page.data = JSON.parse(JSON.stringify(configs.stats.data))
  page.setData = function setData(patch) {
    Object.assign(this.data, patch)
  }
  page._alive = true
  page._records = {}
  page._signature = ''

  const original = global.wx.switchTab
  let switched = ''
  global.wx.switchTab = (options) => {
    switched = options.url
  }
  try {
    page.onAddMissing({ currentTarget: { dataset: { day: '2026-10-18' } } })
  } finally {
    global.wx.switchTab = original
  }
  assert.equal(storage.getMeta().manualDay, '2026-10-18')
  assert.equal(switched, '/pages/sleep/sleep')
})
