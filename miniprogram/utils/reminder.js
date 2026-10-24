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
  return withLogin((code) => api.createReminder(code, pending.id, pending.expectedWakeAt))
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
  const prefix = kind === 'wake' ? 'plan-w-' : 'plan-s-'
  return withLogin((code) => api.createReminder(code, prefix + at, at))
}

function cancel(pendingId) {
  if (!pendingId) return Promise.resolve({ skipped: 'no_session' })
  return withLogin((code) => api.cancelReminder(code, pendingId))
}

function addCalendar(fireAt, title) {
  if (!wx.addPhoneCalendar) return Promise.resolve(false)
  return new Promise((resolve) => {
    wx.addPhoneCalendar({
      title: title || '睡点：该结束入睡啦',
      description: '打开睡点，结束本次入睡并校准起床时间。',
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

module.exports = { templateId, requestOptIn, schedule, scheduleAt, cancel, addCalendar }
