const T = require('../../utils/time')
const F = require('../../utils/format')
const P = require('../../utils/plan')
const storage = require('../../utils/storage')
const adSlots = require('../../utils/ads')
const backgrounds = require('../../utils/backgrounds')
const ad = require('../../utils/ad')
const { getConfig, loadConfig } = require('../../utils/config')

const CLOCK_INTERVAL = 30 * 1000

Page({
  data: {
    ads: adSlots.empty(),
    mode: 'wake',
    wakeTime: '07:30',
    sleepTime: '23:00',
    fallAsleep: 15,
    fallOptions: [5, 10, 15, 20],
    view: null,
    flipped: false,
    nowText: '',
    background: null,
    bgError: false,
    backgrounds: [],
    bgCategories: ['全部'],
    bgCategory: '全部',
    bgItems: [],
    bgOpen: false,
    bgUnlockHours: 24,
    bgFreeMode: false,
    bgBusy: false
  },

  onLoad() {
    this._alive = true
    this._bgItems = []
    const now = Date.now()
    const hour = new Date(now).getHours()
    const prefs = storage.getPrefs()
    // 白天默认给今晚的 23:00，避免“现在睡到 21:25”这种尴尬结果
    const sleepMinutes = hour >= 9 && hour < 18 ? 23 * 60 : Math.round(T.minutesOf(now) / 5) * 5
    this.setData({
      wakeTime: prefs.wakeTime || '07:30',
      sleepTime: prefs.sleepTime || F.fmtClock(sleepMinutes),
      fallAsleep: typeof prefs.fallAsleep === 'number' ? prefs.fallAsleep : 15,
      nowText: F.fmtClock(Math.round(T.minutesOf(now) / 5) * 5)
    })

    this.loadBackgrounds()
    // onLoad 必须强制拉一次：后台刚改的背景图/广告位不能被 10 分钟缓存挡住
    loadConfig(true)
      .then(() => {
        if (this._alive) this.loadBackgrounds()
      })
      .catch(() => {})
  },

  onShow() {
    this._alive = true
    this.refreshNow()
    this.startClock()
    adSlots.apply(this)
    // 从后台保存后切回小程序，onShow 立即刷新，而不是等 10 分钟
    loadConfig(true)
      .then(() => {
        if (this._alive) this.loadBackgrounds()
      })
      .catch(() => {})
    // 切走再回来时，已翻到结果面的推荐时间要重新判定“已过”
    if (this.data.flipped) this.calc(true)
  },

  onHide() {
    this.stopClock()
  },

  onUnload() {
    this._alive = false
    this.stopClock()
  },

  refreshNow() {
    this.setData({ nowText: F.fmtClock(Math.round(T.minutesOf(Date.now()) / 5) * 5) })
  },

  startClock() {
    this.stopClock()
    this._clockTimer = setInterval(() => {
      if (this._alive) this.refreshNow()
    }, CLOCK_INTERVAL)
  },

  stopClock() {
    if (this._clockTimer) {
      clearInterval(this._clockTimer)
      this._clockTimer = null
    }
  },

  savePrefs(patch) {
    storage.setPrefs(patch)
  },

  /* ---------------- 计算 ---------------- */

  onTimeChange(event) {
    const value = event.detail.value
    if (!value) return
    const key = this.data.mode === 'wake' ? 'wakeTime' : 'sleepTime'
    if (value === this.data[key]) return

    const patch = { flipped: false, view: null }
    patch[key] = value
    this.setData(patch)

    const prefs = {}
    prefs[key] = value
    this.savePrefs(prefs)
  },

  toggleMode() {
    const next = this.data.mode === 'wake' ? 'sleep' : 'wake'
    this.setData({ mode: next, flipped: false, view: null })
  },

  onNowTap() {
    const now = Date.now()
    const value = F.fmtClock(Math.round(T.minutesOf(now) / 5) * 5)
    this.setData({
      sleepTime: value,
      nowText: value,
      mode: 'sleep',
      flipped: false,
      view: null
    })
    // “用现在的时间”是瞬时动作，不写入偏好
  },

  onFallAsleepTap(event) {
    const minutes = Number(event.currentTarget.dataset.min)
    if (!minutes || minutes === this.data.fallAsleep) return
    this.setData({ fallAsleep: minutes })
    this.savePrefs({ fallAsleep: minutes })
    if (this.data.flipped) this.calc(true)
  },

  /** 结果面也能调整入睡耗时并立即重算（PRD 3.4） */
  cycleFall() {
    const options = this.data.fallOptions
    const index = options.indexOf(this.data.fallAsleep)
    const minutes = options[(index + 1) % options.length]
    this.setData({ fallAsleep: minutes })
    this.savePrefs({ fallAsleep: minutes })
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
    if (this.data.flipped) this.calc(true)
  },

  onCalc() {
    const key = this.data.mode === 'wake' ? 'wakeTime' : 'sleepTime'
    let value = this.data[key]
    const wheel = this.selectComponent('#calc-wheel')
    if (wheel && wheel.flush) {
      const flushed = wheel.flush()
      if (flushed) value = flushed
    }
    if (value !== this.data[key]) this.setData({ [key]: value })
    this.calc(false, value)
  },

  calc(silent, explicitValue) {
    const now = Date.now()
    const value =
      explicitValue || (this.data.mode === 'wake' ? this.data.wakeTime : this.data.sleepTime)
    let view = null

    if (this.data.mode === 'wake') {
      const wakeMinutes = T.parseClock(value)
      const plan = P.bedtimesForWake(now, wakeMinutes, this.data.fallAsleep)
      const main = plan.slots.filter((slot) => !slot.passed)[0] || null

      const rows = plan.slots
        .filter((slot) => !main || slot.cycles !== main.cycles)
        .map((slot) => ({
          cycles: slot.cycles,
          time: F.fmtClockTs(slot.at),
          day: slot.dayLabel,
          duration: F.fmtDuration(slot.durationMin),
          passed: slot.passed
        }))

      view = {
        label: main ? '推荐入睡时间' : '现在睡',
        mainTime: main ? F.fmtClockTs(main.at) : F.fmtDuration(plan.availableMin),
        mainDay: main ? main.dayLabel : '',
        mainMeta: main
          ? main.cycles + ' 个周期 · ' + F.fmtDuration(main.durationMin)
          : '距离 ' + value + ' 起床',
        note: main
          ? '已为入睡留出 ' + this.data.fallAsleep + ' 分钟'
          : '三个完整周期都已错过',
        allPassed: plan.allPassed,
        compact: !main,
        rows
      }
    } else {
      const sleepMinutes = T.parseClock(value)
      const plan = P.wakeTimesForSleep(now, sleepMinutes, this.data.fallAsleep)
      const main = plan.slots[0]

      const rows = plan.slots.slice(1).map((slot) => ({
        cycles: slot.cycles,
        time: F.fmtClockTs(slot.at),
        day: slot.dayLabel,
        duration: F.fmtDuration(slot.durationMin),
        passed: false
      }))

      view = {
        label: '推荐起床时间',
        mainTime: F.fmtClockTs(main.at),
        mainDay: main.dayLabel,
        mainMeta: main.cycles + ' 个周期 · ' + F.fmtDuration(main.durationMin),
        note: '从 ' + value + ' 上床算起，已含 ' + this.data.fallAsleep + ' 分钟入睡',
        allPassed: false,
        compact: false,
        rows
      }
    }

    this.setData({ view, flipped: true })
    if (!silent && wx.vibrateShort) wx.vibrateShort({ type: 'light' })
  },

  reset() {
    this.setData({ flipped: false, view: null })
  },

  goSleep() {
    wx.switchTab({ url: '/pages/sleep/sleep' })
  },

  /* ---------------- 背景图 ---------------- */

  loadBackgrounds() {
    if (!this._alive) return
    const config = getConfig()
    const list = backgrounds.normalize(config.backgrounds)
    const unlocked = backgrounds.getUnlocked()
    const now = Date.now()

    const active = backgrounds.prepare(config, (id, path) => {
      if (this._alive && this.data.background && this.data.background.id === id) {
        this.setData({ 'background.localPath': path })
      }
    })

    const defaultItem = backgrounds.defaultOf(config)
    const unlock = config.unlock || {}
    const freeMode = unlock.mode !== 'rewarded' || !unlock.adUnitId
    const items = list.map((item) => ({
      id: item.id,
      title: item.title,
      category: item.category,
      url: item.url,
      thumbUrl: item.thumbUrl,
      localPath: backgrounds.localPathOf(item.url),
      isDefault: !!defaultItem && item.id === defaultItem.id,
      unlocked: backgrounds.isUnlocked(unlocked, item.id, now)
    }))

    this._bgItems = items
    const categories = backgrounds.categories(list)
    const category = categories.indexOf(this.data.bgCategory) >= 0 ? this.data.bgCategory : '全部'

    this.setData({
      backgrounds: list,
      background: active,
      bgError: false,
      bgUnlockHours: Number(config.backgroundUnlockHours) || 24,
      bgFreeMode: freeMode,
      bgCategories: categories,
      bgCategory: category,
      bgItems: this.filterBgItems(items, category)
    })
  },

  filterBgItems(items, category) {
    if (!category || category === '全部') return items
    return items.filter((item) => item.category === category)
  },

  onBackgroundError() {
    // 本地缓存失效时先回退远程 URL；远程也失败才隐藏背景层
    if (this.data.background && this.data.background.localPath) {
      this.setData({ 'background.localPath': '' })
      return
    }
    this.setData({ bgError: true })
  },

  openBgPicker() {
    if (!this.data.backgrounds.length) {
      wx.showToast({ title: '后台还没有配置背景图', icon: 'none' })
      return
    }
    // 打开前重算一次，刷新到期/解锁状态
    this.loadBackgrounds()
    this.setData({ bgOpen: true })
  },

  closeBgPicker() {
    this.setData({ bgOpen: false })
  },

  onBgCategory(event) {
    const category = event.detail.category
    this.setData({
      bgCategory: category,
      bgItems: this.filterBgItems(this._bgItems, category)
    })
  },

  onBgSelect(event) {
    if (this.data.bgBusy) return
    const id = event.detail.id
    const item = this.data.backgrounds.filter((bg) => bg.id === id)[0]
    if (!item) return

    const config = getConfig()
    const defaultItem = backgrounds.defaultOf(config)
    const isDefault = !!defaultItem && defaultItem.id === id
    const unlock = config.unlock || {}
    const freeMode = unlock.mode !== 'rewarded' || !unlock.adUnitId
    const activeUnlock = backgrounds.getUnlocked()
    const now = Date.now()

    if (isDefault) {
      if (
        activeUnlock &&
        backgrounds.isUnlocked(activeUnlock, activeUnlock.id, now) &&
        activeUnlock.id !== id
      ) {
        const leftHours = Math.max(1, Math.ceil((activeUnlock.expireAt - now) / 3600000))
        wx.showModal({
          title: '切换到默认背景？',
          content:
            '当前付费背景还剩约 ' + leftHours + ' 小时。切换后会结束本次解锁，再使用需重新' +
            (freeMode ? '选择' : '观看视频') +
            '。',
          confirmText: '切换',
          cancelText: '保留',
          success: (res) => {
            if (res.confirm) this.applyBackground(id)
          }
        })
        return
      }
      this.applyBackground(id)
      return
    }

    if (backgrounds.isUnlocked(activeUnlock, id, now)) {
      this.applyBackground(id)
      return
    }

    if (freeMode) {
      this.finishBackgroundUnlock(id)
      return
    }

    wx.showModal({
      title: '解锁这张背景',
      content: '观看一段视频，解锁后 ' + this.data.bgUnlockHours + ' 小时内可使用。',
      confirmText: '观看视频',
      cancelText: '先不用',
      success: (res) => {
        if (res.confirm) this.showBackgroundAd(id)
      }
    })
  },

  showBackgroundAd(id) {
    const config = getConfig()
    const unlock = config.unlock || {}

    if (unlock.mode !== 'rewarded' || !unlock.adUnitId) {
      this.finishBackgroundUnlock(id)
      return
    }

    ad.init(unlock.adUnitId)
    this.setData({ bgBusy: true })

    ad.show().then((result) => {
      if (!this._alive) return
      this.setData({ bgBusy: false })

      if (result === 'skipped') {
        wx.showToast({ title: '视频没看完，先不解锁', icon: 'none' })
        return
      }

      if (result === 'error' || result === 'unavailable') {
        if (unlock.onAdError === 'deny') {
          wx.showToast({ title: '广告暂不可用，稍后再试', icon: 'none' })
          return
        }
        wx.showToast({ title: '广告没加载出来，本次直接解锁', icon: 'none' })
      }

      this.finishBackgroundUnlock(id)
    })
  },

  finishBackgroundUnlock(id) {
    if (!backgrounds.unlock(id, this.data.bgUnlockHours)) {
      wx.showToast({ title: '背景状态保存失败，请清理存储空间', icon: 'none' })
      return
    }
    this.loadBackgrounds()
    this.setData({ bgOpen: false })
    wx.showToast({ title: '背景已解锁', icon: 'none' })
  },

  applyBackground(id) {
    const item = this.data.backgrounds.filter((bg) => bg.id === id)[0]
    if (!item) return

    const config = getConfig()
    const defaultItem = backgrounds.defaultOf(config)
    if (defaultItem && defaultItem.id === id) {
      // 选择默认图 = 结束当前付费图的使用；是否提示由 onBgSelect 负责
      if (!storage.setBackgroundUnlock(null)) {
        wx.showToast({ title: '背景状态保存失败，请稍后重试', icon: 'none' })
        return
      }
    }

    const localPath = backgrounds.localPathOf(item.url)
    this.setData({
      background: Object.assign({}, item, { localPath }),
      bgError: false,
      bgOpen: false
    })
    this.loadBackgrounds()

    backgrounds.cacheImage(item.url).then((path) => {
      if (path && this._alive && this.data.background && this.data.background.id === id) {
        this.setData({ 'background.localPath': path })
      }
    })
  },

  /* ---------------- 分享 ---------------- */

  onShareAppMessage() {
    // 只在结果面可见时使用结果文案；回到正面/改时间后不能再转发旧结果。
    const view = this.data.flipped ? this.data.view : null
    const time = view && view.mainTime && view.mainTime.indexOf(':') >= 0 ? view.mainTime : ''
    return {
      title: time
        ? '按 90 分钟周期，' + time + (this.data.mode === 'wake' ? ' 入睡刚刚好' : ' 起床刚好')
        : '今晚，几点睡？算算你的睡眠周期',
      path: '/pages/index/index?from=share'
    }
  },

  // 朋友圈打开是"单页模式"（无 tabBar、本地存储不可用），只开放纯计算的计算器页
  onShareTimeline() {
    return {
      title: '今晚，几点睡？算算你的睡眠周期',
      query: 'from=timeline'
    }
  }
})
