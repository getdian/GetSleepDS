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
const events = require('../../utils/events')
const adSlots = require('../../utils/ads')
const { getConfig, loadConfig } = require('../../utils/config')

// 热力图板面：3 个月前的 1 号 → 今天 + 21 天所在周的周日（末段是未来占位）
const HEAT_MONTHS_BACK = 3

Page({
  data: {
    ads: adSlots.empty(),
    syncEnabled: false,
    hasCloudCopy: false,
    hasData: false,
    avgBed: '--:--',
    avgWake: '--:--',
    avgDuration: '--',
    weekCount: 0,
    streak: 0,
    cells: [],
    colCount: 0,
    months: [],
    marked: 0,
    fact: '',
    factState: 'idle',
    syncText: '尚未同步',
    syncBusy: false,
    posterPath: '',
    posterSharePath: ''
  },

  onLoad() {
    this._alive = true
    this._factLoading = false
    this._factSignature = ''
    this._records = {}
    // 先在 onLoad 渲染一次，避免首帧先画“还没有记录”再被 onShow 覆盖
    this.refresh(false)
    adSlots.apply(this)
  },

  onShow() {
    this._alive = true
    this.refresh(false)
    adSlots.apply(this)
    loadConfig(true)
      .then(() => {
        if (this._alive) this.refresh(false)
      })
      .catch(() => {})
  },

  onUnload() {
    this._alive = false
  },

  onPullDownRefresh() {
    this.refresh(true)
    // 运营改完广告位后，下拉刷新可立即拿到新配置（绕过 10 分钟 TTL）
    adSlots.reload(this)
    wx.stopPullDownRefresh()
  },

  refresh(forceSummary) {
    if (!this._alive) return
    const now = Date.now()
    const records = storage.getRecords()
    const list = S.completedList(records)
    const weekly = S.weekly(records, now)
    const pending = storage.getPending()
    const partialDay = pending ? T.sleepDayOf(pending.bedAt) : ''

    // 月对齐图板：3 个月前的 1 号起，末尾约 3 周为未来占位（当前 10 月即 7 月 1 日起）
    const span = S.monthsSpan(now, HEAT_MONTHS_BACK)
    this._records = records
    const heat = S.heatmapCells(records, now, span.days, partialDay, span.endOffsetDays)
    const current = weekly.current
    const meta = storage.getMeta()
    const config = getConfig()
    const syncFeature = !config.features || config.features.sync !== false
    let syncEnabled = storage.getSyncEnabled()
    if (syncEnabled && !syncFeature) {
      storage.setSyncEnabled(false)
      syncEnabled = false
    }
    const cloudPending = !!meta.cloudPendingErase

    this.setData({
      hasData: list.length > 0 || !!pending,
      avgBed: current.avgBedMin === null ? '--:--' : F.fmtClock(current.avgBedMin),
      avgWake: current.avgWakeMin === null ? '--:--' : F.fmtClock(current.avgWakeMin),
      avgDuration: current.avgDurationMin === null ? '--' : F.fmtHours(current.avgDurationMin),
      weekCount: current.count,
      streak: weekly.streak,
      cells: heat.cells,
      colCount: heat.colCount,
      months: heat.months,
      marked: heat.marked,
      syncEnabled,
      hasCloudCopy: !!meta.lastSyncAt,
      syncText: cloudPending
        ? '云端副本尚未删除，请先删除'
        : syncEnabled
          ? meta.lastSyncAt
            ? '上次同步 ' + F.fmtClockTs(meta.lastSyncAt)
            : '已开启，尚未同步'
          : syncFeature
            ? '仅存本机 · 未开启云备份'
            : '仅存本机 · 服务端暂未开放云备份'
    })

    this.refreshFact(weekly, records, now, forceSummary)
  },

  refreshFact(weekly, records, now, force) {
    const config = getConfig()
    if (!config.features || !config.features.summary) {
      this.setData({ factState: 'off', fact: '' })
      return
    }

    const syncFeature = !config.features || config.features.sync !== false
    // 未开启云备份（或服务端关闭同步）时用本地模板生成，零上传；开启后才走服务端模板
    if (!syncFeature || !storage.getSyncEnabled()) {
      const local = S.localFact(records, now)
      this.setData({
        factState: local.available ? 'ok' : 'insufficient',
        fact: local.text
      })
      return
    }

    if (weekly.current.count < 3) {
      this.setData({ factState: 'insufficient', fact: '' })
      return
    }

    const signature = S.factSignature(weekly)
    if (
      !force &&
      this.data.factState === 'ok' &&
      this._factWeek === weekly.weekStart &&
      this._factSignature === signature
    ) {
      return
    }
    if (this._factLoading) return

    this._factLoading = true
    this.setData({ factState: 'loading' })

    const payload = S.summaryPayload(records, now, 14)
    api
      .fetchSummary(payload)
      .then((res) => {
        this._factLoading = false
        if (!this._alive) return
        if (res && res.available && res.text) {
          this._factWeek = weekly.weekStart
          this._factSignature = signature
          this.setData({ fact: res.text, factState: 'ok' })
        } else {
          // 已满 3 条但服务端没给出结论，属于“暂时不可用”，不能误导为不足 3 条
          this.setData({ fact: '', factState: 'unavailable' })
        }
      })
      .catch(() => {
        this._factLoading = false
        if (this._alive) this.setData({ factState: 'error' })
      })
  },

  onHeatTap(e) {
    const cell = e.detail && e.detail.cell
    if (!cell || !cell.day) return
    if (cell.future) {
      wx.showToast({ title: '这一天还没到', icon: 'none' })
      return
    }
    let text = F.fmtDayCN(cell.day) + ' · 未打卡'
    if (cell.durationMin) text = F.fmtDayCN(cell.day) + ' · ' + F.fmtDuration(cell.durationMin)
    else if (cell.partial) text = F.fmtDayCN(cell.day) + ' · 仅入睡未完成'
    wx.showToast({ title: text, icon: 'none' })
  },

  // 自绘开关：状态完全由 data.syncEnabled 驱动，失败/取消时不需要回滚组件状态
  onSyncToggle() {
    this.applySyncEnabled(!this.data.syncEnabled)
  },

  applySyncEnabled(enabled) {
    if (!enabled) {
      if (!storage.setSyncEnabled(false)) {
        wx.showToast({ title: '云备份开关保存失败', icon: 'none' })
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
        this.refresh(false)
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
      content: '只删除云端备份，本机记录与偏好不受影响。删除后本机数据不会再自动上传。',
      confirmText: '删除云端',
      confirmColor: '#F87171',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return
        this._cloudBusy = true
        wx.showLoading({ title: '删除中', mask: true })
        // 先等在途同步结束，再 bump epoch；否则旧响应可能把记录合并回本地。
        whenIdle()
          .then(() => {
            storage.patchMeta({ syncEpoch: Date.now() })
            return withLogin((code) => api.eraseRecords(code, { cloudOnly: true }))
          })
          .then(() => {
            if (!storage.setSyncEnabled(false)) {
              wx.showToast({ title: '云备份开关保存失败', icon: 'none' })
            }
            storage.patchMeta({ lastSyncAt: 0, cloudPendingErase: false })
            this._cloudBusy = false
            wx.hideLoading()
            this.refresh(false)
            wx.showToast({ title: '云端副本已删除', icon: 'none' })
          })
          .catch(() => {
            this._cloudBusy = false
            wx.hideLoading()
            this.refresh(false)
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
    const cleared = storage.clearAll()
    events.clearQueue()
    cache.cleanAll()
    audioTimer.clear()
    try {
      wx.getBackgroundAudioManager().stop()
    } catch (e) {}
    const patch = { syncEpoch: Date.now(), lastTrackActive: false }
    if (hadCloud && !opts.cloudCleared) {
      patch.lastSyncAt = cloudAt
      patch.cloudPendingErase = true
    } else {
      patch.lastSyncAt = 0
      patch.cloudPendingErase = false
    }
    storage.patchMeta(patch)
    this._factWeek = null
    this._factSignature = ''
    this.setData({ posterPath: '', posterSharePath: '' })
    this.refresh(true)
    return cleared
  },

  eraseThenClear() {
    const synced = storage.getSyncEnabled()
    const hadCloud = !!storage.getMeta().lastSyncAt
    wx.showLoading({ title: '清除中', mask: true })

    // 未开启云备份：本地是唯一数据源，必须先删掉；云端历史副本尽力而为，失败不阻断
    if (!synced) {
      const cleared = this.clearLocalData()
      wx.hideLoading()
      wx.showToast({
        title: cleared ? '已清除本机数据' : '本机数据未完全清除，请重试',
        icon: 'none'
      })
      if (hadCloud) {
        withLogin((code) => api.eraseRecords(code))
          .then(() => {
            storage.patchMeta({ lastSyncAt: 0, cloudPendingErase: false })
            this.refresh(false)
            wx.showToast({ title: '云端副本已删除', icon: 'none' })
          })
          .catch(() => {
            // lastSyncAt/cloudPendingErase 已保留，统计页会出现“删除云端副本”重试入口
            this.refresh(false)
            wx.showToast({ title: '云端副本未删除，可在统计页重试', icon: 'none' })
          })
      } else {
        withLogin((code) => api.eraseRecords(code)).catch(() => {})
      }
      return
    }

    withLogin((code) => api.eraseRecords(code))
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

  onFactRetry() {
    this.refresh(true)
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
    let finished = false
    let timeout = null
    const finish = (path) => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      this._posterBusy = false
      wx.hideLoading()
      if (!path) return
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
    timeout = setTimeout(() => {
      finish('')
      wx.showToast({ title: '海报生成超时，请重试', icon: 'none' })
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
            finish('')
            return
          }
          // 另画一张 5:4 分享卡：直接把竖版海报当 imageUrl 会被微信分享卡片裁掉底部二维码。
          this.drawShareCard(qrPath, (sharePath) => {
            this.setData({ posterSharePath: sharePath || '' })
            finish(path)
          })
        })
      } catch (e) {
        finish('')
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
    const colors = ['rgba(255,255,255,0.05)', '#5A57C8', '#6C68E8', '#8A90FF', '#B4BEFF', '#E0E7FF']

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
      { k: '平均起床', v: digest.avgWakeMin === null ? '—' : F.fmtClock(digest.avgWakeMin) },
      { k: '平均时长', v: digest.avgDurationMin === null ? '—' : F.fmtHours(digest.avgDurationMin) }
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
      const level = record ? S.levelOf(S.durationOf(record)) : 0
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
    const avgDuration = digest.avgDurationMin === null ? '—' : F.fmtHours(digest.avgDurationMin)
    ctx.setFillStyle('#A5B4FC')
    ctx.setFontSize(22)
    ctx.fillText(avgBed + ' 入睡', 20, 108)
    ctx.fillText(avgWake + ' 起床', 150, 108)
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
    const payload = {
      title: this.data.hasData
        ? '本周打卡 ' + this.data.weekCount + ' 天 · 连续 ' + this.data.streak + ' 天，来「睡点」记录睡眠'
        : '睡点 · 只看数据、不做评价的睡眠记录',
      path: '/pages/stats/stats?from=share'
    }
    // 只用 5:4 分享卡，避免竖版海报被微信卡片裁掉底部二维码
    if (this.data.posterSharePath) payload.imageUrl = this.data.posterSharePath
    return payload
  },

  goHome() {
    wx.switchTab({ url: '/pages/sleep/sleep' })
  }
})
