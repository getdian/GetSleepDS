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
    assert.equal(page._anchorAt, NOW, '改耗时不换计算会话的"现在"')

    page.cycleFall()
    assert.notEqual(page.data.fallAsleep, 20)
    assert.equal(page._anchorAt, NOW, '结果面循环耗时同样不能清锚点')
  } finally {
    Date.now = originalNow
  }
})

test('翻转后页头回显的前缀与所选时间同源（今天/明天 + 时段）', () => {
  const originalNow = Date.now
  Date.now = () => NOW
  try {
    const page = makePage()
    page.setData({ mode: 'wake', wakeTime: '07:30', fallAsleep: 15 })
    page._anchorAt = NOW
    page.calc(true)
    assert.equal(page.data.flipped, true)
    assert.equal(page.data.view.echoPrefix, '今天 早晨')

    // 凌晨 2 点看 00:30 的起床点已经过时，必须顺延到明天，与时间轮下的上下文同口径
    page.setData({ mode: 'wake', wakeTime: '00:30' })
    page._anchorAt = NOW
    page.calc(true)
    assert.equal(page.data.view.echoPrefix, '明天 凌晨')

    // 入睡模式：01:00 已超 30 分钟宽限 → 明天凌晨
    page.setData({ mode: 'sleep', sleepTime: '01:00' })
    page._anchorAt = NOW
    page.calc(true)
    assert.equal(page.data.view.echoPrefix, '明天 凌晨')
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
    assert.equal(page.data.nowText, undefined, 'nowText 已移除，提示不能再漂回"当前时刻"')

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

test('结果面锚点超过 30 分钟：重算必须回到当前时刻，不能跨夜沿用旧锚点', () => {
  const originalNow = Date.now
  const night = new Date(2026, 9, 22, 23, 0, 0, 0).getTime()
  let now = night
  Date.now = () => now
  try {
    const page = makePage()
    page.setData({ mode: 'sleep', sleepTime: '22:30', fallAsleep: 15, flipped: true })
    page._anchorAt = night
    page.calc(true)
    assert.equal(page._anchorAt, night, '30 分钟内保留锚点，改耗时不整体漂移')

    // 次日 09:00：旧锚点会把"今天 06:45"继续算成"明天"
    now = new Date(2026, 9, 23, 9, 0, 0, 0).getTime()
    page.calc(true)
    assert.equal(page._anchorAt, 0, '超过 30 分钟必须清零，按当前时刻重算')
    assert.ok(page.data.view, '重算后结果面仍有内容')
    assert.equal(page.data.view.mainTime, '06:15')
  } finally {
    Date.now = originalNow
  }
})

/* ---------------- 结果面提醒 / 去入睡打卡 ---------------- */

const reminder = require('../miniprogram/utils/reminder')

/** 临时替换 reminder 模块方法（页面持有同一对象引用），返回调用计数 */
function stubReminder(overrides) {
  const originals = {}
  const calls = { optIn: 0, schedule: [], cancel: [], cancelPlan: 0 }
  const base = {
    templateId: () => 'tmpl-test',
    requestOptIn: () => {
      calls.optIn += 1
      return Promise.resolve({ ok: true })
    },
    scheduleAt: (at, kind) => {
      calls.schedule.push([at, kind])
      return Promise.resolve({ ok: true })
    },
    cancel: (id) => {
      calls.cancel.push(id)
      return Promise.resolve({ ok: true })
    },
    // 页面调用的是 exports 上的 cancelPlanReminder；模块内部直接引用 cancel，
    // 替换 cancel 无法拦截，这里按真实语义打桩（清本地 + 返回成功）
    cancelPlanReminder: () => {
      calls.cancelPlan += 1
      storage.patchMeta({ planReminder: null })
      return Promise.resolve({ ok: true })
    }
  }
  const impl = Object.assign(base, overrides || {})
  Object.keys(impl).forEach((key) => {
    originals[key] = reminder[key]
    reminder[key] = impl[key]
  })
  calls.restore = () => Object.keys(originals).forEach((key) => (reminder[key] = originals[key]))
  return calls
}

function remindPage(mainAt, mode) {
  const page = makePage()
  page._remindBusy = false
  page.setData({ mode: mode || 'wake', flipped: true, view: { mainAt, mainPassed: false } })
  return page
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

test('提醒我：时间已过时先本地拦截，不弹订阅授权', () => {
  storage.patchMeta({ planReminder: null })
  const calls = stubReminder()
  try {
    const page = remindPage(Date.now() + 30 * 1000)
    page.onRemindMain()
    assert.equal(calls.optIn, 0, '注定失败时不能先让用户授权一次')
  } finally {
    calls.restore()
  }
})

test('提醒我：模板未配置走日历兜底，不弹订阅授权', () => {
  storage.patchMeta({ planReminder: null })
  const calls = stubReminder({ templateId: () => '' })
  const originalModal = global.wx.showModal
  let modal = null
  global.wx.showModal = (options) => {
    modal = options
  }
  try {
    remindPage(Date.now() + 3600000).onRemindMain()
    assert.equal(calls.optIn, 0)
    assert.ok(modal && /日历/.test(modal.title), '应给出加入手机日历的出口')
  } finally {
    global.wx.showModal = originalModal
    calls.restore()
  }
})

test('提醒我：设置后显示已设状态，重复点击不再授权；改时间重设会撤掉旧的那条', async () => {
  storage.patchMeta({ planReminder: null })
  const calls = stubReminder()
  try {
    const first = Date.now() + 3600000
    const page = remindPage(first, 'wake')
    page.onRemindMain()
    await flush()
    await flush()
    assert.equal(page.data.remindAt, first)
    assert.deepEqual(calls.schedule[0], [first, 'sleep'], '起床模式推荐入睡点 → 该睡了')
    assert.equal(reminder.getPlanReminder().id, 'plan-s-' + first)

    // 再点一次 = 取消这条提醒（撤销出口），而不是只弹一句 toast
    page.onRemindMain()
    await flush()
    assert.equal(calls.optIn, 1, '取消不需要再次授权')
    assert.equal(page.data.remindAt, 0, '取消后回到未设置状态')
    assert.equal(reminder.getPlanReminder(), null)
    assert.equal(calls.cancelPlan, 1, '取消必须真正走撤销入口')

    // 取消后能就同一时刻重新创建（服务端允许 cancelled → pending）
    page.onRemindMain()
    await flush()
    await flush()
    assert.equal(page.data.remindAt, first)
    assert.equal(reminder.getPlanReminder().id, 'plan-s-' + first)

    // 改了入睡耗时，主推荐时刻变化后重设：只保留一条
    const second = first + 5 * 60 * 1000
    page.setData({ view: { mainAt: second, mainPassed: false } })
    page.onRemindMain()
    await flush()
    await flush()
    assert.equal(calls.cancel[calls.cancel.length - 1], 'plan-s-' + first, '重设时撤掉旧提醒')
    assert.equal(reminder.getPlanReminder().at, second)
  } finally {
    calls.restore()
    storage.patchMeta({ planReminder: null })
  }
})

test('去入睡打卡：只在结果面带上算出的起床时刻，且只消费一次', () => {
  storage.patchMeta({ planTarget: null })
  const now = Date.now()
  const wakeAt = now + 7 * 3600000
  const page = makePage()
  page.setData({ flipped: false, view: { targetWakeAt: wakeAt } })
  page.goSleep()
  assert.equal(reminder.takePlanTarget(now), 0, '正面（未出结果）不写计划时刻')

  page.setData({ flipped: true })
  page.goSleep()
  assert.equal(reminder.takePlanTarget(now), wakeAt)
  assert.equal(reminder.takePlanTarget(now), 0, '只消费一次')
})

test('计划起床时刻：过期或不在 16 小时窗口内都丢弃', () => {
  const now = Date.now()
  reminder.savePlanTarget(now + 7 * 3600000, now - 13 * 3600000)
  assert.equal(reminder.takePlanTarget(now), 0, '算完超过 12 小时才打卡')
  reminder.savePlanTarget(now - 60 * 1000, now)
  assert.equal(reminder.takePlanTarget(now), 0, '已经过去的起床时刻')
  reminder.savePlanTarget(now + 20 * 3600000, now)
  assert.equal(reminder.takePlanTarget(now), 0, '超过 16 小时')
})

test('分享深链：预填参数并直接展示结果面，不写本地偏好', () => {
  const originalNow = Date.now
  Date.now = () => NOW
  try {
    Object.keys(store).forEach((key) => delete store[key])
    const page = makePage()
    page.applyShareQuery({ from: 'share', mode: 'wake', wake: '08:15', fall: '20' })
    assert.equal(page.data.mode, 'wake')
    assert.equal(page.data.wakeTime, '08:15')
    assert.equal(page.data.fallAsleep, 20)
    assert.equal(page.data.flipped, true)
    assert.ok(page.data.view && page.data.view.mainTime, '必须直接算出结果')
    assert.ok(!storage.getPrefs().wakeTime, '分享预填不得写本地偏好')
  } finally {
    Date.now = originalNow
  }
})

test('分享路径携带输入参数（被分享者能看到同一推荐）', () => {
  const page = makePage()
  page.data.mode = 'wake'
  page.data.wakeTime = '07:30'
  page.data.fallAsleep = 15
  const share = page.onShareAppMessage()
  assert.match(share.path, /from=share/)
  assert.match(share.path, /mode=wake/)
  assert.match(share.path, /wake=07%3A30/)
  assert.match(share.path, /fall=15/)
  // 分享会上报事件：清掉队列与重试定时器，避免测试进程空等 15s
  require('../miniprogram/utils/events').clearQueue()
})

test('首页消费统计页预填：切到入睡模式并直接展示结果面', () => {
  const originalNow = Date.now
  Date.now = () => NOW
  try {
    Object.keys(store).forEach((key) => delete store[key])
    const page = makePage()
    storage.patchMeta({ prefillSleepMin: 23 * 60 + 15 })
    page.onShow()
    assert.equal(page.data.mode, 'sleep')
    assert.equal(page.data.sleepTime, '23:15')
    assert.equal(page.data.flipped, true, '预填后直接展示结果，少一步点击')
    assert.ok(page.data.view && page.data.view.mainTime)
    assert.equal(storage.getMeta().prefillSleepMin, null, '预填是一次性的')
    // onShow 会启动 60s 时钟与事件队列：不清掉会让测试进程挂住
    page.onHide()
    require('../miniprogram/utils/events').clearQueue()
  } finally {
    Date.now = originalNow
  }
})
