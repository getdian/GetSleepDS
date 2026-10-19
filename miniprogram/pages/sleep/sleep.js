const T = require('../../utils/time')
const F = require('../../utils/format')
const S = require('../../utils/stats')
const storage = require('../../utils/storage')
const { syncNow } = require('../../utils/sync')
const events = require('../../utils/events')

const MAX_SLEEP_MS = 20 * 60 * 60 * 1000
const STALE_PENDING_MS = MAX_SLEEP_MS
const CLOCK_INTERVAL = 30 * 1000
const WEEK_LABEL = ['日', '一', '二', '三', '四', '五', '六']

Page({
  data: {
    dateText: '',
    greeting: '',
    state: 'idle',
    stateText: '未记录',
    buttonTitle: '入睡',
    buttonSub: '',
    record: null,
    recordView: null,
    recordHint: '',
    dim: false,
    notice: '',
    weekDays: [],
    weekCount: 0,
    streak: 0,
    canOverwrite: false,
    footerText: '愿今夜好眠'
  },

  onLoad() {
    this._alive = true
    this._busy = false
    this._pending = null
    this._dimTimer = null
    this._noticeTimer = null
    this._clockTimer = null
    this.refresh()
  },

  onShow() {
    this._alive = true
    this.refresh()
    this.startClock()
  },

  onHide() {
    this.stopClock()
  },

  onUnload() {
    this._alive = false
    this.stopClock()
    clearTimeout(this._dimTimer)
    clearTimeout(this._noticeTimer)
  },

  startClock() {
    this.stopClock()
    this._clockTimer = setInterval(() => {
      if (this._alive) this.refresh()
    }, CLOCK_INTERVAL)
  },

  stopClock() {
    if (this._clockTimer) {
      clearInterval(this._clockTimer)
      this._clockTimer = null
    }
  },

  refresh() {
    if (!this._alive) return
    const now = Date.now()
    const records = storage.getRecords()
    this.pruneStalePending(now)

    const pending = storage.getPending()
    const todayKey = T.sleepDayOf(now)
    let state = 'idle'
    let record = null

    if (pending) {
      state = 'sleeping'
    } else if (records[todayKey]) {
      state = 'done'
      record = records[todayKey]
    }

    this._pending = pending
    const button = this.buildButton(state, pending, record)
    const weekly = S.weekly(records, now)
    const canOverwrite = state === 'done' && new Date(now).getHours() >= 18

    this.setData({
      dateText: F.fmtDateCN(now),
      greeting: F.greeting(now),
      state,
      stateText: state === 'idle' ? '未记录' : state === 'sleeping' ? '睡梦中' : '已完成',
      record,
      recordView: record
        ? {
            bed: F.fmtClockTs(record.bedAt),
            wake: F.fmtClockTs(record.wakeAt),
            duration: F.fmtDuration(record.durationMin)
          }
        : null,
      recordHint:
        state === 'idle'
          ? '点击开始记录入睡时间'
          : state === 'sleeping'
            ? '已入睡 ' + F.fmtClockTs(pending.bedAt) + '，早上记得记录起床'
            : canOverwrite
              ? '今天已有一笔记录，可在下方覆盖为今晚'
              : '今晚的记录已完成',
      buttonTitle: button.title,
      buttonSub: button.sub,
      canOverwrite,
      weekDays: this.buildWeekDays(records, now, pending),
      weekCount: weekly.current.count,
      streak: weekly.streak,
      footerText: state === 'done' ? '晚安，明天见。' : state === 'sleeping' ? '夜色正安' : '愿今夜好眠'
    })
  },

  buildButton(state, pending, record) {
    if (state === 'sleeping' && pending) {
      return { title: '记录起床', sub: '已入睡 ' + F.fmtClockTs(pending.bedAt) }
    }
    if (state === 'done' && record) {
      return { title: '已完成', sub: '睡了 ' + F.fmtDuration(record.durationMin) }
    }
    return { title: '入睡', sub: '现在 ' + F.fmtClockTs(Date.now()) }
  },

  buildWeekDays(records, now, pending) {
    const base = T.parseDateKey(T.sleepDayOf(now))
    const pendingDay = pending ? T.sleepDayOf(pending.bedAt) : ''
    const days = []
    for (let i = 6; i >= 0; i -= 1) {
      const ts = T.addDays(base, -i)
      const key = T.dateKey(ts)
      const record = records[key]
      days.push({
        key,
        weekday: WEEK_LABEL[new Date(ts).getDay()],
        level: record ? S.levelOf(record.durationMin) : 0,
        partial: !record && key === pendingDay,
        today: i === 0
      })
    }
    return days
  },

  pruneStalePending(now) {
    const pending = storage.getPending()
    if (!pending) return
    if (now - pending.bedAt > STALE_PENDING_MS) {
      storage.clearPending()
      this.setData({ notice: '上次打卡没记录起床，已清除' })
      clearTimeout(this._noticeTimer)
      this._noticeTimer = setTimeout(() => {
        if (this._alive) this.setData({ notice: '' })
      }, 5000)
    }
  },

  onPrimaryTap() {
    if (this._busy || this.data.dim) return
    if (Date.now() - (this._lastTapAt || 0) < 600) return
    this._lastTapAt = Date.now()

    if (this.data.state === 'idle') {
      this.markSleep()
    } else if (this.data.state === 'sleeping') {
      this.markWake()
    }
  },

  markSleep() {
    this._busy = true
    const now = Date.now()
    if (!storage.setPending(now)) {
      this._busy = false
      wx.showToast({ title: '本地存储失败，请清理空间后重试', icon: 'none' })
      return
    }
    this._pending = { bedAt: now }
    this.refresh()
    this.setData({ dim: true })

    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })

    clearTimeout(this._dimTimer)
    this._dimTimer = setTimeout(() => {
      if (this._alive) this.setData({ dim: false })
    }, 1600)

    this._busy = false
  },

  markWake() {
    const pending = this._pending || storage.getPending()
    if (!pending) {
      this.refresh()
      return
    }

    const now = Date.now()
    const elapsed = now - pending.bedAt
    if (elapsed < 60 * 1000) {
      wx.showToast({ title: '刚睡下，再等等', icon: 'none' })
      return
    }
    if (elapsed > MAX_SLEEP_MS) {
      storage.clearPending()
      this._pending = null
      this.refresh()
      wx.showToast({ title: '间隔超过 20 小时，本次不记录', icon: 'none' })
      return
    }

    const record = {
      day: T.sleepDayOf(pending.bedAt),
      bedAt: pending.bedAt,
      wakeAt: now,
      durationMin: Math.round(elapsed / 60000),
      updatedAt: now
    }

    if (!storage.saveRecord(record)) {
      wx.showToast({ title: '本地存储失败，尚未记录', icon: 'none' })
      return
    }
    storage.clearPending()
    this._pending = null

    this.refresh()
    wx.showToast({ title: '早安，已记录', icon: 'none' })
    events.track('checkin', record.day)
    syncNow(true)
      .then((res) => {
        if (res && res.skipped === 'stale') return
        if (res && res.synced === 0 && res.dropped > 0) {
          wx.showToast({ title: '记录已存本机，云端校验未通过', icon: 'none' })
        }
      })
      .catch(() => {
        wx.showToast({ title: '已记录，云端备份稍后重试', icon: 'none' })
      })
  },

  /** C 态覆盖：白天小睡占用了当天名额时，晚间允许重新开始今晚的记录 */
  onOverwriteTonight() {
    const record = this.data.record
    if (!record) return
    wx.showModal({
      title: '记录今晚的睡眠',
      content: '今天已有一笔 ' + F.fmtDuration(record.durationMin) + ' 的记录，继续后会覆盖它。',
      confirmText: '继续记录',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return
        storage.clearPending()
        this._pending = null
        this.markSleep()
        wx.showToast({ title: '已开始记录今晚', icon: 'none' })
      }
    })
  },

  onUndoTap() {
    const record = this.data.record
    if (!record) return
    wx.showModal({
      title: '撤销这次记录？',
      content: '撤销后可以重新打卡',
      confirmText: '撤销',
      confirmColor: '#F87171',
      success: (res) => {
        if (!res.confirm) return
        storage.removeRecord(record.day)
        this.refresh()
        // 把本地墓碑同步到云端，换机后也不会被旧记录回填
        syncNow(true).catch(() => {})
      }
    })
  },

  /** 已入睡但点错了：只清进行中的会话，不产生任何记录 */
  onUndoBed() {
    wx.showModal({
      title: '撤销本次入睡',
      content: '取消刚才的入睡打卡？不会产生任何记录。',
      confirmText: '撤销',
      cancelText: '保留',
      success: (res) => {
        if (!res.confirm) return
        storage.clearPending()
        this._pending = null
        this.refresh()
        wx.showToast({ title: '已撤销', icon: 'none' })
      }
    })
  },

  onNoticeClose() {
    this.setData({ notice: '' })
  },

  goStats() {
    wx.switchTab({ url: '/pages/stats/stats' })
  }
})
