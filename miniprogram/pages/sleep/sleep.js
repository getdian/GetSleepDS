const T = require('../../utils/time')
const F = require('../../utils/format')
const P = require('../../utils/plan')
const S = require('../../utils/stats')
const reminder = require('../../utils/reminder')
const storage = require('../../utils/storage')
const { syncNow } = require('../../utils/sync')
const events = require('../../utils/events')
const adSlots = require('../../utils/ads')

const MAX_SLEEP_MS = 24 * 60 * 60 * 1000
// 超过 24h 不静默清除，只标记为“需要校准”；用户可手动结束/编辑
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
    reminderOn: false,
    overdue: false,
    overdueText: '',
    endShow: false,
    endBedTime: '',
    endWakeTime: '',
    endDayText: '',
    endDurationText: '',
    endError: '',
    dim: false,
    notice: '',
    weekDays: [],
    weekCount: 0,
    streak: 0,
    canOverwrite: false,
    overwriteText: '再记今晚（覆盖今天旧记录）',
    footerText: '愿今夜好眠'
  },

  onLoad(options) {
    this._alive = true
    this._busy = false
    this._pending = null
    this._autoEnd = !!(options && options.end === '1')
    this._dimTimer = null
    this._noticeTimer = null
    this._clockTimer = null
    this._endBedAt = 0
    this._endWakeAt = 0
    this._endBaseDay = 0
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
    // 订阅消息点进来：直接打开结束面板；没有 pending 说明已在别处结束
    if (this._autoEnd) {
      this._autoEnd = false
      const pending = storage.getPending()
      if (pending) this.openEndSheet()
      else this.setData({ notice: '这次入睡已经结束过了' })
    }
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
      const saved = Object.keys(records)
        .map((key) => records[key])
        .filter((item) => item && Array.isArray(item.sessions))
        .filter((item) =>
          item.sessions.some(
            (session) =>
              session.id === pending.id || (session.startAt === pending.bedAt && session.endAt)
          )
        )[0]
      if (saved) {
        storage.clearPending()
        pending = null
      }
    }
    // 新口径：一次睡眠归到醒来日，页面按自然日查今天的记录
    const todayKey = T.dateKey(now)
    let state = 'idle'
    let record = null

    if (pending) {
      state = 'sleeping'
    } else {
      // 跨午间起床时记录可能仍属于昨天，回看 12 小时内完成的记录
      record = records[todayKey] || this.recentCompleted(records, now)
      if (record) state = 'done'
    }

    this._pending = pending
    const button = this.buildButton(state, pending, record)
    const weekly = S.weekly(records, now)
    // 多段记录：完成态始终可以再记一段，不再覆盖旧记录
    const canOverwrite = state === 'done'
    const crossDay = !!record && record.day !== todayKey
    const hour = new Date(now).getHours()
    const evening = hour >= 18
    const nowText = F.fmtClockTs(now)
    const sleeping = state === 'sleeping'
    const done = state === 'done'
    const expectedWakeAt = pending ? Number(pending.expectedWakeAt) || 0 : 0
    const overdue = !!(sleeping && expectedWakeAt && now > expectedWakeAt + 5 * 60 * 1000)
    const overdueText = overdue
      ? '已超过预计起床 ' + F.fmtDuration(Math.round((now - expectedWakeAt) / 60000))
      : ''

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
      orbCaption: sleeping
        ? overdue
          ? '已超过预计起床，轻触结束并校准'
          : '轻触圆环，记录起床'
        : '轻触圆环，记录入睡',
      reminderOn: !!(pending && pending.reminderOptIn),
      overdue,
      overdueText,
      record,
      recordView: record
        ? {
            bed: F.fmtClockTs(record.bedAt),
            wake: F.fmtClockTs(record.wakeAt),
            // 当天总睡眠含午休/间断段；时间轴仍显示主睡眠
            duration: F.fmtDuration(S.totalDurationOf(record)),
            total: F.fmtDuration(S.totalDurationOf(record)),
            mainId: (S.sessionsOf(record)[0] || {}).id || '',
            sessions: S.sessionsOf(record).map((item) => ({
              id: item.id,
              day: record.day,
              bed: F.fmtClockTs(item.startAt),
              wake: F.fmtClockTs(item.endAt),
              duration: F.fmtDuration(item.durationMin)
            }))
          }
        : null,
      recordHint: done ? '' : sleeping ? '' : '只记录时间，不做睡眠评价',
      buttonTitle: button.title,
      buttonSub: button.sub,
      canOverwrite,
      overwriteText: crossDay
        ? '再记一段'
        : evening
          ? '再记一段（同一天可多段）'
          : '再记一段（午休/间断睡眠）',
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
      return { title: '已完成', sub: '当天共睡 ' + F.fmtDuration(S.totalDurationOf(record)) }
    }
    return { title: '入睡', sub: '现在 ' + F.fmtClockTs(Date.now()) }
  },

  buildWeekDays(records, now, pending) {
    const base = T.parseDateKey(T.dateKey(now))
    const pendingDay = pending ? T.dateKey(now) : ''
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
      // 不再静默丢弃：保留 pending，让用户手动结束/校准，避免丢整晚记录
      this.setData({
        notice: '这次入睡已超过 24 小时，请点圆环结束并校准时间'
      })
      clearTimeout(this._noticeTimer)
      this._noticeTimer = setTimeout(() => {
        if (this._alive) this.setData({ notice: '' })
      }, 8000)
    }
  },

  onPrimaryTap() {
    if (this._busy || this.data.dim) return
    if (Date.now() - (this._lastTapAt || 0) < 600) return
    this._lastTapAt = Date.now()

    if (this.data.state === 'idle') {
      this.markSleep()
    } else if (this.data.state === 'sleeping') {
      this.openEndSheet()
    }
  },

  /** 预计起床：夜间按用户起床偏好，白天小睡默认 90 分钟 */
  defaultExpectedWake(now) {
    const prefs = storage.getPrefs()
    const wakeMinutes = T.parseClock(prefs.wakeTime || '07:30')
    const hour = new Date(now).getHours()
    if (hour >= 18 || hour < 6) return P.nextWakeAt(now, wakeMinutes, 15)
    return now + 90 * 60 * 1000
  },

  onReminderTap() {
    const pending = this._pending || storage.getPending()
    if (!pending) return
    const fireAt = Number(pending.expectedWakeAt) || this.defaultExpectedWake(pending.bedAt)
    reminder
      .requestOptIn()
      .then((result) => {
        if (!result.ok) {
          this.offerCalendar(fireAt, result.reason === 'not_configured' ? '订阅提醒暂未配置' : '没有开启订阅提醒')
          return
        }
        const next = Object.assign({}, pending, { reminderOptIn: true, expectedWakeAt: fireAt })
        if (!storage.setPending(next)) {
          wx.showToast({ title: '本地状态保存失败', icon: 'none' })
          return
        }
        this._pending = next
        this.refresh()
        return reminder.schedule(next).then(() => {
          wx.showToast({ title: '已设置到点提醒', icon: 'none' })
        })
      })
      .catch(() => this.offerCalendar(fireAt, '提醒服务暂不可用'))
  },

  offerCalendar(fireAt, reason) {
    wx.showModal({
      title: '加到手机日历？',
      content: (reason ? reason + '。' : '') + '可以把结束提醒加到系统日历，到点由日历提醒你。',
      confirmText: '加入日历',
      cancelText: '不用',
      success: (res) => {
        if (!res.confirm) return
        reminder.addCalendar(fireAt).then((ok) => {
          wx.showToast({ title: ok ? '已加入手机日历' : '加入失败，可稍后重试', icon: 'none' })
        })
      }
    })
  },

  markSleep(options) {
    this._busy = true
    const now = Date.now()
    const pending = {
      bedAt: now,
      expectedWakeAt: this.defaultExpectedWake(now),
      reminderOptIn: false,
      id: 'sleep-' + now
    }
    if (!storage.setPending(pending)) {
      this._busy = false
      wx.showToast({ title: '本地存储写入失败，请稍后重试', icon: 'none' })
      return false
    }
    this._pending = pending
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

  /** 打开结束面板：默认现在起床，允许校准入睡/起床时间 */
  openEndSheet() {
    const pending = this._pending || storage.getPending()
    if (!pending) {
      this.refresh()
      return
    }
    const now = Date.now()
    if (now - pending.bedAt < 60 * 1000) {
      wx.showToast({ title: '刚睡下，再等等', icon: 'none' })
      return
    }
    this._pending = pending
    this._endBaseDay = T.startOfDay(now)
    this.setData(
      {
        endShow: true,
        endBedTime: F.fmtClockTs(pending.bedAt),
        endWakeTime: F.fmtClockTs(now),
        endError: ''
      },
      () => this.computeEndSheet()
    )
  },

  computeEndSheet() {
    const now = Date.now()
    const todayBase = this._endBaseDay || T.startOfDay(now)
    const bedMinutes = T.parseClock(this.data.endBedTime)
    const wakeMinutes = T.parseClock(this.data.endWakeTime)
    let wakeAt = T.clockTs(todayBase, wakeMinutes)
    let bedAt = T.clockTs(todayBase, bedMinutes)
    // 入睡晚于起床时，说明是昨晚入睡；不能把“23:30 入睡”落到今天 23:30
    if (bedAt >= wakeAt) bedAt -= T.DAY_MS
    const durationMin = Math.round((wakeAt - bedAt) / 60000)
    let error = ''
    if (wakeAt > now + 60 * 1000) error = '起床时间不能晚于现在'
    else if (durationMin < 1) error = '睡眠时长至少 1 分钟'
    else if (wakeAt - bedAt > MAX_SLEEP_MS) error = '单段睡眠不能超过 24 小时'
    this._endBedAt = bedAt
    this._endWakeAt = wakeAt
    this.setData({
      endDayText: F.fmtDayCN(T.dateKey(wakeAt)),
      endDurationText: durationMin > 0 ? F.fmtDuration(durationMin) : '—',
      endError: error
    })
  },

  onEndTimeChange(event) {
    const field = event.currentTarget.dataset.field
    const value = event.detail.value
    if (field !== 'endBedTime' && field !== 'endWakeTime') return
    this.setData({ [field]: value }, () => this.computeEndSheet())
  },

  onEndCancel() {
    this._editingDay = ''
    this._editingSessionId = ''
    this.setData({ endShow: false, endError: '' })
  },

  /** 编辑某一段：打开同一套结束面板，保存时走 updateSession */
  onEditSession(event) {
    const id = event.currentTarget.dataset.id
    const day = event.currentTarget.dataset.day
    const record = this.data.record
    if (!record || !id || day !== record.day) return
    const session = S.sessionsOf(record).filter((item) => item.id === id)[0]
    if (!session) return
    this._editingDay = day
    this._editingSessionId = id
    this._endBaseDay = T.startOfDay(session.endAt)
    this.setData(
      {
        endShow: true,
        endBedTime: F.fmtClockTs(session.startAt),
        endWakeTime: F.fmtClockTs(session.endAt),
        endError: ''
      },
      () => this.computeEndSheet()
    )
  },

  onEndConfirm() {
    if (this.data.endError || !this._endBedAt || !this._endWakeAt) return
    if (this._editingSessionId) {
      const editingRecord = this.data.record
      const legacy = !editingRecord || editingRecord.dayRule !== 'wake-v1'
      if (!legacy && T.dateKey(this._endWakeAt) !== this._editingDay) {
        this.setData({ endError: '编辑后醒来日会变化，请撤销后重新记录' })
        return
      }
      const updated = storage.updateSession(
        this._editingDay,
        this._editingSessionId,
        this._endBedAt,
        this._endWakeAt
      )
      if (!updated) {
        wx.showToast({ title: '修改未写入，请重试一次', icon: 'none' })
        return
      }
      this._editingDay = ''
      this._editingSessionId = ''
      this.setData({ endShow: false, endError: '' })
      this.refresh()
      wx.showToast({ title: '时间已更新', icon: 'none' })
      syncNow(true).catch(() => {})
      return
    }

    const pending = this._pending || storage.getPending()
    if (!pending) {
      this.setData({ endShow: false })
      this.refresh()
      return
    }
    const record = storage.saveSession({
      id: pending.id || 'sleep-' + pending.bedAt,
      startAt: this._endBedAt,
      endAt: this._endWakeAt,
      durationMin: Math.round((this._endWakeAt - this._endBedAt) / 60000),
      source: 'manual',
      editedAt: Date.now()
    })
    if (!record) {
      wx.showToast({ title: '记录未完整写入，请重试一次', icon: 'none' })
      return
    }
    reminder.cancel(pending.id).catch(() => {})
    const cleared = storage.clearPending()
    this._pending = null
    this.setData({ endShow: false, endError: '' })
    this.refresh()
    wx.showToast({ title: cleared ? '已记录，可随时校准' : '已记录（会话清理稍后重试）', icon: 'none' })
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

  /** 完成态再记一段：不覆盖已有记录，追加午休/间断睡眠 */
  onAddSession() {
    const record = this.data.record
    if (!record || this.data.state === 'sleeping') return
    wx.showModal({
      title: '再记一段睡眠',
      content: '同一天可以记录多段（午休、夜间醒来后再睡）。新的一段会追加，不会覆盖已有记录。',
      confirmText: '开始记录',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return
        if (this.markSleep()) wx.showToast({ title: '已开始记录新的一段', icon: 'none' })
      }
    })
  },

  onOverwriteTonight() {
    this.onAddSession()
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
        const pending = this._pending || storage.getPending()
        if (pending && pending.id) reminder.cancel(pending.id).catch(() => {})
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

  noop() {},

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
