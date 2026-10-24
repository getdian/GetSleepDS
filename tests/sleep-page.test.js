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
  page._lightsTimer = null
  page._editingDay = ''
  page._editingSessionId = ''
  page._endBaseDay = 0
  page._endStartDay = 0
  page._endBedAt = 0
  page._endWakeAt = 0
  page.selectComponent = () => null
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

test('编辑同日段时入睡晚于起床被拦（防止午休静默变跨天段）', () => {
  resetStore()
  const page = makePage()
  const today = T.startOfDay(Date.now())
  const saved = storage.saveSession({
    id: 'nap-edit',
    startAt: today + 13 * 60 * 60 * 1000,
    endAt: today + 13.5 * 60 * 60 * 1000
  })
  assert.ok(saved)
  page.data.endMode = 'edit'
  page._editingSessionId = saved.sessions[0].id
  page._endBaseDay = T.startOfDay(saved.sessions[0].endAt)
  page.data.endBedTime = '14:00'
  page.data.endWakeTime = '13:30'
  page.computeEndSheet()
  assert.equal(page.data.endError, '入睡时间需早于起床时间，请检查醒来日')
  // 出错时不能留下可保存区间
  assert.equal(page._endBedAt, 0)
  assert.equal(page._endWakeAt, 0)
})

