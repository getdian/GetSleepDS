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
  showLoading() {},
  hideLoading() {},
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

test('提醒取消补偿队列：成功的移除、失败的保留（下次进页再试）', async () => {
  resetStore()
  const page = makePage()
  const reminder = require('../miniprogram/utils/reminder')
  const original = reminder.cancel
  storage.patchMeta({ pendingReminderCancel: ['sleep-a', 'sleep-b'] })
  reminder.cancel = (id) =>
    id === 'sleep-a' ? Promise.resolve({ ok: true }) : Promise.reject(new Error('network'))
  try {
    page.retryPendingReminderCancel()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepEqual(storage.getMeta().pendingReminderCancel, ['sleep-b'])
  } finally {
    reminder.cancel = original
  }
})

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

function at(day, hour, minute) {
  return new Date(2026, 9, day, hour, minute, 0, 0).getTime()
}

test('同日同档内补记：日历格时长必须更新（签名不能只拼 level）', () => {
  const originalNow = Date.now
  Date.now = () => NOW
  try {
    resetStore()
    const page = makePage()
    storage.saveSession({ id: 'night', startAt: at(4, 23, 0), endAt: at(5, 6, 0), source: 'checkin' })
    page.refresh()
    const before = page.data.calendarCells.filter((cell) => cell.day === '2026-10-05')[0]
    assert.ok(before)
    assert.equal(before.durationMin, 420)
    const signature = page._signature

    // 420 → 460 分钟，色阶仍是 lv-3；只拼 level 的签名不会变
    storage.saveSession({ id: 'nap', startAt: at(5, 13, 0), endAt: at(5, 13, 40), source: 'manual' })
    page.refresh()
    const after = page.data.calendarCells.filter((cell) => cell.day === '2026-10-05')[0]
    assert.equal(after.durationMin, 460, '同档内时长变化也必须重渲染')
    assert.notEqual(page._signature, signature)
  } finally {
    Date.now = originalNow
  }
})

test('日详情：主行区间与总时长同口径，单段午睡不再写「夜间」', () => {
  const originalNow = Date.now
  Date.now = () => NOW
  try {
    resetStore()
    const page = makePage()
    storage.saveSession({ id: 'night', startAt: at(4, 23, 0), endAt: at(5, 6, 0), source: 'checkin' })
    storage.saveSession({ id: 'nap', startAt: at(5, 13, 0), endAt: at(5, 13, 40), source: 'manual' })
    page.refresh()
    page.showDetail('2026-10-05')
    assert.equal(page.data.detail.main, '首段 23:00 上床 · 末段 13:40 起床 · 共 7 小时 40 分')
    assert.match(
      page.data.detail.sub,
      /2 段 · 最长一段 7 小时 00 分 · 其余 40 分钟 · 按醒来日归档/
    )
    assert.equal(page.data.detail.canAdd, true, '已记录日也应能再补一段')
    page.onDetailAdd()
    assert.equal(page.data.manualShow, true)
    assert.equal(page.data.manualBedTime, '14:00', '13:00 已被午休占用，默认应换到下一个空档')
    assert.equal(page.data.manualWakeTime, '14:30')
    assert.equal(page.data.manualError, '', '已记录日的补记默认值不能一打开就重叠')

    // 只有一段午睡时，主段不是"夜间"
    resetStore()
    const page2 = makePage()
    storage.saveSession({ id: 'nap-only', startAt: at(6, 13, 0), endAt: at(6, 13, 30), source: 'manual' })
    page2.refresh()
    page2.showDetail('2026-10-06')
    assert.equal(page2.data.detail.main, '13:00 上床 → 13:30 起床 · 共 30 分钟')
    assert.equal(page2.data.detail.sub, '1 段 · 按醒来日归档')
    assert.ok(!/夜间/.test(page2.data.detail.sub))
  } finally {
    Date.now = originalNow
  }
})

