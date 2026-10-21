const T = require('../../utils/time')
const F = require('../../utils/format')
const S = require('../../utils/stats')
const storage = require('../../utils/storage')
const { syncNow } = require('../../utils/sync')
const events = require('../../utils/events')
const adSlots = require('../../utils/ads')

const MAX_SLEEP_MS = 20 * 60 * 60 * 1000
const STALE_PENDING_MS = MAX_SLEEP_MS
const CLOCK_INTERVAL = 30 * 1000
const WEEK_LABEL = ['日', '一', '二', '三', '四', '五', '六']

Page({
  data: {
    ads: adSlots.empty(),
    dateText: '',
    greeting: '',
    state: 'idle',
    stateText: '未记录',
    nowText: '--:--',
    heroTitle: '我准备睡了',
    heroSub: '记录这一刻，明早回来告诉我几点醒。',
    orbKicker: '当前时间',
    orbTime: '--:--',
    orbMeta: '今晚',
    orbCaption: '轻触圆环，记录入睡',
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
    overwriteText: '再记今晚（覆盖今天旧记录）',
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
    adSlots.apply(this)
  },

  onShow() {
    this._alive = true
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) tabBar.setData({ selected: 1 })
    this.refresh()
    this.startClock()
    adSlots.apply(this)
    this.openPendingAudio()
  },

  /** 计算器/统计页的播放条点击后，sleep 页接管并打开声音抽屉 */
  openPendingAudio() {
    const app = getApp()
    if (!app || !app.globalData || !app.globalData.openAudioSheet) return
    app.globalData.openAudioSheet = false
    let tries = 4
    const tryOpen = () => {
      if (!this._alive) return
      const dock = this.selectComponent('#dock')
      if (dock && dock.openSheet) {
        dock.openSheet()
        return
      }
      tries -= 1
      if (tries > 0) setTimeout(tryOpen, 120)
    }
    setTimeout(tryOpen, 180)
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

    let pending = storage.getPending()
    // 记录已经保存、但 removeStorageSync 失败时，pending 会残留。
    // 只要同一次入睡已经落成记录，就按“已完成”展示并再尝试清一次，避免二次打卡拉长时长。
    if (pending) {
      const saved = records[T.sleepDayOf(pending.bedAt)]
      if (saved && saved.bedAt === pending.bedAt) {
        storage.clearPending()
        pending = null
      }
    }
    const todayKey = T.sleepDayOf(now)
    let state = 'idle'
    let record = null

    if (pending) {
      state = 'sleeping'
    } else {
      // 跨午间起床（如 23:30 入睡、次日 13:00 起床）时记录归属前一天，
      // 只看 todayKey 会把页面打回“未记录”，这里回看 12 小时内完成的记录。
      record = records[todayKey] || this.recentCompleted(records, now)
      if (record) state = 'done'
    }

    this._pending = pending
    const button = this.buildButton(state, pending, record)
    const weekly = S.weekly(records, now)
    const canOverwrite = state === 'done' && S.canStartNewSleep(record, now, todayKey)
    const crossDay = !!record && record.day !== todayKey
    const hour = new Date(now).getHours()
    const evening = hour >= 18
    const nowText = F.fmtClockTs(now)
    const sleeping = state === 'sleeping'
    const done = state === 'done'

    this.setData({
      dateText: F.fmtDateCN(now),
      greeting: F.greeting(now),
      state,
      stateText: state === 'idle' ? '未记录' : sleeping ? '睡梦中' : '已完成',
      nowText,
      heroTitle: done
        ? hour >= 5 && hour < 12
          ? '早安，睡得好吗'
          : '今晚的记录完成了'
        : sleeping
          ? '夜色正浓'
          : '我准备睡了',
      heroSub: done
        ? '入睡与起床时间已经记下。'
        : sleeping
          ? '明早醒来，记得回来记录起床。'
          : '记录这一刻，明早回来告诉我几点醒。',
      orbKicker: sleeping ? '入睡时间' : '当前时间',
      orbTime: sleeping && pending ? F.fmtClockTs(pending.bedAt) : nowText,
      orbMeta:
        sleeping && pending
          ? '已睡 ' + F.fmtDuration(Math.round((now - pending.bedAt) / 60000))
          : '今晚',
      orbCaption: sleeping ? '轻触圆环，记录起床' : '轻触圆环，记录入睡',
      record,
      recordView: record
        ? {
            bed: F.fmtClockTs(record.bedAt),
            wake: F.fmtClockTs(record.wakeAt),
            duration: F.fmtDuration(S.durationOf(record))
          }
        : null,
      recordHint: done ? '' : sleeping ? '' : '只记录时间，不做睡眠评价',
      buttonTitle: button.title,
      buttonSub: button.sub,
      canOverwrite,
      overwriteText: crossDay
        ? '再记今晚'
        : evening
          ? '再记今晚（覆盖今天旧记录）'
          : '现在开始新的睡眠（覆盖旧记录）',
      weekDays: this.buildWeekDays(records, now, pending),
      weekCount: weekly.current.count,
      streak: weekly.streak,
      footerText:
        state === 'done'
          ? new Date(now).getHours() >= 5 && new Date(now).getHours() < 12
            ? '早安，新的一天。'
            : new Date(now).getHours() >= 18 || new Date(now).getHours() < 5
              ? '晚安，明天见。'
              : '今天也辛苦了。'
          : state === 'sleeping'
            ? '夜色正安'
            : '愿今夜好眠'
    })
  },

  /** 最近 12 小时内完成、但睡眠日已滚到昨天的记录 */
  recentCompleted(records, now) {
    const list = S.completedList(records)
    let latest = null
    for (let i = 0; i < list.length; i += 1) {
      const item = list[i]
      if (now < item.wakeAt || now - item.wakeAt >= 12 * 60 * 60 * 1000) continue
      if (!latest || item.wakeAt > latest.wakeAt) latest = item
    }
    return latest
  },

  buildButton(state, pending, record) {
    if (state === 'sleeping' && pending) {
      return {
        title: '记录起床',
        sub: '已睡 ' + F.fmtDuration(Math.round((Date.now() - pending.bedAt) / 60000))
      }
    }
    if (state === 'done' && record) {
      return { title: '已完成', sub: '睡了 ' + F.fmtDuration(S.durationOf(record)) }
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
        level: record ? S.levelOf(S.durationOf(record)) : 0,
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
      wx.showToast({ title: '本地存储写入失败，请稍后重试', icon: 'none' })
      return false
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
    return true
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
      // 可能是记录写入失败，也可能是墓碑清理失败；两种情况重试同一天都是幂等的。
      wx.showToast({ title: '记录未完整写入，请重试一次', icon: 'none' })
      return
    }
    const cleared = storage.clearPending()
    this._pending = null

    this.refresh()
    const hour = new Date(now).getHours()
    wx.showToast({
      title: cleared
        ? hour >= 5 && hour < 12
          ? '早安，已记录'
          : '已记录起床时间'
        : '已记录（会话清理稍后自动重试）',
      icon: 'none'
    })
    // 只上报“发生了一次打卡”，不把具体睡眠日与 openid 关联
    events.track('checkin', '')
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
    const now = Date.now()
    const sameDay = record.day === T.sleepDayOf(now)
    const evening = new Date(now).getHours() >= 18
    wx.showModal({
      title: evening ? '记录今晚的睡眠' : '开始新的睡眠',
      content: sameDay
        ? evening
          ? '今天已有一笔 ' + F.fmtDuration(S.durationOf(record)) + ' 的记录，继续后会覆盖它。'
          : '当前睡眠日已有一笔 ' + F.fmtDuration(S.durationOf(record)) + ' 的记录。继续后，新记录会归入同一睡眠日并覆盖旧记录。'
        : '已有一笔 ' + F.fmtDayCN(record.day) + ' 的记录，继续会开始记录新的睡眠，不会删除旧记录。',
      confirmText: '继续记录',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return
        storage.clearPending()
        this._pending = null
        // 写入失败时 markSleep 内部已提示，不能在这里再弹一次“已开始记录”
        if (this.markSleep()) {
          wx.showToast({ title: evening ? '已开始记录今晚' : '已开始新的记录', icon: 'none' })
        }
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
        if (!storage.removeRecord(record.day)) {
          wx.showToast({ title: '撤销未完成，请重试（避免云端恢复）', icon: 'none' })
          return
        }
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
        if (!storage.clearPending()) {
          wx.showToast({ title: '撤销失败：本地存储写入异常', icon: 'none' })
          return
        }
        this._pending = null
        this.refresh()
        wx.showToast({ title: '已撤销', icon: 'none' })
      }
    })
  },

  onDimTap() {
    clearTimeout(this._dimTimer)
    if (this._alive) this.setData({ dim: false })
  },

  onNoticeClose() {
    this.setData({ notice: '' })
  },

  goStats() {
    wx.switchTab({ url: '/pages/stats/stats' })
  },

  onShareAppMessage() {
    const view = this.data.recordView
    return {
      title: view
        ? '我昨晚 ' + view.bed + ' 睡、' + view.wake + ' 起，一起早睡'
        : '我在「睡点」打卡睡觉，一起早睡',
      path: '/pages/sleep/sleep?from=share'
    }
  }
})
