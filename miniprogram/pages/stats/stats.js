const F = require('../../utils/format')
const T = require('../../utils/time')
const S = require('../../utils/stats')
const storage = require('../../utils/storage')
const cache = require('../../utils/audio-cache')
const backgrounds = require('../../utils/backgrounds')
const api = require('../../utils/api')
const { withLogin } = require('../../utils/login')
const { syncNow, whenIdle } = require('../../utils/sync')
const audioTimer = require('../../utils/audio-timer')
const reminder = require('../../utils/reminder')
const events = require('../../utils/events')
const adSlots = require('../../utils/ads')
const { getConfig, loadConfig } = require('../../utils/config')

const MONTH_MIN_OFFSET = -24

Page({
  data: {
    ads: adSlots.empty(),
    syncEnabled: false,
    hasCloudCopy: false,
    hasData: false,
    // 首屏 3 个核心指标：平均睡眠 / 平均入睡 / 平均起床
    metrics: [],
    metricKey: '',
    metricDetail: null,
    weekCount: 0,
    streak: 0,
    // 日历周期：1 = 当月，3/6/12 = 横向滑动的连续月
    calendarSpan: 1,
    calendarCells: [],
    calendarMonths: [],
    calendarTitle: '',
    calendarNote: '',
    canNextMonth: false,
    monthOffset: 0,
    detail: null,
    selectedKey: '',
    settingsOpen: false,
    syncText: '尚未同步',
    syncBusy: false,
    posterPath: '',
    posterSharePath: ''
  },

  onLoad() {
    this._alive = true
    this._records = {}
    this._signature = ''
    // 先在 onLoad 渲染一次，避免首帧先画“还没有记录”再被 onShow 覆盖
    this.refresh()
    adSlots.apply(this)
  },

  onShow() {
    this._alive = true
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) tabBar.setData({ selected: 2 })
    this.refresh()
    adSlots.apply(this)
    loadConfig(true)
      .then(() => {
        if (this._alive) this.refresh()
      })
      .catch(() => {})
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
    const pending = storage.getPending()
    const partialDay = pending ? T.dateKey(now) : ''
    const monthOffset = Number(this.data.monthOffset) || 0
    const calendarSpan = Number(this.data.calendarSpan) || 1
    const calendar =
      calendarSpan === 1 ? S.calendarCells(records, now, monthOffset, partialDay) : null
    const calendarMonths =
      calendarSpan > 1 ? S.calendarMonths(records, now, calendarSpan, partialDay) : []
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
          ? '上次同步有 ' + (Number(meta.lastSyncDropped) || 0) + ' 条记录云端未写入'
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
      metrics.map((item) => item.value + '/' + item.sub + '/' + item.detail.join('|')).join('|'),
      metricData.count,
      metricData.streak,
      calendarSpan,
      calendar ? calendar.cells.map((cell) => cell.level).join('') : '',
      calendarMonths.map((month) => month.cells.map((cell) => cell.level).join('')).join('|'),
      // 跨天、进行中的会话、云端副本状态都会改变界面，必须进签名，否则不会刷新
      todayKey,
      partialDay,
      syncEnabled ? 1 : 0,
      meta.lastSyncAt ? 1 : 0,
      syncText
    ].join('#')

    if (signature !== this._signature) {
      this._signature = signature
      this.setData({
        hasData,
        metrics,
        weekCount: metricData.count,
        streak: metricData.streak,
        calendarSpan,
        calendarCells: calendar ? calendar.cells : [],
        calendarMonths,
        calendarTitle: calendar ? calendar.monthLabel : '',
        calendarNote,
        canNextMonth: monthOffset < 0,
        // 数据或周期变了才清空详情与选中态，避免指向已修改/已切换的记录
        detail: null,
        selectedKey: '',
        metricKey: '',
        metricDetail: null,
        syncEnabled,
        hasCloudCopy: !!meta.lastSyncAt,
        syncText
      })
    }
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
    // 选中态由页面统一持有：refresh 清空详情时能同步清掉描边
    this.setData({ selectedKey: cell.key })
    this.showDetail(cell.day)
  },

  onStripTap(e) {
    const day = e.detail && e.detail.day
    if (!day) return
    this.setData({ selectedKey: day })
    this.showDetail(day)
  },

  /** 空格子补记：把日期带到入睡页，由它打开补记面板 */
  onAddMissing(e) {
    const day = e.currentTarget.dataset.day
    if (!day) return
    if (!storage.patchMeta({ manualDay: day })) {
      wx.showToast({ title: '本地存储写入失败，请重试', icon: 'none' })
      return
    }
    wx.switchTab({ url: '/pages/sleep/sleep' })
  },

  showDetail(day) {
    const records = this._records || {}
    const record = records[day]
    const now = Date.now()
    const title = F.fmtDateCN(T.parseDateKey(day))
    const todayKey = T.dateKey(now)

    if (day > todayKey) {
      this.setData({
        detail: { day, title, tag: '还没到', main: '这一天还没到', sub: '', canAdd: false }
      })
      return
    }

    if (!record || !record.bedAt || !record.wakeAt) {
      const pending = storage.getPending()
      const pendingDay = pending ? T.dateKey(now) : ''
      if (pending && day === pendingDay) {
        this.setData({
          detail: {
            day,
            title,
            tag: '仅入睡',
            main: '已记录入睡，还没有结束时间',
            sub: '结束后才会进入时长统计',
            canAdd: false
          }
        })
        return
      }
      this.setData({
        detail: {
          day,
          title,
          tag: '未记录',
          main: '这天还没有记录',
          sub: '可以补记这一段睡眠',
          canAdd: true
        }
      })
      return
    }

    const night = S.durationOf(record)
    const totalMin = S.totalDurationOf(record)
    const nap = Math.max(0, totalMin - night)
    const pending = storage.getPending()
    const inProgress = pending && day === T.dateKey(now) ? ' · 另有进行中的一段' : ''
    const main =
      F.fmtClockTs(record.bedAt) + ' 入睡 → ' + F.fmtClockTs(record.wakeAt) + ' 结束 · ' + F.fmtDuration(totalMin)
    const sub =
      (nap > 0 ? '夜间 ' + F.fmtDuration(night) + ' · 午休/间断 ' + F.fmtDuration(nap) : '夜间 ' + F.fmtDuration(night)) +
      ' · 按醒来日归档' +
      inProgress
    this.setData({ detail: { day, title, tag: '已记录', main, sub, canAdd: false } })
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
            this._cloudBusy = false
            wx.hideLoading()
            this.refresh()
            wx.showToast({ title: '云端副本已删除', icon: 'none' })
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
    try {
      wx.getBackgroundAudioManager().stop()
    } catch (e) {}
    const pending = storage.getPending()
    if (pending && pending.id) reminder.cancel(pending.id).catch(() => {})
    const cleared = storage.clearAll()
    events.clearQueue()
    cache.cleanAll()
    const patch = { syncEpoch: Date.now(), lastTrackActive: false, lastTrackPlaying: false }
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
          // lastSyncAt/cloudPendingErase 已保留，统计页会出现“删除云端副本”重试入口
          this.refresh()
          if (hadCloud) wx.showToast({ title: '云端副本未删除，可在统计页重试', icon: 'none' })
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
        // 云端删不掉时给用户出口：至少把本机数据清掉，云端副本保留
        wx.showModal({
          title: '云端删除失败',
          content: '云端记录暂时删不掉。可以只清除本机数据，云端副本会保留，之后可在统计页重试删除。',
          confirmText: '只清本机',
          cancelText: '稍后重试',
          success: (res) => {
            if (!res.confirm || !this._alive) return
            this.clearLocalData()
            wx.showToast({ title: '已清除本机数据', icon: 'none' })
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
    const colors = ['rgba(255,255,255,0.05)', '#3F3C9E', '#5B57D6', '#B4BEFF', '#E0E7FF']

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
      { k: '平均入睡', v: digest.avgBedMin === null ? '—' : F.fmtClock(digest.avgBedMin) },
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
    ctx.fillText('其中 ' + digest.afterMidnightDays + ' 天在凌晨入睡', 24, y0 + 5 * (cell + gap) + 18)

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
    ctx.fillText(avgBed + ' 入睡', 20, 108)
    ctx.fillText(avgWake + ' 结束', 150, 108)
    ctx.setFillStyle('#94A3B8')
    ctx.setFontSize(10)
    ctx.fillText('平均 ' + avgDuration, 20, 128)
    ctx.fillText('其中 ' + digest.afterMidnightDays + ' 天在凌晨入睡', 150, 128)

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
    const duration = this.data.metrics.filter((item) => item.key === 'duration')[0]
    const payload = {
      title: duration
        ? '本周打卡 ' + this.data.weekCount + ' 天 · 平均睡 ' + duration.value + '，来「睡点」记录睡眠'
        : '睡点 · 只看数据、不做评价的睡眠记录',
      path: '/pages/stats/stats?from=share'
    }
    // 只用 5:4 分享卡，避免竖版海报被微信卡片裁掉底部二维码
    if (this.data.posterSharePath) payload.imageUrl = this.data.posterSharePath
    return payload
  },

  goSleep() {
    wx.switchTab({ url: '/pages/sleep/sleep' })
  }
})
