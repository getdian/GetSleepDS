const F = require('../../utils/format')
const T = require('../../utils/time')
const S = require('../../utils/stats')
const storage = require('../../utils/storage')
const cache = require('../../utils/audio-cache')
const api = require('../../utils/api')
const { wxLogin } = require('../../utils/login')
const { syncNow } = require('../../utils/sync')
const audioTimer = require('../../utils/audio-timer')
const { getConfig } = require('../../utils/config')

const RANGE_SMALL = 30
const RANGE_FULL = 120

Page({
  data: {
    range: RANGE_SMALL,
    rangeOptions: [
      { value: RANGE_SMALL, label: '近 30 天' },
      { value: RANGE_FULL, label: '近 4 个月' }
    ],
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
    posterPath: ''
  },

  onLoad() {
    this._alive = true
    this._rangeTouched = false
    this._defaultRangeApplied = false
    this._factLoading = false
    this._records = {}
  },

  onShow() {
    this._alive = true
    this.refresh(false)
  },

  onUnload() {
    this._alive = false
  },

  onPullDownRefresh() {
    this.refresh(true)
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

    if (!this._rangeTouched && !this._defaultRangeApplied) {
      this._defaultRangeApplied = true
      this.setData({ range: list.length >= 14 ? RANGE_FULL : RANGE_SMALL })
    }

    this._records = records
    const heat = S.heatmapCells(records, now, this.data.range, partialDay)
    const current = weekly.current
    const meta = storage.getMeta()

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
      syncText: meta.lastSyncAt ? '上次同步 ' + F.fmtClockTs(meta.lastSyncAt) : '尚未同步'
    })

    this.refreshFact(weekly, records, now, forceSummary)
  },

  refreshFact(weekly, records, now, force) {
    const config = getConfig()
    if (!config.features || !config.features.summary) {
      this.setData({ factState: 'off', fact: '' })
      return
    }

    if (weekly.current.count < 3) {
      this.setData({ factState: 'insufficient', fact: '' })
      return
    }

    if (!force && this.data.factState === 'ok' && this._factWeek === weekly.weekStart) return
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
          this.setData({ fact: res.text, factState: 'ok' })
        } else {
          this.setData({ fact: '', factState: 'insufficient' })
        }
      })
      .catch(() => {
        this._factLoading = false
        if (this._alive) this.setData({ factState: 'error' })
      })
  },

  onRangeTap(e) {
    const value = Number(e.currentTarget.dataset.value)
    if (!value || value === this.data.range) return
    this._rangeTouched = true
    const pending = storage.getPending()
    const partialDay = pending ? T.sleepDayOf(pending.bedAt) : ''
    const heat = S.heatmapCells(this._records || storage.getRecords(), Date.now(), value, partialDay)
    this.setData({
      range: value,
      cells: heat.cells,
      colCount: heat.colCount,
      months: heat.months,
      marked: heat.marked
    })
  },

  onHeatTap(e) {
    const cell = e.detail && e.detail.cell
    if (!cell || !cell.day) return
    let text = F.fmtDayCN(cell.day) + ' · 未打卡'
    if (cell.durationMin) text = F.fmtDayCN(cell.day) + ' · ' + F.fmtDuration(cell.durationMin)
    else if (cell.partial) text = F.fmtDayCN(cell.day) + ' · 仅入睡未完成'
    wx.showToast({ title: text, icon: 'none' })
  },

  onSyncTap() {
    if (this.data.syncBusy) return
    this.setData({ syncBusy: true })
    syncNow(true)
      .then((res) => {
        if (!this._alive) return
        this.setData({ syncBusy: false })
        if (res && res.skipped === 'feature_off') {
          wx.showToast({ title: '云同步未开启', icon: 'none' })
          return
        }
        this.refresh(false)
        wx.showToast({ title: '已同步', icon: 'none' })
      })
      .catch(() => {
        if (!this._alive) return
        this.setData({ syncBusy: false })
        wx.showToast({ title: '同步失败，请稍后重试', icon: 'none' })
      })
  },

  onClearData() {
    wx.showModal({
      title: '清除全部睡眠数据',
      content: '将删除云端与本机的打卡记录、进行中的会话和音频缓存，不可恢复。',
      confirmText: '全部清除',
      confirmColor: '#F87171',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return
        this.eraseThenClear()
      }
    })
  },

  eraseThenClear() {
    wx.showLoading({ title: '清除中', mask: true })
    wxLogin()
      .then((code) => api.eraseRecords(code))
      .then(() => {
        storage.clearAll()
        cache.cleanAll()
        audioTimer.clear()
        try {
          wx.getBackgroundAudioManager().stop()
        } catch (e) {}
        wx.hideLoading()
        this._factWeek = null
        this.refresh(true)
        wx.showToast({ title: '已全部清除', icon: 'none' })
      })
      .catch(() => {
        wx.hideLoading()
        // 云端删除失败时不清本地，避免下次同步把记录拉回来
        wx.showToast({ title: '清除失败，请稍后重试', icon: 'none' })
      })
  },

  onFactRetry() {
    this.refresh(true)
  },

  onMakePoster() {
    if (!S.completedList(storage.getRecords()).length) {
      wx.showToast({ title: '还没有完整打卡', icon: 'none' })
      return
    }
    wx.showLoading({ title: '生成中', mask: true })
    this.drawPoster((path) => {
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
    })
  },

  /** 300×480 月度回顾海报；经典 canvas API，离屏绘制 */
  drawPoster(done) {
    const ctx = wx.createCanvasContext('poster', this)
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
    const colors = ['rgba(255,255,255,0.05)', '#3730A3', '#4338CA', '#6366F1', '#818CF8', '#A5B4FC']

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

    ctx.setTextAlign('center')
    ctx.setFillStyle('#F8FAFC')
    ctx.setFontSize(12)
    ctx.fillText('微信搜索「睡点」，记录你的入睡节奏', W / 2, H - 42)
    ctx.setFillStyle('#94A3B8')
    ctx.setFontSize(9)
    ctx.fillText('数据来自个人打卡 · ' + T.dateKey(now), W / 2, H - 24)

    ctx.draw(false, () => {
      wx.canvasToTempFilePath(
        {
          canvasId: 'poster',
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

  onShareAppMessage() {
    return {
      title: '我的睡眠回顾 · 睡点',
      path: '/pages/stats/stats',
      imageUrl: this.data.posterPath || ''
    }
  },

  goHome() {
    wx.switchTab({ url: '/pages/sleep/sleep' })
  }
})
