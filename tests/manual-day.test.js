/**
 * 补记链路：
 * - 旧链路（保留兼容）：统计页写 meta.manualDay → 入睡页 openPendingManual 消费并弹面板；
 * - 新链路（2026-10-22）：统计页点空格子直接在本页弹补记面板，不写 meta、不跳页。
 * 用户反馈「点补记没有弹窗口」，这里用页面级桩把两条链都跑一遍。
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

/** 加载统计页的 Page 配置并套最小桩 */
function makeStatsPage() {
  const configs = {}
  global.Page = (value) => {
    configs.stats = value
  }
  delete require.cache[require.resolve('../miniprogram/pages/stats/stats')]
  require('../miniprogram/pages/stats/stats')
  const page = Object.assign({}, configs.stats)
  page.data = JSON.parse(JSON.stringify(configs.stats.data))
  page.setData = function setData(patch, cb) {
    Object.assign(this.data, patch)
    if (typeof cb === 'function') cb()
  }
  page._alive = true
  page._records = {}
  page._signature = ''
  return page
}

test('统计页点空格子：直接弹页内补记面板，不写 meta、不跳页', () => {
  resetStore()
  const page = makeStatsPage()

  const original = global.wx.switchTab
  let switched = ''
  global.wx.switchTab = (options) => {
    switched = options.url
  }
  try {
    page.openDay('2026-10-18')
  } finally {
    global.wx.switchTab = original
  }

  assert.equal(page.data.manualShow, true, '必须在当前页弹出补记面板')
  assert.equal(page.data.manualDay, '2026-10-18')
  // 过去日期默认一整夜 23:00 → 07:00
  assert.equal(page.data.manualBedTime, '23:00')
  assert.equal(page.data.manualWakeTime, '07:00')
  assert.equal(page.data.manualDurationText, '8 小时 00 分')
  assert.equal(page.data.manualError, '')
  assert.equal(switched, '', '不再跳转入睡页')
  assert.ok(!storage.getMeta().manualDay, '不再写 meta.manualDay')
})

test('页内补记保存：直接落 v2 session 并收起面板', () => {
  resetStore()
  const page = makeStatsPage()
  page.openDay('2026-10-18')
  page.onManualConfirm()

  const record = storage.getRecords()['2026-10-18']
  assert.ok(record, '补记必须写入醒来日对应记录')
  assert.equal(record.totalDurationMin, 480)
  assert.equal(page.data.manualShow, false, '保存后面板收起')
})

test('有记录的日期点格子仍走详情卡，不弹补记面板', () => {
  resetStore()
  const page = makeStatsPage()
  const bedAt = new Date(2026, 9, 17, 23, 0, 0, 0).getTime()
  const wakeAt = new Date(2026, 9, 18, 7, 0, 0, 0).getTime()
  storage.saveSession({
    id: 'manual-seed',
    startAt: bedAt,
    endAt: wakeAt,
    durationMin: 480,
    source: 'manual',
    editedAt: wakeAt
  })
  page._records = storage.getRecords()

  page.openDay('2026-10-18')

  assert.equal(page.data.manualShow, false)
  assert.equal(page.data.detail && page.data.detail.tag, '已记录')
})
