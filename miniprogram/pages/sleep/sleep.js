const T = require('../../utils/time')
const F = require('../../utils/format')
const P = require('../../utils/plan')
const S = require('../../utils/stats')
// 睡眠段（rangeForDay/rangeBetween/findOverlap）在 sessions 里，不在 stats：
// stats 只做按天聚合的门面，别把“段”的逻辑混进来。
const X = require('../../utils/sessions')
// 补记编排（默认时间/错误文案/保存入参）：与统计页同一真源
const MS = require('../../utils/manual-sleep')
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
// 睡梦中无操作多久回熄灯（睡前不该一直亮屏）
const LIGHTS_OUT_DELAY = 30 * 1000

Page({
  data: {
    ads: adSlots.empty(),
    dateText: '',
    greeting: '',
    state: 'idle',
    stateText: '未记录',
    nowText: '--:--',
    heroTitle: '我准备睡了',
    heroSub: '记录入睡这一刻，醒来后再记起床。',
    orbKicker: '当前时间',
    orbTime: '--:--',
    orbMeta: '等待入睡',
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
    endHint: '',
    endError: '',
    dim: false,
    notice: '',
    weekCount: 0,
    streak: 0,
    canAddSession: false,
    footerText: '愿这一觉安稳'
  },

  onLoad(options) {
    this._alive = true
    this._busy = false
    this._pending = null
    this._autoEnd = !!(options && options.end === '1')
    this._lightsTimer = null
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
    // 统计页点空格子补记：带日期跳过来，直接打开补记面板
    this.openPendingManual()
    // 熄灯/结束/补记/编辑面板期间 tabBar 都必须隐藏：tabBar 是独立 root，
    // 页面 z-index 压不住。之前只判 dim，面板开着回前台会被 audio-dock 的
    // pageLifetimes.show 重新翻出来（与生命周期先后无关）。
    if (this.data.dim || this.data.endShow) tabbar.hide()
    else this.scheduleLightsOut()
  },

  /** 消费统计页传来的补记日期（meta.manualDay），打开补记面板并预填该日期 */
  openPendingManual() {
    const manualDay = storage.getMeta().manualDay
    if (!manualDay) return
    storage.patchMeta({ manualDay: '' })
    if (this.data.endShow) return
    if (this.data.state === 'sleeping') {
      wx.showToast({ title: '正在入睡中，结束后可补记', icon: 'none' })
      return
    }
    this.openManualSheet(manualDay)
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
      if (tries > 0) {
        setTimeout(tryOpen, 120)
        return
      }
      // 抽屉组件始终没挂上：不能静默吞掉这次点击
      wx.showToast({ title: '声音面板打开失败，请再点一次', icon: 'none' })
    }
    setTimeout(tryOpen, 180)
  },

  onHide() {
    this.stopClock()
    // 页面不可见时不计时；tabBar 属于当前页实例，离开前恢复，
    // 避免切到计算器/统计页后底部仍被隐藏（tabbar.show 对新页面无副作用）
    this.clearLightsTimer()
    if (this.data.dim) tabbar.show()
  },

  onUnload() {
    this._alive = false
    this.stopClock()
    this.clearLightsTimer()
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
    const daypart = F.daypartOf(now)
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

    const recordView = record ? this.buildRecordView(record) : null
    this.setData({
      dateText: F.fmtDateCN(now),
      greeting: F.greeting(now),
      endToday,
      endDateText,
      state,
      stateText: state === 'idle' ? '未记录' : sleeping ? '睡梦中' : '已完成',
      nowText,
      // 睡眠事件本身用中性陈述：白天补觉/午休时不会被说成“今晚/明早”。
      // 只有“早安”这类描述此刻的问候按时段（设备本地时区）切换。
      heroTitle: done
        ? daypart === 'morning'
          ? '早安，睡得好吗'
          : '这一觉记下了'
        : sleeping
          ? '这一觉开始了'
          : '我准备睡了',
      heroSub: done
        ? '入睡与起床时间都已保存。'
        : sleeping
          ? '醒来后记得回来记录起床。'
          : '记录入睡这一刻，醒来后再记起床。',
      orbKicker: sleeping ? '入睡时间' : '当前时间',
      orbTime: sleeping && pending ? F.fmtClockTs(pending.bedAt) : nowText,
      orbMeta:
        sleeping && pending
          ? '已睡 ' + F.fmtDuration(Math.round((now - pending.bedAt) / 60000))
          : '等待入睡',
      orbCaption: sleeping
        ? overdue
          ? '已超过预计起床，轻触结束并校准'
          : '轻触圆环，记录起床'
        : '轻触圆环，记录入睡',
      reminderOn: !!(pending && pending.reminderOptIn),
      overdue,
      overdueText,
      record,
      recordView,
      // 记录存在但没有任何可用段：给出可行动出口，而不是空白完成态
      recordHint: done
        ? recordView
          ? ''
          : '这条记录缺少可用的睡眠段，可撤销后重新记录'
        : sleeping
          ? ''
          : '只记录时间，不做睡眠评价',
      buttonTitle: button.title,
      buttonSub: button.sub,
      canAddSession,
      weekCount: weekly.current.count,
      streak: weekly.streak,
      // 页脚只描述“此刻”，不假设用户此刻要睡：深夜刚醒时不再出现“晚安”
      footerText:
        state === 'done'
          ? daypart === 'morning'
            ? '早安，新的一天。'
            : daypart === 'late'
              ? '夜深了，明天见。'
              : '今天也辛苦了。'
          : state === 'sleeping'
            ? '放轻松，慢慢睡。'
            : '愿这一觉安稳'
    })
    // 熄灯态随状态收敛：只有睡梦中允许熄灯；完成/空闲时唤醒并停表，
    // 睡梦中且当前亮屏则重新起 30s 倒计时（markSleep 之后这里不会覆盖熄灯）
    if (state !== 'sleeping') {
      this.wakeUp()
    } else if (!this.data.dim) {
      this.scheduleLightsOut()
    }
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

  /**
   * 完成态视图：当天总睡眠口径。
   * 时间线用「首段入睡 → 末段起床」（多段时即总睡眠时间线，与大数字同口径），
   * 单段时保持「入睡 / 起床」，不引入用户不需要的新概念。
   */
  buildRecordView(record) {
    const sessions = S.sessionsOf(record)
    // 没有任何可用段（bedAt/wakeAt 也非法）时不要把异常记录渲染成“0 分钟完成态”，
    // 交给 refreshAll 的 recordHint 引导用户撤销重记。
    if (!sessions.length) return null
    const multi = sessions.length > 1
    const firstAt = sessions[0].startAt
    const lastAt = sessions[sessions.length - 1].endAt
    const spanMs = Math.max(1, lastAt - firstAt)
    const asleepMs = sessions.reduce((sum, item) => sum + Math.max(0, item.endAt - item.startAt), 0)
    // 分段轴：按「首段入睡 → 末段起床」的比例给每段落位，间断处留空。
    // 一条直线会把“3 段共 26 分钟”读成“连续 30 分钟”，与大数字自相矛盾。
    const timeline = sessions.map((item, index) => {
      const leftPct = Math.min(100, Math.max(0, ((item.startAt - firstAt) / spanMs) * 100))
      const widthPct = Math.min(
        100 - leftPct,
        Math.max(0.8, ((item.endAt - item.startAt) / spanMs) * 100)
      )
      return {
        key: index,
        left: Math.round(leftPct * 10) / 10,
        width: Math.round(widthPct * 10) / 10
      }
    })
    const gapMin = Math.max(0, Math.round((spanMs - asleepMs) / 60000))
    // 只数“真的隔开”的间隔：补记/编辑允许首尾相接（end == 下一段 start），
    // 按段数减一会把相接的两段也算成一次醒来。三种间隔分开计数后，
    // 「中间醒了 N 次」的 N 才是实际醒来的次数。
    let gapCount = 0
    for (let i = 1; i < sessions.length; i += 1) {
      if (sessions[i].startAt > sessions[i - 1].endAt) gapCount += 1
    }
    // 段间说明：短间隔（< 一个睡眠周期）说“中间醒了 N 次”，长间隔（午休/分次睡）说“相隔”，
    // 避免「清醒 6 小时」这种把午休间隔说成睡中醒来、或「清醒 4 分钟」看不出指哪段的表达。
    let segmentsText = ''
    if (multi) {
      if (gapMin <= 0) {
        segmentsText = sessions.length + ' 段'
      } else if (gapMin < 90) {
        segmentsText =
          sessions.length + ' 段 · 中间醒了 ' + gapCount + ' 次（' + F.fmtDuration(gapMin) + '）'
      } else {
        segmentsText = sessions.length + ' 段 · 相隔 ' + F.fmtDuration(gapMin)
      }
    }
    return {
      bed: F.fmtClockTs(Number.isFinite(Number(record.bedAt)) ? record.bedAt : sessions[0].startAt),
      wake: F.fmtClockTs(
        Number.isFinite(Number(record.wakeAt))
          ? record.wakeAt
          : sessions[sessions.length - 1].endAt
      ),
      // 当天总睡眠含午休/间断段；时间轴显示总睡眠的首末时刻
      duration: F.fmtDuration(S.totalDurationOf(record)),
      total: F.fmtDuration(S.totalDurationOf(record)),
      mainId: (sessions[0] || {}).id || '',
      firstBed: F.fmtClockTs(sessions[0].startAt),
      lastWake: F.fmtClockTs(sessions[sessions.length - 1].endAt),
      sessionCount: sessions.length,
      timeline,
      // 段数与段间说明：解释“首末跨度”和“总睡眠”为什么对不上
      segmentsText,
      timelineFirstK: multi ? '当天首段入睡' : '入睡',
      timelineLastK: multi ? '当天末段起床' : '起床',
      sessions: sessions.map((item) => ({
        id: item.id,
        day: record.day,
        bed: F.fmtClockTs(item.startAt),
        wake: F.fmtClockTs(item.endAt),
        duration: F.fmtDuration(item.durationMin)
      }))
    }
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

    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })

    // 打卡后直接熄灯（睡前不该继续看亮屏）；点触任意处唤醒，30s 无操作再熄
    this.enterLightsOut()

    this._busy = false
    return true
  },

  /**
   * 熄灯（睡前模式）：毛玻璃压暗整页，只留熄灭态的入睡时间。
   *
   * 只作用于「睡梦中」且没有弹层的时刻：
   * - 结束面板打开时不遮，否则用户正在核对时间会被盖住；
   * - 声音抽屉打开时不遮，否则操作被打断；
   * - tabBar 是独立 root，页面 z-index 压不住，只能主动隐藏，
   *   否则熄灯后底部仍亮着两个 tab 图标（与抽屉/背景选择器同一套机制）。
   */
  enterLightsOut() {
    if (!this._alive) return
    if (this.data.state !== 'sleeping') return
    if (this.data.endShow) return
    const dock = this.selectComponent && this.selectComponent('#dock')
    if (dock && dock.data && dock.data.open) return
    tabbar.hide()
    this.setData({ dim: true })
    this.clearLightsTimer()
  },

  /**
   * 声音抽屉关闭：抽屉打开期间到点的熄灯会被 enterLightsOut 跳过（回调里定时器已置空），
   * 关闭后必须重新起 30s 倒计时，否则睡前会一直亮屏。
   */
  onDockSheetClose() {
    if (this.data.state === 'sleeping' && !this.data.endShow) this.scheduleLightsOut()
    // 抽屉可以在熄灯态被程序化打开（跨页播放条 → openPendingAudio）；
    // 关闭时 audio-dock 会无条件 tabbar.show()，这里必须把熄灯态的 tabBar 再藏回去。
    if (this.data.dim) tabbar.hide()
  },

  /** 唤醒：恢复正常亮度并隐藏熄灯层；不改变计时状态 */
  wakeUp() {
    this.clearLightsTimer()
    if (this.data.dim) {
      this.setData({ dim: false })
      tabbar.show()
    }
  },

  clearLightsTimer() {
    if (this._lightsTimer) {
      clearTimeout(this._lightsTimer)
      this._lightsTimer = null
    }
  },

  /**
   * 安排「无操作 30s 后熄灯」。delay 供测试注入；
   * 只有睡梦中且无弹层才排定，done/idle 态永远不熄灯。
   */
  scheduleLightsOut(delay) {
    this.clearLightsTimer()
    if (!this._alive) return
    if (this.data.state !== 'sleeping' || this.data.endShow) return
    const wait = typeof delay === 'number' ? delay : LIGHTS_OUT_DELAY
    this._lightsTimer = setTimeout(() => {
      this._lightsTimer = null
      this.enterLightsOut()
    }, wait)
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
    // 面板打开期间不熄灯（否则用户正在核对时间会被遮罩盖住）
    this.clearLightsTimer()
    this.wakeUp()
    const pending = this._pending || storage.getPending()
    if (!pending) {
      this.refreshAll()
      return
    }
    const now = Date.now()
    if (now - pending.bedAt < 60 * 1000) {
      wx.showToast({ title: '刚睡下，再等等', icon: 'none' })
      // 点圆环会先 clearLightsTimer（面板期间不熄灯），这里必须把倒计时还回去，
      // 否则页面会一直亮到用户下一次触碰，违反“唤醒后 30s 无操作回熄灯”。
      this.scheduleLightsOut()
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

  /**
   * 补记一段已经发生的睡眠：不创建 pending、不涉及提醒。
   * presetDay 由统计页的「空格子补记」带入（醒来日），默认当天。
   */
  openManualSheet(presetDay) {
    if (this.data.state === 'sleeping') return
    this.clearLightsTimer()
    this.wakeUp()
    const now = Date.now()
    const today = T.dateKey(now)
    const hasPreset = typeof presetDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(presetDay)
    const day = hasPreset ? presetDay : today
    const dayTs = T.parseDateKey(day)
    // 有预设（统计页带日期）：整夜 23:00 → 07:00；无预设（本页补记）：30 分钟前 → 现在
    const times = MS.defaultTimesFor(day, now, { preset: hasPreset })
    this._editingDay = ''
    this._editingSessionId = ''
    this._endBaseDay = T.startOfDay(dayTs)
    this._endStartDay = 0
    this.hideTabbarForSheet()
    this.setData(
      {
        endShow: true,
        endMode: 'manual',
        endStale: false,
        endDate: day,
        endDateText: this.dateTextOf(day),
        endDateMin: MS.minDayKey(now),
        endStartDateText: '',
        endBedTime: F.fmtClock(times.bedMinutes),
        endWakeTime: F.fmtClock(times.wakeMinutes),
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
    // 编辑既有段时面板没有日期选择器：入睡 >= 起床不能交给 rangeForDay 的“回退一天”，
    // 否则把一段午休（13:00–13:30）的入睡改成 14:00 会静默变成 23.5 小时的跨天段。
    if (this.data.endMode === 'edit' && bedMinutes >= wakeMinutes) {
      this._endBedAt = 0
      this._endWakeAt = 0
      this.setData({
        endDayText: '—',
        endDurationText: '—',
        endHint: '',
        endError: MS.errorTextOf('order')
      })
      return
    }
    // pending 的入睡日是打卡那一刻，精确到天；补记/编辑仍按“醒来日 + 跨午夜回退一天”
    const range =
      this.data.endMode === 'pending' && this._endStartDay
        ? X.rangeBetween(this._endStartDay, bedMinutes, wakeBase, wakeMinutes, now)
        : X.rangeForDay(wakeBase, bedMinutes, wakeMinutes, now)
    // 错误文案与统计页补记共用 manual-sleep 模块，禁止各自写 if 链
    let error = MS.errorTextOf(range.error)
    const records = storage.getRecords()
    // 补记/结束/编辑都要先挡重叠，避免存不进去才报“写入失败”。
    // 必须按时间区间查全表：只看醒来日会漏掉前一天那段（跨天双计）。
    if (!error) {
      const excludeId =
        this.data.endMode === 'edit'
          ? this._editingSessionId
          : this.data.endMode === 'pending' && this._pending
            ? this._pending.id
            : ''
      if (X.findOverlap(records, range.bedAt, range.wakeAt, { id: excludeId })) {
        error = MS.errorTextOf('overlap')
      }
    }
    // 段数/当天总时长上限：saveSession 对超限是静默 false，必须提前给出可行动原因。
    // 结束 pending / 补记都是“新增一段”，只有编辑才排除旧段。
    if (!error) {
      const capacity = MS.capacityErrorOf({
        records,
        // 归档日固定北京时间（与 storage.saveSession 写入的 day 同口径）
        dayKey: T.calendarDayKey(range.wakeAt),
        durationMin: range.durationMin,
        excludeId: this.data.endMode === 'edit' ? this._editingSessionId : ''
      })
      if (capacity) error = MS.errorTextOf(capacity)
    }
    // 有错误时不保留可保存区间：避免某条路径只看 endError 被清掉后误落库
    this._endBedAt = error ? 0 : range.bedAt
    this._endWakeAt = error ? 0 : range.wakeAt
    // 只给中性出口，不判定“异常”：夜班/白天补觉/中途醒来/长睡都可能出现。
    // 仅“结束本次入睡”时提示；补记/编辑历史时不打扰。
    let endHint = ''
    if (!error && this.data.endMode === 'pending' && range.durationMin > 0) {
      if (range.durationMin < 4 * 60) {
        endHint =
          '这次 ' + F.fmtDuration(range.durationMin) + '。如果是中途醒来，保存后可以再记一段，不影响这次记录。'
      } else if (range.durationMin > 12 * 60) {
        endHint =
          '这次 ' + F.fmtDuration(range.durationMin) + '，超过 12 小时。如果忘记结束，建议先核对醒来时间再保存。'
      }
    }
    this.setData({
      endDayText: F.fmtDayCN(T.calendarDayKey(range.wakeAt)),
      endDurationText: range.durationMin > 0 ? F.fmtDuration(range.durationMin) : '—',
      endHint,
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
      endHint: '',
      endStartDateText: ''
    })
    // 取消结束：仍睡梦中就继续按 30s 倒计时熄灯
    this.scheduleLightsOut()
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
      if (!legacy && T.calendarDayKey(this._endWakeAt) !== this._editingDay) {
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
      endHint: '',
      endStartDateText: ''
    })
    // 保存/编辑后仍睡梦中：延迟熄灯继续生效（done/idle 由 refreshAll 收敛）
    this.scheduleLightsOut()
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
      // 服务端拒收只有两类原因：时间区间重叠、或时间戳超出 400 天/未来 1 天窗口
      wx.showToast({ title: '记录已存本机；云端未接受（时间重叠或超出范围）', icon: 'none' })
      return
    }
    // 本机合并写盘失败：用户以为“已同步”，实际云端记录没落到本机
    if (res.writeFailed) {
      wx.showToast({ title: '本机落盘未完成，稍后可重试同步', icon: 'none' })
    }
  },

  /** 手动补记一段：不创建 pending、不发提醒，直接落 v2 session */
  saveManualSession() {
    const now = Date.now()
    const record = storage.saveSession(MS.buildSaveArgs(this._endBedAt, this._endWakeAt, now))
    if (!record) {
      this.setData({ endError: '补记失败：时间可能与已有段重叠，或当天段数/总时长已满' })
      return
    }
    const day = T.calendarDayKey(this._endWakeAt)
    this.finishSave({ toast: '已补记 ' + F.fmtDayCN(day), event: 'manual_sleep' })
  },

  /** 完成态再记一段：不覆盖已有记录，追加午休/间断睡眠 */
  onAddSession() {
    const record = this.data.record
    if (!record || this.data.state === 'sleeping') return
    wx.showModal({
      title: '继续入睡？',
      content: '同一天可以记录多段（午休、夜间醒来后再睡）。新的一段会追加，不会覆盖已有记录。',
      confirmText: '开始计时',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return
        if (this.markSleep()) wx.showToast({ title: '已开始记录新的一段', icon: 'none' })
      }
    })
  },

  /** 删除本日某一段：确认后落库；删到当天无剩余段时整天一起撤销（写墓碑） */
  onDeleteSession(event) {
    const id = event.currentTarget.dataset.id
    const day = event.currentTarget.dataset.day
    const record = this.data.record
    if (!record || !id || day !== record.day) return
    const sessions = S.sessionsOf(record)
    const target = sessions.filter((item) => item.id === id)[0]
    if (!target) return
    const only = sessions.length === 1
    wx.showModal({
      title: only ? '删除当天唯一一段？' : '删除这段睡眠？',
      content: only
        ? '这是当天仅有的睡眠段，删除后当天的记录会一起撤销。'
        : '将移除 ' +
          F.fmtClockTs(target.startAt) +
          ' – ' +
          F.fmtClockTs(target.endAt) +
          '（' +
          F.fmtDuration(target.durationMin) +
          '），当天总睡眠会相应减少。',
      confirmText: '删除',
      confirmColor: '#F87171',
      success: (res) => {
        if (!res.confirm) return
        if (!storage.removeSession(day, id)) {
          wx.showToast({ title: '删除未完成，请重试一次', icon: 'none' })
          return
        }
        this.refreshAll()
        wx.showToast({ title: '已删除这段', icon: 'none' })
        this.syncAfterSave()
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

  /** 熄灯层点击 = 唤醒；仍睡梦中则重新起 30s 倒计时 */
  onDimTap() {
    this.wakeUp()
    this.scheduleLightsOut()
  },

  /**
   * 页面任意触摸：先唤醒（熄灯时），再重置 30s 倒计时。
   * 熄灯层在页面之外（fixed 兄弟节点），它自己的点击走 onDimTap。
   */
  onPageTouch() {
    this.wakeUp()
    this.scheduleLightsOut()
  },

  onNoticeClose() {
    this.setData({ notice: '' })
  },

  goStats() {
    wx.switchTab({ url: '/pages/stats/stats' })
  },

  onShareAppMessage() {
    const view = this.data.recordView
    // 不写“昨晚/早睡”：白天补觉分享时也要成立。
    // 多段记录用首段入睡/末段起床，与页面时间线同口径；主段首尾会漏掉午休。
    return {
      title: view
        ? '我 ' + view.firstBed + ' 入睡、' + view.lastWake + ' 起床，一起好好睡'
        : '我在「睡点」记录睡眠，一起好好睡',
      path: '/pages/sleep/sleep?from=share'
    }
  }
})