function ts(year, month, day, hour, minute) {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

/** 构造“夜间 + 午休”两段记录，返回醒来日 record */
function makeTwoSessionRecord() {
  storage.saveSession({
    id: 'night',
    startAt: ts(2026, 10, 21, 23, 0),
    endAt: ts(2026, 10, 22, 7, 0)
  })
  storage.saveSession({
    id: 'nap',
    startAt: ts(2026, 10, 22, 13, 0),
    endAt: ts(2026, 10, 22, 13, 30)
  })
  return storage.getRecords()['2026-10-22']
}

test('完成态时间线用总睡眠口径：首段入睡 → 末段起床', () => {
  resetStore()
  const page = makePage()
  const record = makeTwoSessionRecord()
  const view = page.buildRecordView(record)
  assert.equal(view.firstBed, '23:00')
  assert.equal(view.lastWake, '13:30')
  assert.equal(view.sessionCount, 2)
  assert.equal(view.timelineFirstK, '当天首段入睡')
  assert.equal(view.timelineLastK, '当天末段起床')
  // 大数字仍是当天总睡眠（含午休），与时间线同口径
  assert.equal(view.duration, F.fmtDuration(510))
  assert.equal(view.sessions.length, 2)
  // 分段轴：夜间 8h 占 480/870，午休 30 分钟落在尾端；中间 6 小时是清醒间断
  assert.equal(view.timeline.length, 2)
  assert.deepEqual(view.timeline.map((s) => s.left), [0, 96.6])
  assert.deepEqual(view.timeline.map((s) => s.width), [55.2, 3.4])
  assert.equal(view.segmentsText, '2 段 · 相隔 ' + F.fmtDuration(360))
})

test('单段记录时间线保持「入睡 / 起床」，不引入新概念', () => {
  resetStore()
  const page = makePage()
  const saved = storage.saveSession({
    id: 'solo',
    startAt: ts(2026, 10, 22, 23, 0),
    endAt: ts(2026, 10, 23, 7, 0)
  })
  const view = page.buildRecordView(saved)
  assert.equal(view.firstBed, '23:00')
  assert.equal(view.lastWake, '07:00')
  assert.equal(view.sessionCount, 1)
  assert.equal(view.timelineFirstK, '入睡')
  assert.equal(view.timelineLastK, '起床')
  // 单段：整条填满，不显示段数/间断摘要
  assert.equal(view.timeline.length, 1)
  assert.equal(view.timeline[0].left, 0)
  assert.equal(view.timeline[0].width, 100)
  assert.equal(view.segmentsText, '')
})

test('三段短睡眠：分段轴按比例落位，摘要给出段数与间断', () => {
  resetStore()
  const page = makePage()
  storage.saveSession({ id: 'a', startAt: ts(2026, 10, 22, 0, 9), endAt: ts(2026, 10, 22, 0, 13) })
  storage.saveSession({ id: 'b', startAt: ts(2026, 10, 22, 0, 14), endAt: ts(2026, 10, 22, 0, 17) })
  storage.saveSession({ id: 'c', startAt: ts(2026, 10, 22, 0, 20), endAt: ts(2026, 10, 22, 0, 39) })
  const record = storage.getRecords()['2026-10-22']
  const view = page.buildRecordView(record)

  // 跨度 30 分钟，实际睡眠 4 + 3 + 19 = 26 分钟，中间 1 + 3 = 4 分钟清醒
  assert.equal(view.timeline.length, 3)
  assert.deepEqual(view.timeline.map((s) => s.left), [0, 16.7, 36.7])
  assert.deepEqual(view.timeline.map((s) => s.width), [13.3, 10, 63.3])
  assert.equal(view.segmentsText, '3 段 · 中间醒了 2 次（4 分钟）')
  assert.equal(view.duration, F.fmtDuration(26))
})

test('相邻无间隔的两段只报段数，不编造醒来次数', () => {
  const page = makePage()
  const view = page.buildRecordView({
    day: '2026-10-22',
    sessions: [
      { id: 'a', startAt: ts(2026, 10, 22, 1, 0), endAt: ts(2026, 10, 22, 2, 0) },
      { id: 'b', startAt: ts(2026, 10, 22, 2, 0), endAt: ts(2026, 10, 22, 3, 0) }
    ]
  })
  assert.equal(view.segmentsText, '2 段')
})

/* ---------------- 文案中性（不预设夜间） ---------------- */

test('文案中性：睡梦中/空闲态都不出现「夜色/明早/今晚/今夜」', () => {
  resetStore()
  const page = makePage()
  page.selectComponent = () => null

  // 睡梦中（b 态）
  storage.setPending({
    bedAt: Date.now() - 10 * 60 * 1000,
    expectedWakeAt: 0,
    id: 'neutral-1'
  })
  page.refreshAll()
  assert.equal(page.data.state, 'sleeping')
  assert.equal(page.data.heroTitle, '这一觉开始了')
  assert.equal(page.data.heroSub, '醒来后记得回来记录起床。')
  assert.match(page.data.orbMeta, /^已睡 /)
  const sleepingText =
    page.data.heroTitle + page.data.heroSub + page.data.footerText + page.data.orbMeta
  assert.ok(!/夜色|明早|今晚|今夜/.test(sleepingText), '睡梦中文案不能预设夜间：' + sleepingText)

  // 空闲态（a 态）
  storage.clearPending()
  page.refreshAll()
  assert.equal(page.data.state, 'idle')
  assert.equal(page.data.orbMeta, '等待入睡')
  assert.equal(page.data.heroSub, '记录入睡这一刻，醒来后再记起床。')
  assert.equal(page.data.footerText, '愿这一觉安稳')
  const idleText = page.data.heroTitle + page.data.heroSub + page.data.footerText + page.data.orbMeta
  assert.ok(!/夜色|明早|今晚|今夜/.test(idleText), '空闲文案不能预设夜间：' + idleText)
})

test('文案中性：完成态不写「今晚」，页脚深夜不再说「晚安」', () => {
  // 这条用例依赖“记录日 = 今天”；冻结时间，避免测试在跨午夜后变红
  const originalNow = Date.now
  Date.now = () => ts(2026, 10, 22, 10, 0)
  try {
    resetStore()
    const page = makePage()
    page.selectComponent = () => null
    const saved = storage.saveSession({
      id: 'neutral-done',
      startAt: ts(2026, 10, 21, 23, 0),
      endAt: ts(2026, 10, 22, 7, 0)
    })
    page.refreshAll()
    assert.equal(page.data.state, 'done')
    // 标题只按“此刻”分早安/其他，不假设这一觉发生在夜里
    assert.ok(!/今晚/.test(page.data.heroTitle))
    assert.equal(page.data.heroSub, '入睡与起床时间都已保存。')
    assert.ok(!/晚安/.test(page.data.footerText))
    // 分享文案：白天补觉分享也成立
    const share = page.onShareAppMessage()
    assert.ok(!/昨晚|早睡/.test(share.title), share.title)
    assert.match(share.title, /入睡/)
    assert.ok(saved)
  } finally {
    Date.now = originalNow
  }
})

/* ---------------- 熄灯（睡前模式） ---------------- */

test('熄灯：打卡后进入熄灯态，且不会自动亮起', () => {
  resetStore()
  const page = makePage()
  page.selectComponent = () => null
  const ok = page.markSleep()
  assert.equal(ok, true)
  assert.equal(page.data.state, 'sleeping')
  assert.equal(page.data.dim, true, '点入睡后应立即熄灯')
  // 熄灯期间不排定“再次熄灯”（避免重复计时）
  assert.equal(page._lightsTimer, null)
})

test('熄灯：只有睡梦中才熄灯，空闲/完成态不熄', () => {
  resetStore()
  const page = makePage()
  page.selectComponent = () => null
  page.setData({ state: 'idle' })
  page.enterLightsOut()
  assert.equal(page.data.dim, false)
  page.setData({ state: 'done' })
  page.enterLightsOut()
  assert.equal(page.data.dim, false)
})

test('熄灯：结束面板打开时不熄灯，也不会被计时器偷袭', async () => {
  resetStore()
  const page = makePage()
  page.selectComponent = () => null
  page.setData({ state: 'sleeping', endShow: true })
  page.scheduleLightsOut(15)
  assert.equal(page._lightsTimer, null, '面板打开时不该排定')
  await new Promise((resolve) => setTimeout(resolve, 35))
  assert.equal(page.data.dim, false)
})

test('熄灯：无操作排定生效，唤醒后立即亮起并重新起表', async () => {
  resetStore()
  const page = makePage()
  page.selectComponent = () => null
  page.setData({ state: 'sleeping', dim: false })
  page.scheduleLightsOut(20)
  await new Promise((resolve) => setTimeout(resolve, 45))
  assert.equal(page.data.dim, true, '到点应熄灯')
  page.onDimTap()
  assert.equal(page.data.dim, false, '点遮罩应唤醒')
  assert.ok(page._lightsTimer, '唤醒后应重新排定熄灯')
  page.clearLightsTimer()
})

test('熄灯：页面触摸同样唤醒并重置计时；完成后 refreshAll 自动亮起', () => {
  resetStore()
  const page = makePage()
  page.selectComponent = () => null
  page.setData({ state: 'sleeping', dim: true })
  page.onPageTouch()
  assert.equal(page.data.dim, false)
  assert.ok(page._lightsTimer)
  page.clearLightsTimer()

  // 保存起床后（无 pending、无今日记录 → idle）必须自动退出熄灯
  page.setData({ state: 'sleeping', dim: true })
  page.refreshAll()
  assert.equal(page.data.state, 'idle')
  assert.equal(page.data.dim, false)
})

test('熄灯：声音抽屉打开时 enteredLightsOut 不遮罩', () => {
  resetStore()
  const page = makePage()
  page.selectComponent = () => ({ data: { open: true } })
  page.setData({ state: 'sleeping' })
  page.enterLightsOut()
  assert.equal(page.data.dim, false)
})

test('onDeleteSession：确认删除单段并刷新，取消则原样保留', () => {
  resetStore()
  const page = makePage()
  const record = makeTwoSessionRecord()
  page.setData({ state: 'done', record })
  const originalModal = global.wx.showModal
  let captured = null
  global.wx.showModal = (options) => {
    captured = options
  }
  try {
    // 取消：不动数据
    page.onDeleteSession({ currentTarget: { dataset: { id: 'nap', day: '2026-10-22' } } })
    assert.ok(captured, '删除必须弹确认框')
    captured.success({ confirm: false })
    assert.equal(storage.getRecords()['2026-10-22'].sessions.length, 2)

    // 确认：删掉午休段，总时长回落到夜间段
    page.onDeleteSession({ currentTarget: { dataset: { id: 'nap', day: '2026-10-22' } } })
    assert.equal(captured.confirmColor, '#F87171', '删除确认用危险色')
    captured.success({ confirm: true })
    const left = storage.getRecords()['2026-10-22']
    assert.equal(left.sessions.length, 1)
    assert.equal(left.totalDurationMin, 480)
  } finally {
    global.wx.showModal = originalModal
  }
})

test('编辑：入睡晚于起床时直接拦下，不再静默回退一天', () => {
  resetStore()
  const page = makePage()
  const wakeAt = ts(2026, 10, 22, 13, 30)
  page.data.endMode = 'edit'
  page._endBaseDay = T.startOfDay(wakeAt)
  page.data.endBedTime = '14:00'
  page.data.endWakeTime = '13:30'
  page.computeEndSheet()
  assert.equal(page.data.endError, '入睡时间需早于起床时间，请检查醒来日')
  // 没有合法区间时必须清掉旧值：否则 onEndConfirm 还能拿上一次的区间落库
  assert.equal(page._endBedAt, 0)
  assert.equal(page.data.endDurationText, '—')
})

test('熄灯：刚睡下点圆环会还原倒计时，不会一直亮屏', () => {
  resetStore()
  const page = makePage()
  storage.setPending({ bedAt: Date.now() - 30 * 1000 })
  page._pending = null
  page.setData({ state: 'sleeping', dim: false })
  page.openEndSheet()
  assert.equal(page.data.endShow, false, '不足 1 分钟不开面板')
  assert.ok(page._lightsTimer, '早退分支必须重新排定 30s 熄灯')
  page.clearLightsTimer()
})

test('熄灯：声音抽屉关闭后恢复倒计时（打开期间到点会被跳过）', () => {
  resetStore()
  const page = makePage()
  page.setData({ state: 'sleeping', endShow: false })
  page.onDockSheetClose()
  assert.ok(page._lightsTimer)
  page.clearLightsTimer()

  page.setData({ endShow: true })
  page.onDockSheetClose()
  assert.equal(page._lightsTimer, null, '结束面板打开时不该排定')
})

test('结束面板：当天已有 8 段时直接给“最多 8 段”，不再保存失败无出口', () => {
  resetStore()
  const page = makePage()
  const dayTs = T.addDays(T.startOfDay(Date.now()), -1)
  for (let i = 0; i < 8; i += 1) {
    const start = dayTs + i * 2 * 60 * 60 * 1000
    assert.ok(
      storage.saveSession({ id: 'cap-' + i, startAt: start, endAt: start + 30 * 60 * 1000 })
    )
  }
  page._pending = { id: 'pending-cap', bedAt: dayTs + 15 * 60 * 60 * 1000 }
  page.data.endMode = 'pending'
  page.data.endBedTime = '16:00'
  page.data.endWakeTime = '16:30'
  page._endStartDay = dayTs
  page._endBaseDay = dayTs
  page.computeEndSheet()
  assert.equal(page.data.endError, '当天最多记录 8 段，请先删除其中一段')
  assert.equal(page._endBedAt, 0, '预检失败时不能留下可保存的区间')
})

test('buildRecordView：没有任何可用段的记录返回 null，不抛错', () => {
  resetStore()
  const page = makePage()
  const view = page.buildRecordView({
    day: '2026-10-20',
    sessions: [],
    bedAt: NaN,
    wakeAt: NaN
  })
  assert.equal(view, null)
})

test('onDeleteSession：唯一一段的确认文案提示整天撤销', () => {
  resetStore()
  const page = makePage()
  const saved = storage.saveSession({
    id: 'solo',
    startAt: ts(2026, 10, 22, 23, 0),
    endAt: ts(2026, 10, 23, 7, 0)
  })
  page.setData({ state: 'done', record: saved })
  const originalModal = global.wx.showModal
  let captured = null
  global.wx.showModal = (options) => {
    captured = options
  }
  try {
    page.onDeleteSession({ currentTarget: { dataset: { id: 'solo', day: saved.day } } })
    assert.equal(captured.title, '删除当天唯一一段？')
    captured.success({ confirm: true })
    assert.equal(storage.getRecords()[saved.day], undefined)
  } finally {
    global.wx.showModal = originalModal
  }
})

test('三段中两段相接：中间醒来的次数只数真正隔开的间隔', () => {
  const page = makePage()
  const view = page.buildRecordView({
    day: '2026-10-22',
    sessions: [
      { id: 'a', startAt: ts(2026, 10, 22, 1, 0), endAt: ts(2026, 10, 22, 2, 0) },
      { id: 'b', startAt: ts(2026, 10, 22, 2, 0), endAt: ts(2026, 10, 22, 3, 0) },
      { id: 'c', startAt: ts(2026, 10, 22, 4, 0), endAt: ts(2026, 10, 22, 5, 0) }
    ]
  })
  // 跨度 4 小时，睡着 3 小时，只隔了 1 次（1 小时）；a/b 首尾相接不算醒
  assert.equal(view.segmentsText, '3 段 · 中间醒了 1 次（1 小时 00 分）')
})

test('结束/补记/编辑面板开着回前台：onShow 必须重新隐藏 tabBar', () => {
  resetStore()
  const page = makePage()
  const bar = {
    data: { hidden: false },
    setData(patch) {
      Object.assign(this.data, patch)
    }
  }
  const originalPages = global.getCurrentPages
  global.getCurrentPages = () => [{ getTabBar: () => bar }]
  try {
    page.data.state = 'sleeping'
    page.data.endShow = true
    page.data.dim = false
    page.refreshAll = () => {}
    page.startClock = () => {}
    page.openPendingAudio = () => {}
    page.openPendingManual = () => {}
    page.onShow()
    assert.equal(bar.data.hidden, true, '面板期间 tabBar 不能被 audio-dock 的 show 翻出来')
  } finally {
    global.getCurrentPages = originalPages
  }
})

/** 启动意图测试：只观察是否开结束面板与 notice 文案 */
function intentPage(options) {
  const page = makePage()
  page._autoEnd = !!(options && options.end === '1')
  page._remindKind = (options && options.remind) || ''
  page._opened = 0
  page.openEndSheet = function () {
    this._opened += 1
  }
  return page
}

function seedPending() {
  const bedAt = Date.now() - 20 * 60 * 1000
  storage.setPending({ id: 'sleep-' + bedAt, bedAt, expectedWakeAt: bedAt + 8 * 3600000 })
}

test('提醒落地：remind=sleep 已在计时也不弹结束面板（防误存短睡眠）', () => {
  resetStore()
  seedPending()
  const page = intentPage({ remind: 'sleep' })
  page.consumeLaunchIntent()
  assert.equal(page._opened, 0)
  assert.match(page.data.notice, /安心睡/)
  // 只消费一次：再次回前台不重复提示
  page.data.notice = ''
  page.consumeLaunchIntent()
  assert.equal(page.data.notice, '')
})

test('提醒落地：remind=sleep 未计时只提示去打卡，不说“已经结束过了”', () => {
  resetStore()
  const page = intentPage({ remind: 'sleep' })
  page.consumeLaunchIntent()
  assert.equal(page._opened, 0)
  assert.doesNotMatch(page.data.notice, /结束过了/)
})

test('提醒落地：remind=wake 在计时打开结束面板，未计时引导补记', () => {
  resetStore()
  seedPending()
  const running = intentPage({ remind: 'wake' })
  running.consumeLaunchIntent()
  assert.equal(running._opened, 1)

  resetStore()
  const idle = intentPage({ remind: 'wake' })
  idle.consumeLaunchIntent()
  assert.equal(idle._opened, 0)
  assert.match(idle.data.notice, /补记入睡/)
})

test('提醒落地：打卡会话 end=1 行为不变', () => {
  resetStore()
  seedPending()
  const page = intentPage({ end: '1' })
  page.consumeLaunchIntent()
  assert.equal(page._opened, 1)

  resetStore()
  const done = intentPage({ end: '1' })
  done.consumeLaunchIntent()
  assert.equal(done.data.notice, '这次入睡已经结束过了')
})
