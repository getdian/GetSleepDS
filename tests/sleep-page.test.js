/**
 * 页面级冒烟：直接加载 pages/sleep/sleep.js 的 Page 配置并驱动 computeEndSheet。
 *
 * 为什么需要它：本轮 P0（把 sessions.rangeForDay 写成 stats.rangeForDay）是纯页面调用错误，
 * 纯函数单测全绿也发现不了。这里用最小 wx / Page 桩跑真实页面代码，
 * 至少保证“结束/补记/编辑”三条路径的区间计算不会抛错，且跨天重叠能被拦住。
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

require('../miniprogram/pages/sleep/sleep')

const storage = require('../miniprogram/utils/storage')
const T = require('../miniprogram/utils/time')
const F = require('../miniprogram/utils/format')

function resetStore() {
  Object.keys(store).forEach((key) => delete store[key])
  store[storage.KEYS.records] = {}
  store[storage.KEYS.deleted] = {}
}

/** 复制 Page 配置，补一个只做浅合并的 setData */
function makePage() {
  const page = Object.assign({}, config)
  page.data = JSON.parse(JSON.stringify(config.data))
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
  return page
}

test('结束面板能算出区间（P0：rangeForDay 必须来自 sessions）', () => {
  resetStore()
  const page = makePage()
  const now = Date.now()
  const bedAt = now - 8 * 60 * 60 * 1000
  page.data.endMode = 'pending'
  page.data.endBedTime = F.fmtClockTs(bedAt)
  page.data.endWakeTime = F.fmtClockTs(now)
  page._endStartDay = T.startOfDay(bedAt)
  page._endBaseDay = T.startOfDay(now)
  page.computeEndSheet()
  assert.equal(page.data.endError, '')
  assert.equal(page._endWakeAt - page._endBedAt, 8 * 60 * 60 * 1000)
  assert.equal(T.dateKey(page._endWakeAt), T.dateKey(now))
})

test('忘记结束两天：入睡日按 pending 真实日期，不压到昨天', () => {
  resetStore()
  const page = makePage()
  const today = T.startOfDay(Date.now())
  const bedDay = T.addDays(today, -2)
  const wakeDay = T.addDays(today, -1)
  page.data.endMode = 'pending'
  page.data.endBedTime = '23:00'
  page.data.endWakeTime = '07:00'
  page._endStartDay = bedDay
  page._endBaseDay = wakeDay
  page.computeEndSheet()
  assert.equal(page.data.endError, '')
  assert.equal(page._endBedAt, bedDay + 23 * 60 * 60 * 1000)
  assert.equal(page._endWakeAt, wakeDay + 7 * 60 * 60 * 1000)
  assert.equal(page.data.endDayText, F.fmtDayCN(T.dateKey(wakeDay)))
})

test('醒来日早于入睡日时直接报错，不再偷偷回退一天', () => {
  resetStore()
  const page = makePage()
  const today = T.startOfDay(Date.now())
  const bedDay = T.addDays(today, -2)
  page.data.endMode = 'pending'
  page.data.endBedTime = '23:00'
  page.data.endWakeTime = '07:00'
  page._endStartDay = bedDay
  page._endBaseDay = bedDay
  page.computeEndSheet()
  assert.equal(page.data.endError, '入睡时间需早于起床时间，请检查醒来日')
})

test('补记前先挡跨天重叠：同一天已有段也会被拦', () => {
  resetStore()
  const page = makePage()
  const now = Date.now()
  const wakeAt = now - 60 * 60 * 1000
  page.data.endMode = 'manual'
  // 以“醒来那一刻所在日”为基准，跨午夜时 rangeForDay 会正常回退到前一天
  page._endBaseDay = T.startOfDay(wakeAt)
  page.data.endBedTime = F.fmtClockTs(now - 2 * 60 * 60 * 1000)
  page.data.endWakeTime = F.fmtClockTs(wakeAt)
  page.computeEndSheet()
  assert.equal(page.data.endError, '')
  const saved = storage.saveSession({
    id: 'existing',
    startAt: page._endBedAt,
    endAt: page._endWakeAt
  })
  assert.ok(saved)
  page.computeEndSheet()
  assert.equal(page.data.endError, '与已有睡眠段重叠，请调整时间')
})

test('补记跨天重叠：前一天 22:00–23:30 会挡住 22:30→次日 07:00', () => {
  resetStore()
  const page = makePage()
  const today = T.startOfDay(Date.now())
  const bedDay = T.addDays(today, -2)
  const wakeDay = T.addDays(today, -1)
  const existingStart = bedDay + 22 * 60 * 60 * 1000
  const existingEnd = bedDay + 23.5 * 60 * 60 * 1000
  const saved = storage.saveSession({
    id: 'early',
    startAt: existingStart,
    endAt: existingEnd
  })
  assert.ok(saved)
  page.data.endMode = 'pending'
  page.data.endBedTime = '22:30'
  page.data.endWakeTime = '07:00'
  page._endStartDay = bedDay
  page._endBaseDay = wakeDay
  page.computeEndSheet()
  assert.equal(page.data.endError, '与已有睡眠段重叠，请调整时间')
})

test('编辑自己那一段时不会把自己判成重叠', () => {
  resetStore()
  const page = makePage()
  const now = Date.now()
  const wakeAt = now - 60 * 60 * 1000
  page.data.endMode = 'manual'
  page._endBaseDay = T.startOfDay(wakeAt)
  page.data.endBedTime = F.fmtClockTs(now - 2 * 60 * 60 * 1000)
  page.data.endWakeTime = F.fmtClockTs(wakeAt)
  page.computeEndSheet()
  const saved = storage.saveSession({
    id: 'legacy-edit',
    startAt: page._endBedAt,
    endAt: page._endWakeAt
  })
  assert.ok(saved)
  page.data.endMode = 'edit'
  page._editingSessionId = saved.sessions[0].id
  page._endBaseDay = T.startOfDay(saved.sessions[0].endAt)
  page.computeEndSheet()
  assert.equal(page.data.endError, '')
})