test('云端删除失败（lastSyncAt=0）仍保留删除入口的状态', () => {
  resetStore()
  storage.setSyncEnabled(false)
  storage.patchMeta({ cloudPendingErase: true, lastSyncAt: 0 })
  const page = makePage()
  page.refresh()
  assert.equal(page.data.cloudPendingErase, true)
  assert.equal(page.data.hasCloudCopy, false, 'lastSyncAt=0 不能当作"没有待删副本"')
  assert.match(page.data.syncText, /云端副本尚未删除/)
})

test('未开启云备份：服务端清理失败仍保留待删除出口，不静默成功', async () => {
  resetStore()
  storage.setSyncEnabled(false)
  const api = require('../miniprogram/utils/api')
  const originalErase = api.eraseRecords
  const originalLogin = global.wx.login
  const page = makePage()
  page.clearLocalData = () => true
  api.eraseRecords = () => Promise.reject(new Error('network'))
  global.wx.login = (opts) => opts.success({ code: 'test-code' })
  try {
    page.eraseThenClear()
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(storage.getMeta().cloudPendingErase, true)
  } finally {
    api.eraseRecords = originalErase
    global.wx.login = originalLogin
  }
})

test('删除云端副本后：本地计划提醒与进行中提醒标记一起收敛', () => {
  resetStore()
  storage.setPending({
    id: 'sleep-cloud',
    bedAt: NOW - 20 * 60 * 1000,
    expectedWakeAt: NOW + 6 * 3600 * 1000,
    reminderOptIn: true
  })
  storage.patchMeta({
    planReminder: { kind: 'wake', at: NOW + 3600 * 1000, id: 'plan-w-' + (NOW + 3600 * 1000) }
  })
  const page = makePage()
  page.clearLocalCloudReminderState()
  const meta = storage.getMeta()
  assert.equal(meta.planReminder, null)
  assert.equal(storage.getPending().reminderOptIn, false)
  assert.equal(storage.getPending().id, 'sleep-cloud', '本机睡眠会话不能因删云端提醒被清掉')
})

test('空态：0 数据时支持从 empty-state 触发补记与去入睡', async () => {
  const originalNow = Date.now
  Date.now = () => NOW
  let switchedUrl = ''
  const originalSwitchTab = global.wx.switchTab
  global.wx.switchTab = (opts) => {
    switchedUrl = opts.url
  }
  try {
    resetStore()
    const page = makePage()
    page.refresh()
    assert.equal(page.data.hasData, false, '初始无记录为 0 数据空态')

    // 触发去入睡：跳转统一走 tabbar.switchTo，它有一条 setTimeout(80) 兜底
    // （页面栈里没有 tabBar 实例时才靠它落地），断言必须等这条兜底跑完
    page.goSleep()
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.equal(switchedUrl, '/pages/sleep/sleep')

    // 触发补记
    page.onEmptyManual()
    assert.equal(page.data.manualShow, true, '空态补记应拉起 manualSheet')
    assert.equal(page.data.manualDay, '2026-10-22', '默认补记醒来日为今天')
    assert.equal(page.data.manualError, '', '无记录时补记不应有报错')
    assert.ok(page.data.manualBedTime && page.data.manualWakeTime)
  } finally {
    global.wx.switchTab = originalSwitchTab
    Date.now = originalNow
  }
})

test('1 年视图：数据未变时复用日历网格，数据变化后必须重算', () => {
  resetStore()
  const page = makePage()
  const statsUtil = require('../miniprogram/utils/stats')
  const time = require('../miniprogram/utils/time')
  const now = Date.now()
  const day = time.dateKey(now)
  storage.saveRecord({
    day,
    bedAt: now - 8 * 3600 * 1000,
    wakeAt: now - 3600 * 1000,
    durationMin: 420,
    updatedAt: 1
  })
  page.setData({ calendarSpan: 12 })

  const original = statsUtil.calendarMonths
  let calls = 0
  statsUtil.calendarMonths = function patched(...args) {
    calls += 1
    return original.apply(null, args)
  }
  try {
    page.refresh()
    assert.equal(calls, 1, '首次必须计算')
    page.refresh()
    assert.equal(calls, 1, '同参数同数据必须命中缓存')

    // 新增一天 → 指纹变化 → 必须重算，否则日历会停留在旧数据
    storage.saveRecord({
      day: time.dateKey(now - 2 * 86400000),
      bedAt: now - 56 * 3600 * 1000,
      wakeAt: now - 49 * 3600 * 1000,
      durationMin: 420,
      updatedAt: 2
    })
    page.refresh()
    assert.equal(calls, 2, '数据变化必须重算')
  } finally {
    statsUtil.calendarMonths = original
  }
})

