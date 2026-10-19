const T = require('../../utils/time')
const F = require('../../utils/format')
const P = require('../../utils/plan')
const storage = require('../../utils/storage')
const adSlots = require('../../utils/ads')
const backgrounds = require('../../utils/backgrounds')
const ad = require('../../utils/ad')
const { getConfig, loadConfig } = require('../../utils/config')

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
    loadConfig(false)
      .then(() => {
        if (this._alive) this.loadBackgrounds()
      })
      .catch(() => {})
  },

  onShow() {
    this._alive = true
    this.setData({ nowText: F.fmtClock(Math.round(T.minutesOf(Date.now()) / 5) * 5) })
    adSlots.apply(this)
    loadConfig(false)
      .then(() => {
        if (this._alive) this.loadBackgrounds()
      })
      .catch(() => {})
    // 切走再回来时，已翻到结果面的推荐时间要重新判定“已过”
    if (this.data.flipped) this.calc(true)
  },

  onUnload() {
    this._alive = false
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

    const patch = { view: null, flipped: false }
    patch[key] = value
    this.setData(patch)

    const prefs = {}
    prefs[key] = value
    this.savePrefs(prefs)
  },

  toggleMode() {
    const next = this.data.mode === 'wake' ? 'sleep' : 'wake'
    this.setData({ mode: next, view: null, flipped: false })
  },

  onNowTap() {
    const now = Date.now()
    const value = F.fmtClock(Math.round(T.minutesOf(now) / 5) * 5)
    this.setData({
      sleepTime: value,
      nowText: value,
      mode: 'sleep',
      view: null,
      flipped: false
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

  onCalc() {
    this.calc(false)
  },

  calc(silent) {
    const now = Date.now()
    let view = null

    if (this.data.mode === 'wake') {
      const wakeMinutes = T.parseClock(this.data.wakeTime)
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
          : '距离 ' + this.data.wakeTime + ' 起床',
        note: main
          ? '已为入睡留出 ' + this.data.fallAsleep + ' 分钟'
          : '三个完整周期都已错过',
        allPassed: plan.allPassed,
        compact: !main,
        rows
      }
    } else {
      const sleepMinutes = T.parseClock(this.data.sleepTime)
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
        note: '从 ' + this.data.sleepTime + ' 上床算起，已含 ' + this.data.fallAsleep + ' 分钟入睡',
        allPassed: false,
        compact: false,
        rows
      }
    }

    this.setData({ view, flipped: true })
    if (!silent && wx.vibrateShort) wx.vibrateShort({ type: 'light' })
  },

  reset() {
    this.setData({ view: null, flipped: false })
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
    const items = list.map((item) => ({
      id: item.id,
      title: item.title,
      category: item.category,
      url: item.url,
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

    if (isDefault || backgrounds.isUnlocked(backgrounds.getUnlocked(), id, Date.now())) {
      this.applyBackground(id)
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
    backgrounds.unlock(id, this.data.bgUnlockHours)
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
      // 选择默认图 = 结束当前付费图的使用，之后再选付费图需要重新看广告
      storage.setBackgroundUnlock(null)
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
    const view = this.data.view
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
