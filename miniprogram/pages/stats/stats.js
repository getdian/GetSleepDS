const F = require('../../utils/format')
const T = require('../../utils/time')
const S = require('../../utils/stats')
// 补记编排（默认时间/错误文案/保存入参）：与入睡页同一真源
const MS = require('../../utils/manual-sleep')
const storage = require('../../utils/storage')
const cache = require('../../utils/audio-cache')
const backgrounds = require('../../utils/backgrounds')
const api = require('../../utils/api')
const { withLogin } = require('../../utils/login')
const { syncNow, whenIdle } = require('../../utils/sync')
const audioTimer = require('../../utils/audio-timer')
const audioSession = require('../../utils/audio-session')
const reminder = require('../../utils/reminder')
const tabbar = require('../../utils/tabbar')
const events = require('../../utils/events')
const FF = require('../../utils/feedback-form')
const adSlots = require('../../utils/ads')
const { getConfig, loadConfig } = require('../../utils/config')

// 日历可翻月份与补记可选日期共用同一回溯范围，避免"能翻到但补不了"
const MONTH_MIN_OFFSET = -MS.MONTH_LOOKBACK

Page({
  data: {
    ads: adSlots.empty(),
    syncEnabled: false,
    hasCloudCopy: false,
    hasData: false,
    // 首屏 3 个核心指标：平均睡眠 / 平均入睡 / 平均起床
    metrics: [],
    // 指标周期（本周 / 最近 7 天 / 全部记录）与区间：必须显示，
    // 否则回退到最近 7 天后用户会把 7 天数据读成"本周"
    periodLabel: '',
    periodRange: '',
    // 回退注脚已含"是否回退"信息（空串=没回退），不再单独存布尔
    periodFallbackNote: '',
    metricKey: '',
    metricDetail: null,
    weekCount: 0,
    // 日历周期：1 = 当月，3/6/12 = 横向滑动的连续月
    calendarSpan: 1,
    calendarCells: [],
    calendarMonths: [],
    calendarTitle: '',
    calendarNote: '',
    canNextMonth: false,
    canPrevMonth: false,
    monthOffset: 0,
    detail: null,
    selectedKey: '',
    // 页内补记面板（与入睡页同一套口径：醒来日 + 入睡/起床时间）
    manualShow: false,
    // add = 补记新的一段；edit = 修改既有段（醒来日锁定，只改时间）
    manualMode: 'add',
    manualEditId: '',
    manualDay: '',
    manualDateText: '',
    manualDateMin: '',
    manualToday: '',
    manualBedTime: '23:00',
    manualWakeTime: '07:00',
    manualDayText: '',
    manualDurationText: '',
    manualError: '',
    settingsOpen: false,
    syncText: '尚未同步',
    // 云端删除水位：与「是否有云端副本」分开。删除失败时 lastSyncAt 可能仍是 0，
    // 但闸门已经落下，必须仍给用户「删除云端副本」的出口，否则开关永远打不开。
    cloudPendingErase: false,
    syncBusy: false,
    posterPath: '',
    posterSharePath: '',
    // 反馈与建议：入口默认隐藏，配置到达后按 features.feedback 决定是否展示
    feedbackEnabled: false,
    feedbackShow: false,
    feedbackTypes: FF.TYPES,
    feedbackType: FF.DEFAULT_TYPE,
    feedbackContent: '',
    feedbackContact: '',
    feedbackError: '',
    feedbackSending: false,
    feedbackSent: false,
    feedbackCounter: FF.counterText('')
  },

  onLoad() {
    this._alive = true
    this._records = {}
    this._signature = ''
    // 首帧就用缓存/兜底配置决定入口，避免"先闪出反馈入口又被配置收回"
    const cachedConfig = getConfig() || {}
    const cachedFeatures = cachedConfig.features || {}
    this.setData({ feedbackEnabled: cachedFeatures.feedback !== false })
    // 先在 onLoad 渲染一次，避免首帧先画“还没有记录”再被 onShow 覆盖
    this.refresh()
    adSlots.apply(this)
  },

  onShow() {
    this._alive = true
    // 全局 tab 意图只由 tabbar.switchTo 写（onShow 回写会在连点时覆盖最后一次点击）
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) tabBar.setData({ selected: 2 })
    this.refresh()
    this.retryPendingReminderCancel()
    adSlots.apply(this)
    loadConfig(true)
      .then((cfg) => {
        if (!this._alive) return
        // 配置拉回来时只在“会影响本页的配置”变化时重算：此前无条件 refresh，
        // 进页一次会算两遍（1 年视图 ~420 格）。
        const features = (cfg && cfg.features) || {}
        const sig =
          (cfg && cfg.version) +
          '|' +
          (features.sync === false ? 'off' : 'on') +
          '|' +
          (features.feedback === false ? 'off' : 'on')
        if (sig === this._cfgSig) return
        this._cfgSig = sig
        const feedbackEnabled = features.feedback !== false
        if (feedbackEnabled !== this.data.feedbackEnabled) {
          if (feedbackEnabled) {
            this.setData({ feedbackEnabled })
          } else {
            // 运营关掉总闸时，已打开的反馈面板必须一起收起，
            // 否则用户写完点提交才被服务端 403
            this.setData({ feedbackEnabled, feedbackShow: false }, () => tabbar.show())
          }
        }
        this.refresh()
      })
      .catch(() => {})
  },

  /**
   * 清除数据时提醒取消失败的补偿队列。
   * 云端 erase 也会删提醒，所以主路径不会残留；这里兜住“erase 失败 + 从未同步”
   * 以及断网时取消不成功的情况，下次进统计页自动重试，避免清除后仍收到推送。
   */
  /**
   * 删除云端副本会删掉服务端提醒。本地若继续保留“已开启”标记，
   * 首页 remindAt 与入睡页 reminderCovered 都会阻止用户重新设置。
   */
  clearLocalCloudReminderState() {
    storage.patchMeta({ planReminder: null })
    const pending = storage.getPending()
    if (pending && pending.reminderOptIn) {
      storage.setPending(Object.assign({}, pending, { reminderOptIn: false }))
    }
  },

  retryPendingReminderCancel() {
    const meta = storage.getMeta()
    const list = Array.isArray(meta.pendingReminderCancel) ? meta.pendingReminderCancel : []
    if (!list.length) return
    Promise.all(
      list.map((id) =>
        reminder
          .cancel(id)
          .then(() => '')
          .catch(() => id)
      )
    )
      .then((results) => {
        const failed = results.filter((id) => !!id)
        storage.patchMeta({ pendingReminderCancel: failed })
      })
      .catch(() => {})
  },

  /** 补记/反馈面板打开时切走页面：收起面板并恢复 tabBar，避免回来时导航是隐藏的 */
  onHide() {
    if (this.data.manualShow) {
      this.setData({ manualShow: false, manualError: '' })
      tabbar.show()
    }
    if (this.data.feedbackShow) {
      this.setData({ feedbackShow: false })
      tabbar.show()
    }
  },

  onUnload() {
    this._alive = false
  },

  onPullDownRefresh() {
    this.refresh()
    // 运营改完广告位后，下拉刷新可立即拿到新配置（绕过 10 分钟 TTL）。
    adSlots.reload(this).finally(() => wx.stopPullDownRefresh())
  },

  refresh() {
    if (!this._alive) return
    const now = Date.now()
    const records = storage.getRecords()
    const list = S.completedList(records)
    const metricData = S.metricsOf(records, now)
    // 回退注脚必须说清是哪一级回退：全部记录周期时只写「本周还没有记录」，
    // 用户看到的是一个月前的数据，会以为注脚在说别的事
    const periodFallbackNote = !metricData.isFallback
      ? ''
      : metricData.periodKey === 'all'
        ? '本周与最近 7 天都没有记录'
        : '本周还没有记录'
    const pending = storage.getPending()
    const partialDay = pending ? T.dateKey(now) : ''
    const monthOffset = Number(this.data.monthOffset) || 0
    const calendarSpan = Number(this.data.calendarSpan) || 1
    const minEditableDay = MS.minDayKey(now)
    // 1 年视图一次要算 12 个月 × ~35 格；同一份数据下（onShow + loadConfig 回调、
    // 指标展开/收起都会 refresh）没必要重复算。数据指纹 + 视图参数相同就复用。
    const cacheKey = [
      calendarSpan,
      monthOffset,
      T.dateKey(now),
      partialDay,
      this.recordsStamp(records)
    ].join('|')
    let calendar = null
    let calendarMonths = []
    if (this._calCache && this._calCache.key === cacheKey) {
      calendar = this._calCache.calendar
      calendarMonths = this._calCache.months
    } else {
      calendar =
        calendarSpan === 1 ? S.calendarCells(records, now, monthOffset, partialDay) : null
      calendarMonths =
        calendarSpan > 1 ? S.calendarMonths(records, now, calendarSpan, partialDay) : []
      // 日历可翻 24 个月，但可补记只到云同步窗口（400 天）：
      // 窗口外的补记会"只存本机、永远不上云"，所以空格子不提供补记入口
      if (calendar) MS.limitCanAdd(calendar.cells, minEditableDay)
      calendarMonths.forEach((month) => MS.limitCanAdd(month.cells, minEditableDay))
      this._calCache = { key: cacheKey, calendar, months: calendarMonths }
    }
    let calendarNote = ''
    if (calendarSpan === 1) {
      // 底注说明的是"这个月"，不写月份主语会被读成整段历史的记录数
      calendarNote = calendar.marked ? '本月已记录 ' + calendar.marked + ' 天' : '本月还没有完整记录'
    } else {
      const marked = calendarMonths.reduce((sum, month) => sum + month.marked, 0)
      calendarNote = marked
        ? '近 ' + calendarSpan + ' 个月已记录 ' + marked + ' 天'
        : '这段时间还没有完整记录'
    }
    const meta = storage.getMeta()
    const config = getConfig()
    const syncFeature = !config.features || config.features.sync !== false
    let syncEnabled = storage.getSyncEnabled()
    if (syncEnabled && !syncFeature) {
      storage.setSyncEnabled(false)
      syncEnabled = false
    }
    const cloudPending = !!meta.cloudPendingErase
    const hasData = list.length > 0 || !!pending
    const todayKey = T.dateKey(now)

    const metrics = metricData.metrics.map((item) =>
      Object.assign({}, item, { detail: item.detail.slice() })
    )

    const syncText = cloudPending
      ? '云端副本尚未删除，请先删除'
      : syncEnabled
        ? meta.lastSyncPartial
          ? '上次同步有 ' + (Number(meta.lastSyncDropped) || 0) + ' 条未写入云端（时间重叠或超出范围）'
          : meta.lastSyncAt
            ? '上次同步 ' + F.fmtClockTs(meta.lastSyncAt)
            : '已开启，尚未同步'
        : syncFeature
          ? '仅存本机 · 未开启云备份'
          : '仅存本机 · 服务端暂未开放云备份'

    this._records = records

    // onShow 会连续 refresh 两次（本地一次、配置到位后一次）。
    // 数据没变时跳过 setData，避免把日历整块重新过桥。
    const signature = [
      hasData ? 1 : 0,
      // 卡面只有 value + label；对比与口径都在 detail 里，签名必须带上它
      metrics.map((item) => item.value + '/' + item.detail.join('|')).join('|'),
      metricData.count,
      // 周期换词也必须进签名：本周 0 天 → 最近 7 天命中时，
      // 数字可能恰好相同（如都是 1 天），只拼 metrics 会漏刷周期标签
      metricData.periodKey,
      metricData.rangeText,
      periodFallbackNote,
      // 月份偏移必须进签名：空月之间格子数与色阶序列完全相同，
      // 缺了它切月会被去重跳过（标题/格子/canNextMonth 都不更新，且 monthOffset 已变 → 双向卡死）。
      monthOffset,
      calendarSpan,
      // 必须带上单格时长：同档内的补记/编辑（6h10 → 6h50）level 不变，
      // 只拼 level 会让日历格数字一直停在旧值，且要等其它签名项变化才自愈。
      calendar
        ? calendar.monthKey +
          ':' +
          calendar.cells.map((cell) => (cell.day || cell.key) + ':' + (cell.durationMin || 0)).join(',')
        : '',
      calendarMonths
        .map((month) => month.key + ':' + month.cells.map((cell) => cell.level).join(''))
        .join('|'),
      // 跨天、进行中的会话、云端副本状态都会改变界面，必须进签名，否则不会刷新
      todayKey,
      partialDay,
      syncEnabled ? 1 : 0,
      meta.lastSyncAt ? 1 : 0,
      cloudPending ? 1 : 0,
      syncText
    ].join('#')

    if (signature !== this._signature) {
      this._signature = signature
      this.setData({
        hasData,
        metrics,
        // 周期与区间：本周没记录时这里会变成「最近 7 天 10.20–10.26」
        periodLabel: metricData.periodLabel || '',
        periodRange: metricData.rangeText || '',
        periodFallbackNote,
        weekCount: metricData.count,
        calendarSpan,
        calendarCells: calendar ? calendar.cells : [],
        calendarMonths,
        calendarTitle: calendar ? calendar.monthLabel : '',
        calendarNote,
        canNextMonth: monthOffset < 0,
        canPrevMonth: monthOffset > MONTH_MIN_OFFSET,
        // 数据或周期变了才清空详情与选中态，避免指向已修改/已切换的记录
        detail: null,
        selectedKey: '',
        metricKey: '',
        metricDetail: null,
        syncEnabled,
        hasCloudCopy: !!meta.lastSyncAt,
        cloudPendingErase: cloudPending,
        syncText
      })
    }
  },

  /** 记录指纹：天数 + 各段起止/更新时间和，任一编辑都会改变它 → 日历缓存失效 */
  recordsStamp(records) {
    const days = Object.keys(records || {})
    let sum = 0
    for (let i = 0; i < days.length; i += 1) {
      const item = records[days[i]] || {}
      const sessions = Array.isArray(item.sessions) ? item.sessions : []
      sum +=
        (Number(item.updatedAt) || 0) +
        (Number(item.bedAt) || 0) +
        (Number(item.wakeAt) || 0) +
        sessions.length
    }
    return days.length + ':' + sum
  },

  onMetricTap(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    // 再点同一项收起，避免说明卡一直占着首屏
    if (this.data.metricKey === key) {
      this.setData({ metricKey: '', metricDetail: null })
      return
    }
    const detail = this.data.metrics.filter((item) => item.key === key)[0] || null
    this.setData({ metricKey: key, metricDetail: detail })
  },

  onSpanTap(e) {
    const span = Number(e.currentTarget.dataset.span) || 1
    if (span === this.data.calendarSpan) return
    this.setData({ calendarSpan: span, monthOffset: 0, selectedKey: '', detail: null }, () =>
      this.refresh()
    )
  },

  onCalendarTap(e) {
    const cell = e.detail && e.detail.cell
    if (!cell || !cell.day) return
    this.openDay(cell.day)
  },

  onStripTap(e) {
    const day = e.detail && e.detail.day
    if (!day) return
    this.openDay(day)
  },

  /**
   * 点格子的统一分流：补记窗口内（400 天）的无记录过去日直接弹页内补记面板；
   * 窗口外的空日 / 有记录 / 进行中 / 未来日走详情卡（选中态由页面统一持有）。
   */
  openDay(day) {
    const now = Date.now()
    const todayKey = T.dateKey(now)
    const record = (this._records || {})[day]
    const pending = storage.getPending()
    const pendingDay = pending ? todayKey : ''
    const editable = day >= MS.minDayKey(now)
    if (!record && editable && day <= todayKey && !(pendingDay && day === pendingDay)) {
      // 弹面板时清掉选中态与详情，避免“描边还在、详情不对应”
      this.setData({ selectedKey: '', detail: null })
      this.openManualSheet(day)
      return
    }
    this.setData({ selectedKey: day })
    this.showDetail(day)
  },

  /** 打开补记面板：默认时间与错误文案都走 manual-sleep 共享模块 */
  /**
   * 打开补记面板：默认时间与错误文案都走 manual-sleep 共享模块。
   * options.napDefault：已记录日「再加一段」优先给一个不与已有段重叠的小睡默认值。
   * options.edit = { id }：修改既有的一段——预填该段起止、醒来日锁定，保存走 updateSession。
   */
  openManualSheet(day, options) {
    const opt = options || {}
    const now = Date.now()
    const today = T.dateKey(now)
    const target = typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : today
    const records = storage.getRecords()
    const edit = opt.edit && opt.edit.id ? opt.edit : null
    let mode = 'add'
    let editId = ''
    let baseDay = T.parseDateKey(target)
    let bedMinutes = 0
    let wakeMinutes = 0
    let dateText = F.fmtDateCN(baseDay)
    if (edit) {
      const session = S.sessionsOf(records[target]).filter((item) => item.id === edit.id)[0]
      // 段已不存在（并发删除/切页）时不弹空面板
      if (!session) return
      mode = 'edit'
      editId = session.id
      // 与入睡页编辑面板同口径：以该段的醒来时刻所在本地日为时间基准，
      // 醒来日显示仍用归档日（北京时区），两者在跨时区时不一定是同一天。
      baseDay = T.startOfDay(session.endAt)
      bedMinutes = T.minutesOf(session.startAt)
      wakeMinutes = T.minutesOf(session.endAt)
      dateText = F.fmtDateCN(T.parseDateKey(T.calendarDayKey(session.endAt)))
    } else {
      const times = opt.napDefault
        ? MS.napTimesFor(records, target, now, storage.getPending())
        : MS.defaultTimesFor(target, now)
      bedMinutes = times.bedMinutes
      wakeMinutes = times.wakeMinutes
    }
    this._manualBaseDay = baseDay
    this._manualBedAt = 0
    this._manualWakeAt = 0
    tabbar.hide()
    this.setData(
      {
        manualShow: true,
        manualMode: mode,
        manualEditId: editId,
        manualDay: target,
        manualDateText: dateText,
        manualDateMin: MS.minDayKey(now),
        manualToday: today,
        manualBedTime: F.fmtClock(bedMinutes),
        manualWakeTime: F.fmtClock(wakeMinutes),
        manualError: ''
      },
      () => this.computeManualSheet()
    )
  },

  /** 与入睡页同口径：先挡时间错误，再挡跨天重叠（校验在共享模块里） */
  computeManualSheet() {
    const now = Date.now()
    const result = MS.evaluateManualRange({
      records: storage.getRecords(),
      // 进行中的一段不在 records 里，必须单独传：否则补记与它相交也能保存，
      // 之后结束计时会被这段新补记挡住（互为死结）。
      pending: storage.getPending(),
      dayTs: this._manualBaseDay || T.startOfDay(now),
      bedMinutes: T.parseClock(this.data.manualBedTime),
      wakeMinutes: T.parseClock(this.data.manualWakeTime),
      // 编辑既有段：重叠与容量都要先排除它自己（只挪一分钟也会命中自己）
      excludeId: this.data.manualMode === 'edit' ? this.data.manualEditId : '',
      now
    })
    // 有错误时不保留可保存区间（与入睡页 computeEndSheet 同一防御）：
    // 避免某条路径只看 manualError 被清掉后误落库
    this._manualBedAt = result.error ? 0 : result.bedAt
    this._manualWakeAt = result.error ? 0 : result.wakeAt
    this.setData({
      // 「归入」必须与记录实际落日同口径（北京时间归档），设备时区不同也不能漂
      manualDayText: F.fmtDayCN(T.calendarDayKey(result.wakeAt)),
      manualDurationText: result.durationMin > 0 ? F.fmtDuration(result.durationMin) : '—',
      manualError: result.error
    })
  },

  onManualDateChange(event) {
    const date = event.detail.value
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return
    this._manualBaseDay = T.parseDateKey(date)
    this.setData(
      { manualDay: date, manualDateText: F.fmtDateCN(this._manualBaseDay) },
      () => this.computeManualSheet()
    )
  },

  onManualTimeChange(event) {
    const field = event.currentTarget.dataset.field
    const value = event.detail.value
    if (field !== 'manualBedTime' && field !== 'manualWakeTime') return
    this.setData({ [field]: value }, () => this.computeManualSheet())
  },

  onManualCancel() {
    tabbar.show()
    this.setData({ manualShow: false, manualError: '', manualMode: 'add', manualEditId: '' })
  },

  onManualConfirm() {
    if (!this._manualBedAt || !this._manualWakeAt) return
    if (this.data.manualError) {
      // 按钮已是“假禁用”视觉：点击要给反馈，而不是静默 return
      wx.showToast({ title: this.data.manualError, icon: 'none' })
      return
    }
    if (this.data.manualMode === 'edit') this.saveEditSession()
    else this.saveManualSession()
  },

  /**
   * 修改既有的一段：只改时间，醒来日不通过面板改。
   * 多段日若改到别天会把记录拆到两个归档日（storage.updateSession 会拒），
   * 这里先给可读文案，不让用户对着“修改未写入”猜原因。
   */
  saveEditSession() {
    // 面板值与保存值必须同源：时间 picker 的 setData 回调是异步的，
    // “选完立刻点保存”时缓存区间可能还是上一次的，这里按面板当前值同步重算一次。
    this.computeManualSheet()
    if (this.data.manualError) {
      wx.showToast({ title: this.data.manualError, icon: 'none' })
      return
    }
    const day = this.data.manualDay
    const id = this.data.manualEditId
    const wakeDay = T.calendarDayKey(this._manualWakeAt)
    const list = S.sessionsOf(storage.getRecords()[day])
    if (wakeDay !== day && list.length > 1) {
      this.setData({ manualError: '这天有多段：改醒来日会把记录拆到另一天，请先删除其它段' })
      return
    }
    const updated = storage.updateSession(day, id, this._manualBedAt, this._manualWakeAt)
    if (!updated) {
      this.setData({ manualError: '修改未写入：可能与其它段重叠，或当天总时长超过 24 小时' })
      return
    }
    tabbar.show()
    this.setData({ manualShow: false, manualError: '', manualMode: 'add', manualEditId: '' })
    this._signature = ''
    this.refresh()
    // 单段日改到别天时整条记录会跟着迁走：选中态与详情卡落到实际的归档日
    this.setData({ selectedKey: wakeDay })
    this.showDetail(wakeDay)
    wx.showToast({
      title: wakeDay === day ? '已修改这一段' : '已移到 ' + F.fmtDayCN(wakeDay),
      icon: 'none'
    })
    syncNow(true)
      .then((res) => {
        if (!res || res.skipped === 'stale') return
        if (res.synced === 0 && res.dropped > 0) {
          wx.showToast({ title: '已存本机；云端未接受（时间重叠或超出范围）', icon: 'none' })
        }
      })
      .catch(() => {
        wx.showToast({ title: '已存本机，云端稍后重试', icon: 'none' })
      })
  },

  /** 详情卡的「改」：打开同一块面板的编辑态（预填该段起止） */
  onDetailEditSession(event) {
    const id = event.currentTarget.dataset.id
    const detail = this.data.detail
    if (!id || !detail || !detail.day || !detail.canEdit) return
    this.openManualSheet(detail.day, { edit: { id } })
  },

  /**
   * 详情卡的「删」：删到最后一段时整条记录一起撤销（storage.removeSession 内含墓碑，
   * 防云端旧记录在下次同步回填），与入睡页的删除语义完全一致。
   */
  onDetailDeleteSession(event) {
    const id = event.currentTarget.dataset.id
    const detail = this.data.detail
    if (!id || !detail || !detail.day || !detail.canEdit) return
    const day = detail.day
    const list = S.sessionsOf((this._records || {})[day])
    const target = list.filter((item) => item.id === id)[0]
    if (!target) return
    const only = list.length === 1
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
        this._signature = ''
        this.refresh()
        if (only) {
          // 当天整条撤销：格子会回到空格，详情卡没有可指向的对象
          this.setData({ selectedKey: '', detail: null })
        } else {
          this.setData({ selectedKey: day })
          this.showDetail(day)
        }
        wx.showToast({ title: only ? '已撤销这一天的记录' : '已删除这段', icon: 'none' })
        syncNow(true).catch(() => {
          wx.showToast({ title: '已存本机，云端稍后重试', icon: 'none' })
        })
      }
    })
  },

  /** 手动补记一段：不创建 pending、不发提醒，直接落 v2 session */
  saveManualSession() {
    // 同 saveEditSession：先把面板当前值同步落成可保存区间，避免用上一次缓存
    this.computeManualSheet()
    if (this.data.manualError) {
      wx.showToast({ title: this.data.manualError, icon: 'none' })
      return
    }
    const now = Date.now()
    const record = storage.saveSession(MS.buildSaveArgs(this._manualBedAt, this._manualWakeAt, now))
    if (!record) {
      this.setData({ manualError: '补记失败：时间可能与已有段重叠，或当天段数/总时长已满' })
      return
    }
    const day = T.calendarDayKey(this._manualWakeAt)
    tabbar.show()
    this.setData({ manualShow: false, manualError: '' })
    this._signature = ''
    this.refresh()
    // 与入睡页同口径：补记是独立事件，用于看板补记使用率
    events.track('manual_sleep', '')
    wx.showToast({ title: '已补记 ' + F.fmtDayCN(day), icon: 'none' })
    // 与入睡页同一套云端反馈：跳过/云端拒收/网络失败分别提示
    syncNow(true)
      .then((res) => {
        if (!res || res.skipped === 'stale') return
        if (res.synced === 0 && res.dropped > 0) {
          wx.showToast({ title: '记录已存本机；云端未接受（时间重叠或超出范围）', icon: 'none' })
        }
      })
      .catch(() => {
        wx.showToast({ title: '已存本机，云端稍后重试', icon: 'none' })
      })
  },

  noop() {},

  /* ---------- 反馈与建议 ---------- */

  onOpenFeedback() {
    // 刻意不在这里重置 feedbackSending：仍在途的提交（切后台/收起面板后再打开）
    // 必须继续占着这个闸，否则会放开一次重复提交，同一段内容落库两条。
    this.setData({
      feedbackShow: true,
      feedbackError: '',
      feedbackSent: false
    })
    // 与补记面板同口径：弹层覆盖页面时先让出浮动 tabBar，关闭时再恢复
    tabbar.hide()
  },

  onCloseFeedback() {
    // 提交中不允许关闭，但必须给回执：静默 return 会让用户以为点了没反应
    if (this.data.feedbackSending) {
      wx.showToast({ title: '正在提交，请稍候', icon: 'none' })
      return
    }
    this.setData({ feedbackShow: false, feedbackError: '' })
    tabbar.show()
  },

  onPickFeedbackType(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key
    if (!FF.isType(key)) return
    this.setData({ feedbackType: key })
  },

  onFeedbackContent(e) {
    const value = (e && e.detail && e.detail.value) || ''
    this.setData({
      feedbackContent: value,
      feedbackCounter: FF.counterText(value),
      // 用户开始改写就清掉上一次的报错，避免"已经改了但红字还在"
      feedbackError: ''
    })
  },

  onFeedbackContact(e) {
    const value = (e && e.detail && e.detail.value) || ''
    this.setData({ feedbackContact: value })
  },

  onSubmitFeedback() {
    if (this.data.feedbackSending) return
    const result = FF.buildPayload({
      type: this.data.feedbackType,
      content: this.data.feedbackContent,
      contact: this.data.feedbackContact
    })
    if (!result.ok) {
      this.setData({ feedbackError: result.error })
      return
    }
    this.setData({ feedbackSending: true, feedbackError: '' })
    withLogin((code) => api.submitFeedback(code, result.payload))
      .then(() => {
        if (!this._alive) return
        // 成功态清空输入：同一段内容不该被用户重复提交两次
        this.setData({
          feedbackSending: false,
          feedbackSent: true,
          feedbackContent: '',
          feedbackContact: '',
          feedbackType: FF.DEFAULT_TYPE,
          feedbackCounter: FF.counterText('')
        })
      })
      .catch((err) => {
        if (!this._alive) return
        this.setData({
          feedbackSending: false,
          feedbackError: (err && err.message) || '提交失败，请稍后重试'
        })
      })
  },

  /** 详情卡渲染后滚到可视区：浮动 tabBar 会盖住页面底部，不滚用户只看到半张卡 */
  scrollToDetail() {
    if (!this._alive) return
    if (!wx || typeof wx.pageScrollTo !== 'function') return
    wx.pageScrollTo({ selector: '#day-detail', duration: 220 })
  },

  showDetail(day) {
    const records = this._records || {}
    const record = records[day]
    const now = Date.now()
    const title = F.fmtDateCN(T.parseDateKey(day))
    const todayKey = T.dateKey(now)

    if (day > todayKey) {
      this.setData(
        { detail: { day, title, tag: '还没到', main: '这一天还没到', sub: '' } },
        () => this.scrollToDetail()
      )
      return
    }

    if (!record || !record.bedAt || !record.wakeAt) {
      const pending = storage.getPending()
      const pendingDay = pending ? T.dateKey(now) : ''
      if (pending && day === pendingDay) {
        this.setData(
          {
            detail: {
              day,
              title,
              tag: '仅入睡',
              main: '已记录入睡，还没有结束时间',
              sub: '结束后才会进入时长统计'
            }
          },
          () => this.scrollToDetail()
        )
        return
      }
      this.setData(
        {
          detail: {
            day,
            title,
            tag: '未记录',
            main: '这天还没有记录',
            sub:
              day < MS.minDayKey(now)
                ? '超出可补记范围：云备份只保留最近 400 天'
                : '点击格子可直接补记'
          }
        },
        () => this.scrollToDetail()
      )
      return
    }

    const sessions = S.sessionsOf(record)
    const primaryMin = S.durationOf(record)
    const totalMin = S.totalDurationOf(record)
    const first = sessions[0]
    const last = sessions[sessions.length - 1]
    const pending = storage.getPending()
    const inProgress = pending && day === T.dateKey(now) ? ' · 另有进行中的一段' : ''
    // 主行必须与总时长同口径：区间取「首段上床 → 末段起床」，时长取当天在床时长。
    // 之前用主段（最长一段）的 bedAt/wakeAt 拼 totalDurationMin，会出现
    // 「23:00 → 06:00 · 7 小时 40 分」这种区间与时长自相矛盾的表达。
    // startAt 是上床（真实睡着时刻另存 sleepAt），所以精确时刻一律说「上床」。
    const rangeText =
      first && last
        ? F.fmtClockTs(first.startAt) + ' 上床 → ' + F.fmtClockTs(last.endAt) + ' 起床'
        : F.fmtClockTs(record.bedAt) + ' 上床 → ' + F.fmtClockTs(record.wakeAt) + ' 起床'
    // 主行必须与总时长同口径：多段日用「首段 / 末段」而不是箭头区间，
    // 否则「23:00 → 13:30 · 共 7 小时 30 分」会被读成 14.5 小时的连续睡眠。
    const main =
      sessions.length > 1
        ? '首段 ' +
          F.fmtClockTs(first.startAt) +
          ' 上床 · 末段 ' +
          F.fmtClockTs(last.endAt) +
          ' 起床 · 共 ' +
          F.fmtDuration(totalMin)
        : rangeText + ' · 共 ' + F.fmtDuration(totalMin)
    // 副行解释「首末跨度」与「总睡眠」为什么可能对不上；不把主段硬叫「夜间」
    // ——只睡一段午觉时，主段并不是夜间。
    const parts = []
    if (sessions.length > 1) {
      parts.push(sessions.length + ' 段')
      parts.push('最长一段 ' + F.fmtDuration(primaryMin))
      const other = Math.max(0, totalMin - primaryMin)
      if (other > 0) parts.push('其余 ' + F.fmtDuration(other))
    } else {
      parts.push('1 段')
    }
    parts.push('按醒来日归档')
    // 逐段可操作行：统计页是历史记录唯一的修正入口（入睡页只处理当天），
    // 所以每段都要能改时间、删除，否则补记错了只能越补越乱。
    const sessionRows = sessions.map((item) => {
      const startDay = T.calendarDayKey(item.startAt)
      const endDay = T.calendarDayKey(item.endAt)
      return {
        id: item.id,
        timeText:
          F.fmtClockTs(item.startAt) +
          '–' +
          // 跨自然日的段必须标「次日」，否则 22:58–18:23 会被读成倒序
          (endDay !== startDay ? '次日 ' : '') +
          F.fmtClockTs(item.endAt),
        durationText: F.fmtDuration(item.durationMin)
      }
    })
    // 编辑/补记同窗口（400 天，与云同步范围一致）：窗口外改了也只存本机
    const keepEditable = day >= MS.minDayKey(now)
    this.setData(
      {
        detail: {
          day,
          title,
          tag: '已记录',
          main,
          sub: parts.join(' · ') + inProgress,
          sessions: sessionRows,
          // 已记录日也能再加一段（午休/醒来后再睡）：补记面板会按区间挡重叠。
          canAdd: keepEditable,
          canEdit: keepEditable
        }
      },
      () => this.scrollToDetail()
    )
  },

  onDetailAdd() {
    const detail = this.data.detail
    if (!detail || !detail.day || !detail.canAdd) return
    // 已记录日加一段：默认给下午小睡，避免 23:00→07:00 与已有夜间段重叠
    this.openManualSheet(detail.day, { napDefault: true })
  },

  onMonthPrev() {
    const next = (Number(this.data.monthOffset) || 0) - 1
    if (next < MONTH_MIN_OFFSET) return
    this.setData({ monthOffset: next }, () => this.refresh())
  },

  onMonthNext() {
    const next = (Number(this.data.monthOffset) || 0) + 1
    if (next > 0) return
    this.setData({ monthOffset: next }, () => this.refresh())
  },

  onToggleSettings() {
    this.setData({ settingsOpen: !this.data.settingsOpen })
  },

  // 自绘开关：状态由 data.syncEnabled 驱动；写失败时保持原状态，避免 UI 与存储分叉
  onSyncToggle() {
    this.applySyncEnabled(!this.data.syncEnabled)
  },

  applySyncEnabled(enabled) {
    if (!enabled) {
      // 写入失败时保持开关为开启态，避免 UI 与存储不一致、下次 refresh 又弹回
      if (!storage.setSyncEnabled(false)) {
        wx.showToast({ title: '云备份开关保存失败，请重试', icon: 'none' })
        return
      }
      this.setData({ syncEnabled: false, syncText: '仅存本机 · 未开启云备份' })
      if (this.data.hasCloudCopy) {
        wx.showModal({
          title: '已关闭云备份',
          content: '云端历史副本仍会保留。是否同时删除云端副本？本机记录与偏好不受影响。',
          confirmText: '删除云端',
          cancelText: '保留云端',
          success: (res) => {
            if (res.confirm) this.eraseCloudOnly()
          }
        })
      } else {
        wx.showToast({ title: '已关闭云备份，本地记录不受影响', icon: 'none' })
      }
      return
    }

    const config = getConfig()
    if (config.features && config.features.sync === false) {
      wx.showToast({ title: '服务端暂未开放云备份', icon: 'none' })
      return
    }
    if (storage.getMeta().cloudPendingErase) {
      wx.showModal({
        title: '先删除云端副本',
        content: '上次清除数据时云端副本尚未删除。请先在下方“删除云端副本（保留本机）”，否则开启会恢复旧记录。',
        showCancel: false,
        confirmText: '知道了'
      })
      return
    }

    wx.showModal({
      title: '开启云备份？',
      content: '仅上传睡眠时间，不含手机号、位置等信息；以微信匿名标识归属，不获取头像和昵称。此前已备份的云端记录，开启后可恢复。可随时关闭。',
      confirmText: '开启',
      cancelText: '保持本地',
      success: (res) => {
        if (!res.confirm) return
        if (!storage.setSyncEnabled(true)) {
          wx.showToast({ title: '云备份开关保存失败', icon: 'none' })
          return
        }
        this.setData({ syncEnabled: true, syncText: '已开启，正在首次同步…' })
        this.runSync()
      }
    })
  },

  onSyncTap() {
    if (!storage.getSyncEnabled()) return
    this.runSync()
  },

  runSync() {
    if (this.data.syncBusy) return
    this.setData({ syncBusy: true })
    syncNow(true)
      .then((res) => {
        if (!this._alive) return
        this.setData({ syncBusy: false })
        if (res && res.skipped === 'feature_off') {
          // 服务端总闸关闭时回滚开关，避免界面显示开启但永远同步不了
          storage.setSyncEnabled(false)
          this.setData({ syncEnabled: false, syncText: '仅存本机 · 服务端暂未开放云备份' })
          wx.showToast({ title: '服务端暂未开放云备份', icon: 'none' })
          return
        }
        if (res && res.skipped === 'cloud_pending') {
          this.setData({ syncText: '云端副本尚未删除，请先删除' })
          wx.showToast({ title: '请先删除云端副本', icon: 'none' })
          return
        }
        if (res && res.skipped === 'sync_off') {
          wx.showToast({ title: '云备份未开启', icon: 'none' })
          return
        }
        if (res && res.skipped === 'stale') {
          // 清除数据期间发出的旧请求已被丢弃，不能再提示“已同步”
          wx.showToast({ title: '上一次同步已取消', icon: 'none' })
          return
        }
        if (res && res.dropped > 0) {
          // 全部被拒通常是设备时钟越界（换机后数据会全无），必须给出可行动提示；
          // 部分未写入可能是服务端已有更新版本（LWW），只做中性告知。
          this.refresh()
          wx.showToast({
            title:
              res.synced > 0
                ? '已同步（部分记录云端未写入）'
                : '云端未接受记录，请检查手机时间',
            icon: 'none'
          })
          return
        }
        this.refresh()
        wx.showToast({ title: '已同步', icon: 'none' })
      })
      .catch((error) => {
        if (!this._alive) return
        this.setData({ syncBusy: false })
        if (error && error.code === 'FEATURE_OFF') {
          storage.setSyncEnabled(false)
          this.setData({ syncEnabled: false, syncText: '仅存本机 · 服务端暂未开放云备份' })
          wx.showToast({ title: '服务端暂未开放云备份', icon: 'none' })
          return
        }
        this.setData({ syncText: '同步失败 · 请稍后重试' })
        wx.showToast({ title: '同步失败，请稍后重试', icon: 'none' })
      })
  },

  onClearData() {
    const synced = storage.getSyncEnabled()
    wx.showModal({
      title: synced ? '清除全部睡眠数据' : '清除本机睡眠数据',
      content:
        (synced ? '将删除云端与本机的' : '将删除本机的') +
        '打卡记录、进行中的会话、音频缓存、音频/背景解锁、收藏和计算偏好；云备份开关会关闭。不可恢复。',
      confirmText: '全部清除',
      confirmColor: '#F87171',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return
        this.eraseThenClear()
      }
    })
  },

  /** 只删除云端副本：本机记录保留；删除期间阻止云同步复活 */
  eraseCloudOnly() {
    if (this._cloudBusy) return
    wx.showModal({
      title: '删除云端副本？',
      content:
        '只删除云端备份（含云端解锁状态与统计数据），本机记录与偏好不受影响。删除后本机数据不会再自动上传。',
      confirmText: '删除云端',
      confirmColor: '#F87171',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return
        this._cloudBusy = true
        wx.showLoading({ title: '删除中', mask: true })
        // 先关闭云备份并置 pending 闸门，再等在途同步结束、最后删云端。
        // 反过来（先删后关）时，erase 往返窗口内任何 syncNow 都会把本机记录重新上传。
        if (!storage.setSyncEnabled(false)) {
          this._cloudBusy = false
          wx.hideLoading()
          wx.showToast({ title: '云备份开关保存失败，请重试', icon: 'none' })
          return
        }
        storage.patchMeta({ syncEpoch: Date.now(), cloudPendingErase: true })
        whenIdle()
          .then(() => withLogin((code) => api.eraseRecords(code, { cloudOnly: true })))
          .then(() => {
            storage.patchMeta({ lastSyncAt: 0, cloudPendingErase: false })
            // 服务端 eraseCloudData 会一并删除 sleep_reminders：本地状态必须同步收敛，
            // 否则首页/入睡页仍显示“已开启”，用户却收不到任何提醒且无法原地重设。
            this.clearLocalCloudReminderState()
            this._cloudBusy = false
            wx.hideLoading()
            this.refresh()
            wx.showToast({ title: '云端副本与提醒已删除', icon: 'none' })
          })
          .catch(() => {
            // 保留 lastSyncAt/cloudPendingErase：页面出现重试入口；同步已关闭，不会复活。
            this._cloudBusy = false
            wx.hideLoading()
            this.refresh()
            wx.showToast({ title: '云端删除失败，请稍后重试', icon: 'none' })
          })
      }
    })
  },

  /**
   * 清空本机睡眠数据。
   * hadCloud 时保留 lastSyncAt/cloudPendingErase，让用户能重试删除云端；
   * 同时阻止下一次同步把云端旧记录拉回来。
   */
  clearLocalData(options) {
    const opts = options || {}
    const meta = storage.getMeta()
    const hadCloud = !!meta.lastSyncAt
    const cloudAt = meta.lastSyncAt || 0
    backgrounds.cleanCache()
    // 先停播放再清缓存：反过来会先删掉正在播放的文件，触发一条“音频加载失败”提示。
    audioTimer.clear()
    // 清除数据是用户显式终止：同步关掉自动恢复意图，避免回前台把声音又拉起来
    audioSession.markStopped()
    try {
      wx.getBackgroundAudioManager().stop()
    } catch (e) {}
    const pending = storage.getPending()
    const planReminder = reminder.getPlanReminder()
    // 必须在 clearAll 之前收集 id（clearAll 会重置 meta）；取消动作放到 clearAll 之后，
    // 失败写入 pendingReminderCancel，由 retryPendingReminderCancel 下次重试。
    const cancelIds = []
    if (pending && pending.id) cancelIds.push(pending.id)
    if (planReminder && planReminder.id) cancelIds.push(planReminder.id)
    const cleared = storage.clearAll()
    events.clearQueue()
    cache.cleanAll()
    // lastTrackActive 已由上面的 audioSession.markStopped() 统一负责，这里不再重复写
    const patch = { syncEpoch: Date.now() }
    const app = getApp()
    if (app && app.globalData) {
      app.globalData.audioSession = false
      // 清除全部数据也应撤销“本会话兜底解锁”，否则首页仍可继续播放
      app.globalData.audioUnlockedSession = false
    }
    if (hadCloud && !opts.cloudCleared) {
      patch.lastSyncAt = cloudAt
      patch.cloudPendingErase = true
    } else {
      patch.lastSyncAt = 0
      patch.cloudPendingErase = false
    }
    storage.patchMeta(patch)
    if (cancelIds.length) {
      // 清空后再取消（不阻塞清除流程）：失败入队，下次进统计页自动重试
      Promise.all(
        cancelIds.map((id) =>
          reminder
            .cancel(id)
            .then(() => '')
            .catch(() => id)
        )
      )
        .then((results) => {
          const failed = results.filter((id) => !!id)
          if (failed.length) storage.patchMeta({ pendingReminderCancel: failed })
        })
        .catch(() => {})
    }
    this._signature = ''
    this.setData({
      posterPath: '',
      posterSharePath: '',
      detail: null,
      selectedKey: '',
      monthOffset: 0
    })
    this.refresh()
    return cleared
  },

  eraseThenClear() {
    const synced = storage.getSyncEnabled()
    const hadCloud = !!storage.getMeta().lastSyncAt
    wx.showLoading({ title: '清除中', mask: true })

    // 先关同步：否则 erase 往返窗口内，任何在途/新发起的 sync 都可能把记录重新传回云端。
    if (!storage.setSyncEnabled(false)) {
      wx.hideLoading()
      wx.showToast({ title: '云备份开关保存失败，请重试', icon: 'none' })
      return
    }

    // 未开启云备份：本地是唯一数据源，必须先删掉；云端历史副本尽力而为，失败不阻断
    if (!synced) {
      const cleared = this.clearLocalData()
      wx.hideLoading()
      wx.showToast({
        title: cleared ? '已清除本机数据' : '本机数据未完全清除，请重试',
        icon: 'none'
      })
      // 先等在途同步结束，再删云端，避免它在 erase 之后把记录重新写回。
      whenIdle()
        .then(() => withLogin((code) => api.eraseRecords(code)))
        .then(() => {
          storage.patchMeta({ lastSyncAt: 0, cloudPendingErase: false })
          this.refresh()
          if (hadCloud) wx.showToast({ title: '云端副本已删除', icon: 'none' })
        })
        .catch(() => {
          // 本机已清除但服务端 erase 失败：无论 lastSyncAt 是否为 0，都必须保留
          // “云端副本待删除”出口，否则用户既看不到重试入口，服务端提醒/事件也可能残留。
          storage.patchMeta({ cloudPendingErase: true })
          this.refresh()
          wx.showToast({
            title: hadCloud ? '云端副本未删除，可在统计页重试' : '服务端数据未清理，可在统计页重试',
            icon: 'none'
          })
        })
      return
    }

    // 开启云备份：先置闸门并等在途同步结束，成功后再清本机，避免云端残留。
    storage.patchMeta({ syncEpoch: Date.now(), cloudPendingErase: true })
    whenIdle()
      .then(() => withLogin((code) => api.eraseRecords(code)))
      .then(() => {
        const cleared = this.clearLocalData({ cloudCleared: true })
        wx.hideLoading()
        wx.showToast({
          title: cleared ? '已全部清除' : '本机数据未完全清除，请重试',
          icon: 'none'
        })
      })
      .catch(() => {
        wx.hideLoading()
        // 云端删不掉时给用户出口：至少把本机数据清掉，云端副本保留。
        // 注意闸门必须保留：删除失败后若直接清掉 cloudPendingErase，重新开启云备份
        // 会把云端旧记录拉回来；而 lastSyncAt 可能本来就是 0，靠它判断不出副本是否还在。
        wx.showModal({
          title: '云端删除失败',
          content: '云端记录暂时删不掉。可以只清除本机数据，云端副本会保留，下方会出现「删除云端副本（保留本机）」供重试。',
          confirmText: '只清本机',
          cancelText: '稍后重试',
          success: (res) => {
            if (!this._alive) return
            if (!res.confirm) {
              // 取消也要刷新：此时开关已写为关闭，停在旧 UI 会让用户以为同步仍开着。
              this.refresh()
              return
            }
            this.clearLocalData()
            storage.patchMeta({ cloudPendingErase: true })
            this.refresh()
            wx.showToast({ title: '已清除本机数据，云端副本待删除', icon: 'none' })
          }
        })
      })
  },

  onMakePoster() {
    if (this._posterBusy) return
    const now = Date.now()
    const recent = S.completedList(storage.getRecords()).filter(
      (record) => T.parseDateKey(record.day) >= T.addDays(T.startOfDay(now), -29)
    )
    if (!recent.length) {
      wx.showToast({ title: '近 30 天还没有完整打卡', icon: 'none' })
      return
    }
    this._posterBusy = true
    // 关闭 loading 与保存图片必须分离：超时只代表“等太久了”，
    // 不代表晚到的绘制结果无效；否则低端机上会出现“图已生成但相册没有”。
    // seq 用于丢弃“上一次已超时、用户又重试”后迟到的旧结果。
    const seq = (this._posterSeq || 0) + 1
    this._posterSeq = seq
    let closed = false
    let saved = false
    let timeout = null
    const closeLoading = () => {
      if (seq !== this._posterSeq || closed) return
      closed = true
      clearTimeout(timeout)
      this._posterBusy = false
      wx.hideLoading()
    }
    const save = (path) => {
      if (seq !== this._posterSeq || !path || saved) return
      saved = true
      this.setData({ posterPath: path })
      wx.saveImageToPhotosAlbum({
        filePath: path,
        success: () => wx.showToast({ title: '已保存到相册', icon: 'none' }),
        fail: (err) => {
          const message = (err && err.errMsg) || ''
          if (/auth|deny|authorize/i.test(message)) {
            wx.showModal({
              title: '需要相册权限',
              content: '去设置里开启“保存到相册”后重试。',
              success: (res) => {
                if (res.confirm) wx.openSetting()
              }
            })
          } else {
            wx.showToast({ title: '保存失败', icon: 'none' })
          }
        }
      })
    }
    const finish = (path) => {
      closeLoading()
      save(path)
    }
    timeout = setTimeout(() => {
      if (seq !== this._posterSeq) return
      closeLoading()
      wx.showToast({ title: '生成较慢，完成后会自动保存', icon: 'none' })
    }, 12000)
    wx.showLoading({ title: '生成中', mask: true })
    // 先在 4s 窗口内拉小程序码（失败/超时就放弃），海报落款自动降级为纯文案
    Promise.race([
      this._fetchPosterQrPath().catch(() => ''),
      new Promise((resolve) => setTimeout(() => resolve(''), 4000))
    ]).then((qrPath) => {
      try {
        this.drawPoster(qrPath, (path) => {
          if (!path) {
            closeLoading()
            return
          }
          // 另画一张 5:4 分享卡：直接把竖版海报当 imageUrl 会被微信分享卡片裁掉底部二维码。
          this.drawShareCard(qrPath, (sharePath) => {
            this.setData({ posterSharePath: sharePath || '' })
            finish(path)
          })
        })
      } catch (e) {
        closeLoading()
        wx.showToast({ title: '海报生成失败', icon: 'none' })
      }
    })
  },

  /** 拉"扫一扫直达"小程序码并写入临时文件；任何失败都返回空串（海报降级） */
  _fetchPosterQrPath() {
    return withLogin((code) => api.fetchPosterQr(code)).then((buffer) => {
      return new Promise((resolve, reject) => {
        const filePath = wx.env.USER_DATA_PATH + '/poster-qr.png'
        wx.getFileSystemManager().writeFile({
          filePath,
          data: buffer,
          success: () => resolve(filePath),
          fail: () => reject(new Error('write failed'))
        })
      })
    })
  },

  /** 600×960（2x）回顾海报；经典 canvas API，离屏绘制。qrPath 为空时不画码 */
  drawPoster(qrPath, done) {
    const ctx = wx.createCanvasContext('poster', this)
    ctx.scale(2, 2)
    const records = storage.getRecords()
    const list = S.completedList(records)
    const now = Date.now()
    const start = T.addDays(T.startOfDay(now), -29)
    const recent = list.filter((r) => T.parseDateKey(r.day) >= start)
    const digest = S.digest(recent)
    const byDay = {}
    recent.forEach((r) => {
      byDay[r.day] = r
    })

    const W = 300
    const H = 480
    // 与页面日历同一套色阶：实色品牌紫由弱到强（半透明会在深底上被空格吃掉对比），
    // 最高档停在浅紫、不接近白
    const colors = [
      'rgba(255,255,255,0.05)',
      '#5A57C8',
      '#6C68E8',
      '#8A90FF',
      '#A5B4FC'
    ]

    ctx.setFillStyle('#080B14')
    ctx.fillRect(0, 0, W, H)
    const grad = ctx.createLinearGradient(0, 0, W, 0)
    grad.addColorStop(0, '#4F46E5')
    grad.addColorStop(1, '#818CF8')
    ctx.setFillStyle(grad)
    ctx.fillRect(0, 0, W, 8)

    ctx.setTextAlign('left')
    ctx.setFillStyle('#F8FAFC')
    ctx.setFontSize(20)
    ctx.fillText('睡点 · 睡眠回顾', 24, 56)
    ctx.setFillStyle('#94A3B8')
    ctx.setFontSize(11)
    ctx.fillText(T.dateKey(start).slice(5) + ' ~ ' + T.dateKey(T.startOfDay(now)).slice(5) + ' · 打卡 ' + digest.count + ' 天', 24, 78)

    const values = [
      { k: '平均上床', v: digest.avgBedMin === null ? '—' : F.fmtClock(digest.avgBedMin) },
      { k: '平均结束', v: digest.avgWakeMin === null ? '—' : F.fmtClock(digest.avgWakeMin) },
      { k: '平均睡眠', v: digest.avgTotalMin === null ? '—' : F.fmtHours(digest.avgTotalMin) }
    ]
    values.forEach((item, index) => {
      const x = 24 + index * 88
      ctx.setFillStyle('#94A3B8')
      ctx.setFontSize(10)
      ctx.fillText(item.k, x, 114)
      ctx.setFillStyle('#818CF8')
      ctx.setFontSize(17)
      ctx.fillText(item.v, x, 134)
    })

    const cell = 26
    const gap = 5
    const x0 = 24
    const y0 = 162
    for (let i = 0; i < 30; i += 1) {
      const key = T.dateKey(T.addDays(start, i))
      const record = byDay[key]
      const level = record ? S.heatLevelOf(S.totalDurationOf(record)) : 0
      const cx = x0 + (i % 7) * (cell + gap)
      const cy = y0 + Math.floor(i / 7) * (cell + gap)
      ctx.setFillStyle(colors[level] || colors[0])
      ctx.fillRect(cx, cy, cell, cell)
    }

    ctx.setFillStyle('#94A3B8')
    ctx.setFontSize(11)
    ctx.setTextAlign('left')
    ctx.fillText('其中 ' + digest.afterMidnightDays + ' 天在凌晨上床', 24, y0 + 5 * (cell + gap) + 18)

    if (qrPath) {
      // 底部左侧：白底衬托小程序码 + 扫码引导
      ctx.setFillStyle('#FFFFFF')
      ctx.fillRect(20, H - 98, 82, 82)
      ctx.drawImage(qrPath, 24, H - 94, 74, 74)
      ctx.setTextAlign('left')
      ctx.setFillStyle('#F8FAFC')
      ctx.setFontSize(12)
      ctx.fillText('扫码打开「睡点」', 112, H - 56)
      ctx.setFillStyle('#94A3B8')
      ctx.setFontSize(9)
      ctx.fillText('数据来自个人打卡 · ' + T.dateKey(now), 112, H - 36)
    } else {
      ctx.setTextAlign('center')
      ctx.setFillStyle('#F8FAFC')
      ctx.setFontSize(12)
      ctx.fillText('微信搜索「睡点」，记录你的入睡节奏', W / 2, H - 42)
      ctx.setFillStyle('#94A3B8')
      ctx.setFontSize(9)
      ctx.fillText('数据来自个人打卡 · ' + T.dateKey(now), W / 2, H - 24)
    }

    ctx.draw(false, () => {
      wx.canvasToTempFilePath(
        {
          canvasId: 'poster',
          destWidth: 600,
          destHeight: 960,
          success: (res) => done(res.tempFilePath),
          fail: () => {
            wx.showToast({ title: '海报生成失败', icon: 'none' })
            done('')
          }
        },
        this
      )
    })
  },

  /** 600×480（5:4）分享卡，二维码完整可见；失败时回退纯文案 */
  drawShareCard(qrPath, done) {
    const ctx = wx.createCanvasContext('share-card', this)
    ctx.scale(2, 2)
    const records = storage.getRecords()
    const now = Date.now()
    const start = T.addDays(T.startOfDay(now), -29)
    const recent = S.completedList(records).filter((r) => T.parseDateKey(r.day) >= start)
    const digest = S.digest(recent)
    const W = 300
    const H = 240

    ctx.setFillStyle('#080B14')
    ctx.fillRect(0, 0, W, H)
    const grad = ctx.createLinearGradient(0, 0, W, 0)
    grad.addColorStop(0, '#4F46E5')
    grad.addColorStop(1, '#818CF8')
    ctx.setFillStyle(grad)
    ctx.fillRect(0, 0, W, 6)

    ctx.setTextAlign('left')
    ctx.setFillStyle('#F8FAFC')
    ctx.setFontSize(18)
    ctx.fillText('睡点 · 睡眠回顾', 20, 42)
    ctx.setFillStyle('#94A3B8')
    ctx.setFontSize(10)
    ctx.fillText('近 30 天 · 打卡 ' + digest.count + ' 天', 20, 62)

    const avgBed = digest.avgBedMin === null ? '—' : F.fmtClock(digest.avgBedMin)
    const avgWake = digest.avgWakeMin === null ? '—' : F.fmtClock(digest.avgWakeMin)
    const avgDuration = digest.avgTotalMin === null ? '—' : F.fmtHours(digest.avgTotalMin)
    ctx.setFillStyle('#A5B4FC')
    ctx.setFontSize(22)
    ctx.fillText(avgBed + ' 上床', 20, 108)
    ctx.fillText(avgWake + ' 结束', 150, 108)
    ctx.setFillStyle('#94A3B8')
    ctx.setFontSize(10)
    ctx.fillText('平均 ' + avgDuration, 20, 128)
    ctx.fillText('其中 ' + digest.afterMidnightDays + ' 天在凌晨上床', 150, 128)

    if (qrPath) {
      ctx.setFillStyle('#FFFFFF')
      ctx.fillRect(206, 146, 76, 76)
      ctx.drawImage(qrPath, 210, 150, 68, 68)
      ctx.setTextAlign('right')
      ctx.setFillStyle('#F8FAFC')
      ctx.setFontSize(10)
      ctx.fillText('扫码记录你的睡眠节奏', 196, 178)
      ctx.setFillStyle('#94A3B8')
      ctx.setFontSize(8)
      ctx.fillText('数据来自个人打卡', 196, 194)
    } else {
      ctx.setTextAlign('right')
      ctx.setFillStyle('#F8FAFC')
      ctx.setFontSize(10)
      ctx.fillText('微信搜索「睡点」', 284, 178)
      ctx.setFillStyle('#94A3B8')
      ctx.setFontSize(8)
      ctx.fillText('数据来自个人打卡 · ' + T.dateKey(now), 284, 194)
    }

    ctx.draw(false, () => {
      wx.canvasToTempFilePath(
        {
          canvasId: 'share-card',
          destWidth: 600,
          destHeight: 480,
          success: (res) => done(res.tempFilePath),
          fail: () => done('')
        },
        this
      )
    })
  },

  onShareAppMessage() {
    // 分享漏斗分母：统计页的分享也必须计入，否则看板系统性低估
    events.track('share', 'stats')
    const duration = this.data.metrics.filter((item) => item.key === 'duration')[0]
    // 主语必须跟随指标周期：本周为空时会回退到最近 7 天/全部记录，
    // 这里若写死「本周打卡 N 天」，分享出去的数字就是另一个周期的
    const scope = this.data.periodLabel || '本周'
    const payload = {
      title: duration
        ? scope + '打卡 ' + this.data.weekCount + ' 天 · 平均睡 ' + duration.value + '，来「睡点」记录睡眠'
        : '睡点 · 只看数据、不做评价的睡眠记录',
      path: '/pages/stats/stats?from=share'
    }
    // 只用 5:4 分享卡，避免竖版海报被微信卡片裁掉底部二维码
    if (this.data.posterSharePath) payload.imageUrl = this.data.posterSharePath
    return payload
  },

  goSleep() {
    tabbar.switchTo(1, '/pages/sleep/sleep')
  },

  onEmptyManual() {
    this.openManualSheet()
  }
})