/* ---------------- 历史记录的修正入口（详情卡「改 / 删」） ---------------- */

function localTs(year, month, day, hour, minute) {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

/** 10-21 两段：整夜 10-20 23:00 → 10-21 06:30 + 午睡 13:00 → 14:30 */
function seedTwoSessions() {
  storage.saveSession({
    id: 's-1',
    startAt: localTs(2026, 10, 20, 23, 0),
    endAt: localTs(2026, 10, 21, 6, 30),
    durationMin: 450,
    source: 'manual',
    editedAt: NOW
  })
  storage.saveSession({
    id: 's-2',
    startAt: localTs(2026, 10, 21, 13, 0),
    endAt: localTs(2026, 10, 21, 14, 30),
    durationMin: 90,
    source: 'manual',
    editedAt: NOW
  })
}

test('详情卡「改」：编辑既有段只改时间，段数不变、不判成与自己重叠', () => {
  const originalNow = Date.now
  Date.now = () => NOW
  try {
    resetStore()
    seedTwoSessions()
    const page = makePage()
    page.refresh()
    page.openDay('2026-10-21')
    assert.equal(page.data.detail.sessions.length, 2)
    assert.equal(page.data.detail.canEdit, true)

    page.openManualSheet('2026-10-21', { edit: { id: 's-2' } })
    assert.equal(page.data.manualMode, 'edit')
    assert.equal(page.data.manualBedTime, '13:00')
    assert.equal(page.data.manualWakeTime, '14:30')
    assert.equal(page.data.manualError, '')

    // 只挪自己的结束时间：校验必须排除本段，否则会判成与自身重叠
    page.onManualTimeChange({
      currentTarget: { dataset: { field: 'manualWakeTime' } },
      detail: { value: '15:00' }
    })
    assert.equal(page.data.manualError, '', '编辑时排除自身后不应报重叠')
    page.onManualConfirm()

    const record = storage.getRecords()['2026-10-21']
    assert.equal(record.sessions.length, 2, '编辑不能增减段数')
    assert.equal(record.sessions.filter((item) => item.id === 's-2')[0].durationMin, 120)
    assert.equal(page.data.manualShow, false)
    assert.equal(page.data.detail.sessions.length, 2, '保存后详情卡要跟着刷新')
  } finally {
    Date.now = originalNow
  }
})

test('详情卡「删」：多段日删一段后当天保留，删光时整天撤销', () => {
  const originalNow = Date.now
  const originalModal = global.wx.showModal
  Date.now = () => NOW
  global.wx.showModal = (opts) => opts.success({ confirm: true })
  try {
    resetStore()
    seedTwoSessions()
    const page = makePage()
    page.refresh()
    page.openDay('2026-10-21')

    page.onDetailDeleteSession({ currentTarget: { dataset: { id: 's-2' } } })
    const left = storage.getRecords()['2026-10-21']
    assert.equal(left.sessions.length, 1, '多段日只删被点的那一段')
    assert.equal(page.data.detail.sessions.length, 1, '删完仍停在详情卡')

    // 删最后一段：整条记录撤销（含墓碑，防云端回填）
    page.onDetailDeleteSession({ currentTarget: { dataset: { id: 's-1' } } })
    assert.equal(storage.getRecords()['2026-10-21'], undefined)
    assert.equal(page.data.detail, null)
  } finally {
    Date.now = originalNow
    global.wx.showModal = originalModal
  }
})
