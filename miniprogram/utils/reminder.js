/**
 * 结束入睡提醒：
 * - 主路径：用户点击后申请一次性订阅消息，服务端在预计起床时间发送；
 * - 兜底：写入手机日历（不能深链回小程序，只写说明）。
 *
 * 微信没有“常驻状态”API；不通过静音后台音频伪造常驻。
 */
const api = require('./api')
const { withLogin } = require('./login')
const { getConfig } = require('./config')
const storage = require('./storage')

// 计算器结果 → 入睡页的“计划起床时刻”寿命：算完超过 12 小时才打卡，就不再代表这一觉
const PLAN_TARGET_TTL = 12 * 60 * 60 * 1000
// 计划起床时刻只接受“打卡之后 16 小时内”，否则回退偏好
const PLAN_TARGET_MAX_AHEAD = 16 * 60 * 60 * 1000

function templateId() {
  const config = getConfig()
  const reminder = config.reminder || {}
  // 后台显式关闭后，客户端不再弹订阅授权，直接走“加入手机日历”兜底
  if (reminder.enabled === false) return ''
  return reminder.templateId || ''
}

function requestOptIn() {
  const id = templateId()
  if (!id) return Promise.resolve({ ok: false, reason: 'not_configured' })
  return new Promise((resolve) => {
    wx.requestSubscribeMessage({
      tmplIds: [id],
      success(res) {
        resolve({ ok: !!res && res[id] === 'accept', reason: res && res[id] })
      },
      fail() {
        resolve({ ok: false, reason: 'rejected' })
      }
    })
  })
}

function schedule(pending) {
  const id = templateId()
  if (!id || !pending || !pending.id || !pending.expectedWakeAt) {
    return Promise.resolve({ skipped: 'not_configured' })
  }
  // 与 scheduleAt 同口径：服务端只接受未来 1 分钟–48 小时。
  // 24h 未结束的 pending 其 expectedWakeAt 可能已过，先挡下避免“已开启”的假状态。
  const at = Number(pending.expectedWakeAt)
  if (!Number.isFinite(at) || at < Date.now() + 60 * 1000) {
    return Promise.resolve({ skipped: 'too_soon' })
  }
  return withLogin((code) => api.createReminder(code, pending.id, at))
}

/**
 * 结果面「到点提醒我」：不依赖打卡（还没有 pending），用 plan- 前缀的临时 sessionId。
 * kind=sleep（提醒入睡）/ wake（提醒起床），服务端按前缀决定消息里的事项文案。
 */
function scheduleAt(fireAt, kind) {
  const id = templateId()
  if (!id) return Promise.resolve({ skipped: 'not_configured' })
  const at = Number(fireAt)
  // 服务端要求未来 1 分钟–48 小时；客户端先挡一次，避免无意义的授权弹窗
  if (!Number.isFinite(at) || at < Date.now() + 60 * 1000) {
    return Promise.resolve({ skipped: 'too_soon' })
  }
  return withLogin((code) => api.createReminder(code, planIdOf(kind, at), at))
}

function cancel(pendingId) {
  if (!pendingId) return Promise.resolve({ skipped: 'no_session' })
  return withLogin((code) => api.cancelReminder(code, pendingId))
}

function addCalendar(fireAt, title, description) {
  if (!wx.addPhoneCalendar) return Promise.resolve(false)
  return new Promise((resolve) => {
    wx.addPhoneCalendar({
      title: title || '睡点：该结束入睡啦',
      description: description || '打开睡点，结束本次入睡并校准起床时间。',
      startTime: Math.floor(fireAt / 1000),
      endTime: Math.floor(fireAt / 1000) + 15 * 60,
      alarm: true,
      alarmOffset: 0,
      success() {
        resolve(true)
      },
      fail() {
        resolve(false)
      }
    })
  })
}

/**
 * 结果面「去入睡打卡」写入算出的起床时刻；入睡页打卡时优先用它作为 expectedWakeAt，
 * 否则入睡模式算出 06:45 起床、打卡却按偏好 07:30 判超时与发提醒。只存本机、不同步。
 */
function savePlanTarget(wakeAt, now) {
  const at = Number(wakeAt)
  if (!Number.isFinite(at) || at <= 0) return false
  return !!storage.patchMeta({ planTarget: { wakeAt: at, createdAt: Number(now) || Date.now() } })
}

/** 取出并清除（只消费一次）；过期或不在合理窗口内返回 0 */
function takePlanTarget(now) {
  const current = Number(now) || Date.now()
  const target = storage.getMeta().planTarget
  if (!target) return 0
  storage.patchMeta({ planTarget: null })
  const wakeAt = Number(target.wakeAt) || 0
  const createdAt = Number(target.createdAt) || 0
  if (current - createdAt > PLAN_TARGET_TTL || createdAt > current + 60 * 1000) return 0
  if (wakeAt <= current || wakeAt > current + PLAN_TARGET_MAX_AHEAD) return 0
  return wakeAt
}

/** 当前仍有效（未到点）的结果面提醒；没有返回 null */
function getPlanReminder(now) {
  const item = storage.getMeta().planReminder
  if (!item || !item.at || !item.id) return null
  if (Number(item.at) <= (Number(now) || Date.now())) return null
  return item
}

function planIdOf(kind, at) {
  return (kind === 'wake' ? 'plan-w-' : 'plan-s-') + Number(at)
}

function setPlanReminder(kind, at) {
  return !!storage.patchMeta({
    planReminder: { kind: kind === 'wake' ? 'wake' : 'sleep', at: Number(at), id: planIdOf(kind, at) }
  })
}

/** 取消尚未到点的结果面提醒（改时间重设 / 清除全部数据）；本地记录同时清掉 */
function cancelPlanReminder(now) {
  const item = getPlanReminder(now)
  storage.patchMeta({ planReminder: null })
  if (!item) return Promise.resolve({ skipped: 'none' })
  return cancel(item.id)
}

module.exports = {
  templateId,
  requestOptIn,
  schedule,
  scheduleAt,
  cancel,
  addCalendar,
  savePlanTarget,
  takePlanTarget,
  getPlanReminder,
  setPlanReminder,
  cancelPlanReminder,
  planIdOf
}
