const T = require('../../utils/time')
const F = require('../../utils/format')
const P = require('../../utils/plan')
const S = require('../../utils/stats')
// 睡眠段（rangeForDay/rangeBetween/findOverlap）在 sessions 里，不在 stats：
// stats 只做按天聚合的门面，别把“段”的逻辑混进来。
const X = require('../../utils/sessions')
const reminder = require('../../utils/reminder')
const tabbar = require('../../utils/tabbar')
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
    endMode: 'pending',
    endDate: '',
    endDateText: '',
    endDateMin: '',
    endStartDateText: '',
    endStale: false,
    endToday: '',
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
    canAddSession: false,
    overwriteText: '再记一段（现在开始计时）',
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
    this._staleNoticeKey = ''
    this._endBedAt = 0
    this._endWakeAt = 0
    this._endBaseDay = 0
    this._endStartDay = 0
    const now = Date.now()
    this.setData({
      endToday: T.dateKey(now),
      endDateMin: T.dateKey(T.addDays(now, -400))
    })
    this.refreshAll()
    adSlots.apply(this)
  },

  onShow() {
    this._alive = true
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) tabBar.setData({ selected: 1 })
    this.refreshAll()
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
      if (this._alive) this.refreshClock()
    }, CLOCK_INTERVAL)
  },

  stopClock() {
    if (this._clockTimer) {
      clearInterval(this._clockTimer)
      this._clockTimer = null
    }
  },

  /**
   * 30 秒时钟：只刷新随时间变化的展示字段。
   * 之前每 30 秒都跑一次 refresh()（全表读存储 + 周统计 + 30 多个字段 setData），
   * 低端机切页/亮屏时容易掉帧。跨自然日才升级成全量刷新。
   */
  refreshClock() {
    if (!this._alive) return
    const now = Date.now()
    if (T.dateKey(now) !== this.data.endToday) {
      this.refreshAll()
      return
    }
    const pending = this._pending
    if (!pending) {
      this.setData({ nowText: F.fmtClockTs(now) })
      return
    }
    const expectedWakeAt = Number(pending.expectedWakeAt) || 0
    const overdue = !!(expectedWakeAt && now > expectedWakeAt + 5 * 60 * 1000)
    const slept = F.fmtDuration(Math.round((now - pending.bedAt) / 60000))
    this.setData({
      nowText: F.fmtClockTs(now),
      orbTime: F.fmtClockTs(pending.bedAt),
      orbMeta: '已睡 ' + slept,
      buttonSub: '已睡 ' + slept,
      overdue,
      overdueText: overdue
        ? '已超过预计起床 ' + F.fmtDuration(Math.round((now - expectedWakeAt) / 60000))
        : '',
      orbCaption: overdue ? '已超过预计起床，轻触结束并校准' : '轻触圆环，记录起床'
    })
    this.pruneStalePending(pending, now)
  },

  refreshAll() {
    if (!this._alive) return
    const now = Date.now()
    const records = storage.getRecords()

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
    this.pruneStalePending(pending, now)
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
    const canAddSession = state === 'done'
    const hour = new Date(now).getHours()
    const nowText = F.fmtClockTs(now)
    const sleeping = state === 'sleeping'
    const done = state === 'done'
    const expectedWakeAt = pending ? Number(pending.expectedWakeAt) || 0 : 0
    const overdue = !!(sleeping && expectedWakeAt && now > expectedWakeAt + 5 * 60 * 1000)
    const overdueText = overdue
      ? '已超过预计起床 ' + F.fmtDuration(Math.round((now - expectedWakeAt) / 60000))
      : ''

    // 跨自然日（tab 页常驻）后日期上限必须跟着走，否则补记选不到“今天”
    const endToday = todayKey
    const endDateText =
      this.data.endShow && this.data.endMode !== 'edit' && this.data.endDate
        ? this.dateTextOf(this.data.endDate)
        : this.data.endDateText

    this.setData({
      dateText: F.fmtDateCN(now),
      greeting: F.greeting(now),
      endToday,
      endDateText,
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
      canAddSession,
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

  /** 超过 24h 的 pending 不再静默清除；同一个 pending 只提示一次，避免 30 秒一闪 */
  pruneStalePending(pending, now) {
    if (!pending) {
      this._staleNoticeKey = ''
      return
    }
    if (now - pending.bedAt <= STALE_PENDING_MS) return
    const key = pending.id || 'bed-' + pending.bedAt
    if (this._staleNoticeKey === key) return
    this._staleNoticeKey = key
    this.setData({
      notice: '这次入睡已超过 24 小时，请点圆环结束并校准时间'
    })
    clearTimeout(this._noticeTimer)
    this._noticeTimer = setTimeout(() => {
      if (this._alive) this.setData({ notice: '' })
    }, 8000)
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
        this.refreshAll()
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
    this.refreshAll()
    this.setData({ dim: true })

    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })

    clearTimeout(this._dimTimer)
    this._dimTimer = setTimeout(() => {
      if (this._alive) this.setData({ dim: false })
    }, 1600)

    this._busy = false
    return true
  },

  /** 日期文案：今天/昨天加后缀，跨午夜后也不会停在旧口径 */
  dateTextOf(key) {
    const now = Date.now()
    const today = T.dateKey(now)
    const yesterday = T.dateKey(T.addDays(now, -1))
    if (key === today) return F.fmtDayCN(key) + ' · 今天'
    if (key === yesterday) return F.fmtDayCN(key) + ' · 昨天'
    return F.fmtDayCN(key)
  },

  /**
   * 打开结束面板：入睡日取自 pending 的真实打卡日，醒来日默认今天 + 当前时间。
   * 忘记结束超过 24 小时时，醒来日改成“入睡日次日 + 常用起床时间”并显式可选，
   * 否则两天前 23:00 的入睡会被算成昨天 23:00（时长/归属双错）。
   */
  openEndSheet() {
    const pending = this._pending || storage.getPending()
    if (!pending) {
      this.refreshAll()
      return
    }
    const now = Date.now()
    if (now - pending.bedAt < 60 * 1000) {
      wx.showToast({ title: '刚睡下，再等等', icon: 'none' })
      return
    }
    this._pending = pending
    this._editingDay = ''
    this._editingSessionId = ''
    const bedDay = T.startOfDay(pending.bedAt)
    const stale = now - pending.bedAt > STALE_PENDING_MS
    const wakeDay = stale ? T.addDays(bedDay, 1) : T.startOfDay(now)
    let wakeTime = stale ? storage.getPrefs().wakeTime || '07:30' : F.fmtClockTs(now)
    // 常用起床时间可能还没到（凌晨刚过 24h 时），不能默认一个未来时间
    if (T.clockTs(wakeDay, T.parseClock(wakeTime)) > now) wakeTime = F.fmtClockTs(now)
    this._endBaseDay = wakeDay
    this._endStartDay = bedDay
    // 自定义 tabBar 可能由微信渲染在页面之上，仅靠 z-index 压不住；
    // 打开结束面板时主动隐藏，关闭后恢复（与抽屉/背景选择器同一套机制）。
    this.hideTabbarForSheet()
    this.setData(
      {
        endShow: true,
        endMode: 'pending',
        endStale: stale,
        endDate: T.dateKey(wakeDay),
        endDateText: this.dateTextOf(T.dateKey(wakeDay)),
        endDateMin: T.dateKey(bedDay),
        endStartDateText: stale ? F.fmtDayCN(T.dateKey(bedDay)) : '',
        endBedTime: F.fmtClockTs(pending.bedAt),
        endWakeTime: wakeTime,
        endError: ''
      },
      () => this.computeEndSheet()
    )
  },

  /** 补记一段已经发生的睡眠：不创建 pending、不涉及提醒 */
  openManualSheet() {
    if (this.data.state === 'sleeping') return
    const now = Date.now()
    const start = now - 30 * 60 * 1000
    const today = T.dateKey(now)
    this._editingDay = ''
    this._editingSessionId = ''
    this._endBaseDay = T.startOfDay(now)
    this._endStartDay = 0
    this.hideTabbarForSheet()
    this.setData(
      {
        endShow: true,
        endMode: 'manual',
        endStale: false,
        endDate: today,
        endDateText: this.dateTextOf(today),
        endDateMin: T.dateKey(T.addDays(now, -400)),
        endStartDateText: '',
        endBedTime: F.fmtClockTs(start),
        endWakeTime: F.fmtClockTs(now),
        endError: ''
      },
      () => this.computeEndSheet()
    )
  },

  onEndDateChange(event) {
    const date = event.detail.value
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return
    if (this.data.endMode === 'edit') return
    this._endBaseDay = T.parseDateKey(date)
    this.setData(
      {
        endDate: date,
        endDateText: this.dateTextOf(date)
      },
      () => this.computeEndSheet()
    )
  },

  /** 首帧 tabBar 可能尚未挂载：立即隐藏一次，下一拍再补一次 */
  hideTabbarForSheet() {
    tabbar.hide()
    setTimeout(() => {
      if (this._alive && this.data.endShow) tabbar.hide()
    }, 60)
  },

  computeEndSheet() {
    const now = Date.now()
    const wakeBase = this._endBaseDay || T.startOfDay(now)
    const bedMinutes = T.parseClock(this.data.endBedTime)
    const wakeMinutes = T.parseClock(this.data.endWakeTime)
    // pending 的入睡日是打卡那一刻，精确到天；补记/编辑仍按“醒来日 + 跨午夜回退一天”
    const range =
      this.data.endMode === 'pending' && this._endStartDay
        ? X.rangeBetween(this._endStartDay, bedMinutes, wakeBase, wakeMinutes, now)
        : X.rangeForDay(wakeBase, bedMinutes, wakeMinutes, now)
    let error = ''
    if (range.error === 'future') error = '起床时间不能晚于现在'
    else if (range.error === 'short') error = '睡眠时长至少 1 分钟'
    else if (range.error === 'order') error = '入睡时间需早于起床时间，请检查醒来日'
    else if (range.error === 'long') error = '单段睡眠不能超过 24 小时'
    // 补记/结束/编辑都要先挡重叠，避免存不进去才报“写入失败”。
    // 必须按时间区间查全表：只看醒来日会漏掉前一天那段（跨天双计）。
    if (!error) {
      const excludeId =
        this.data.endMode === 'edit'
          ? this._editingSessionId
          : this.data.endMode === 'pending' && this._pending
            ? this._pending.id
            : ''
      if (X.findOverlap(storage.getRecords(), range.bedAt, range.wakeAt, { id: excludeId })) {
        error = '与已有睡眠段重叠，请调整时间'
      }
    }
    this._endBedAt = range.bedAt
    this._endWakeAt = range.wakeAt
    this.setData({
      endDayText: F.fmtDayCN(T.dateKey(range.wakeAt)),
      endDurationText: range.durationMin > 0 ? F.fmtDuration(range.durationMin) : '—',
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
    this._endStartDay = 0
    tabbar.show()
    this.setData({
      endShow: false,
      endError: '',
      endMode: 'pending',
      endStale: false,
      endStartDateText: ''
    })
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
    this._endStartDay = 0
    this.hideTabbarForSheet()
    this.setData(
      {
        endShow: true,
        endMode: 'edit',
        endStale: false,
        endDate: '',
        endDateText: '',
        endStartDateText: '',
        endBedTime: F.fmtClockTs(session.startAt),
        endWakeTime: F.fmtClockTs(session.endAt),
        endError: ''
      },
      () => this.computeEndSheet()
    )
  },

  onEndConfirm() {
    if (this.data.endError || !this._endBedAt || !this._endWakeAt) return
    if (this.data.endMode === 'manual') {
      this.saveManualSession()
      return
    }
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
      this.finishSave({ toast: '时间已更新' })
      return
    }

    const pending = this._pending || storage.getPending()
    if (!pending) {
      this.closeSheet()
      this.refreshAll()
      return
    }
    const record = storage.saveSession({
      id: pending.id || 'sleep-' + pending.bedAt,
      startAt: this._endBedAt,
      endAt: this._endWakeAt,
      durationMin: Math.round((this._endWakeAt - this._endBedAt) / 60000),
      // 与“补记”区分：这一段是点过入睡、计时结束的真实打卡
      source: 'checkin',
      editedAt: Date.now()
    })
    if (!record) {
      wx.showToast({ title: '记录未完整写入，请重试一次', icon: 'none' })
      return
    }
    reminder.cancel(pending.id).catch(() => {})
    const cleared = storage.clearPending()
    this._pending = null
    this.finishSave({
      toast: cleared ? '已记录，可随时校准' : '已记录（会话清理稍后重试）',
      event: 'checkin'
    })
  },

  /** 保存/编辑成功后的统一收尾：关面板、刷新、埋点、云端反馈 */
  finishSave(options) {
    const opts = options || {}
    this._editingDay = ''
    this._editingSessionId = ''
    this._endStartDay = 0
    this._staleNoticeKey = ''
    this.closeSheet()
    this.refreshAll()
    if (opts.toast) wx.showToast({ title: opts.toast, icon: 'none' })
    if (opts.event) events.track(opts.event, '')
    this.syncAfterSave()
  },

  closeSheet() {
    tabbar.show()
    this.setData({
      endShow: false,
      endError: '',
      endMode: 'pending',
      endStale: false,
      endStartDateText: ''
    })
  },

  /** 保存后同步：区分“跳过/云端拒收/网络失败”，不再只有补记分支有反馈 */
  syncAfterSave() {
    syncNow(true)
      .then((res) => this.reportSyncResult(res))
      .catch(() => {
        wx.showToast({ title: '已存本机，云端稍后重试', icon: 'none' })
      })
  },

  reportSyncResult(res) {
    if (!res || res.skipped === 'stale') return
    if (res.synced === 0 && res.dropped > 0) {
      wx.showToast({ title: '记录已存本机，云端校验未通过', icon: 'none' })
    }
  },

  /** 手动补记一段：不创建 pending、不发提醒，直接落 v2 session */
  saveManualSession() {
    const now = Date.now()
    const record = storage.saveSession({
      id: 'manual-' + now,
      startAt: this._endBedAt,
      endAt: this._endWakeAt,
      durationMin: Math.round((this._endWakeAt - this._endBedAt) / 60000),
      source: 'manual',
      editedAt: now
    })
    if (!record) {
      this.setData({ endError: '补记失败：时间可能与已有段重叠，或当天段数/总时长已满' })
      return
    }
    const day = T.dateKey(this._endWakeAt)
    this.finishSave({ toast: '已补记 ' + F.fmtDayCN(day), event: 'manual_sleep' })
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
        this.refreshAll()
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
        this.refreshAll()
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
