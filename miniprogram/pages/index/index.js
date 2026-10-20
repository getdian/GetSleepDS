const T = require('../../utils/time')
const F = require('../../utils/format')
const P = require('../../utils/plan')
const storage = require('../../utils/storage')
const adSlots = require('../../utils/ads')
const backgrounds = require('../../utils/backgrounds')
const ad = require('../../utils/ad')
const { getConfig, loadConfig, getConfigStatus } = require('../../utils/config')

const CLOCK_INTERVAL = 60 * 1000

Page({
  data: {
    ads: adSlots.empty(),
    mode: 'wake',
    wakeTime: '07:30',
    wakeContext: '',
    sleepTime: '23:00',
    fallAsleep: 15,
    fallOptions: [5, 10, 15, 20, 30],
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
    this._cfgLoaded = false
    this._sleepTouched = false
    this._bgExpiryNotified = false
    const now = Date.now()
    const prefs = storage.getPrefs()
    // 入睡默认跟随真实当前时间（时间轮支持 1 分钟粒度），不再固定白天 23:00
    const nowClock = F.fmtClock(T.minutesOf(now))
    const wakeTime = prefs.wakeTime || '07:30'
    this.setData({
      wakeTime,
      // 起床时间补一个“今天/明天”的上下文，避免 07:30 上午不知道指哪天
      wakeContext: this.wakeContextText(wakeTime, 15, now),
      sleepTime: nowClock,
      // 入睡耗时以 15 分为默认起点；旧版本存下的 5 分不再作为初值
      fallAsleep: 15,
      nowText: nowClock
    })

    this.loadBackgrounds()
    // onLoad 必须强制拉一次：后台刚改的背景图/广告位不能被 10 分钟缓存挡住
    loadConfig(true)
      .then(() => {
        this._cfgLoaded = true
        if (this._alive) this.loadBackgrounds()
      })
      .catch(() => {
        this._cfgLoaded = true
      })
  },

  onShow() {
    this._alive = true
    this.refreshNow()
    // 未手动调过入睡时间时，回到前台让默认值重新跟随当前时间
    if (this.data.mode === 'sleep' && !this._sleepTouched && !this.data.flipped) {
      this.setData({ sleepTime: F.fmtClock(T.minutesOf(Date.now())) })
    }
    this.startClock()
    adSlots.apply(this)
    // 从后台保存后切回小程序，onShow 立即刷新，而不是等 10 分钟
    loadConfig(true)
      .then(() => {
        this._cfgLoaded = true
        if (this._alive) this.loadBackgrounds()
      })
      .catch(() => {
        this._cfgLoaded = true
      })
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
    // 展示真实时分；5 分钟粒度只用于时间轮和“用现在的时间”落点
    this.setData({ nowText: F.fmtClock(T.minutesOf(Date.now())) })
    // 起床时间可能随当前时刻从“今天”翻到“明天”，随分钟刷新
    if (this.data.mode === 'wake') this.refreshWakeContext()
  },

  /** 起床选择的上下文：今天/明天 + 上午/下午 + 12h 时间 */
  wakeContextText(wakeValue, fallMinutes, now) {
    const wakeMinutes = typeof wakeValue === 'number' ? wakeValue : T.parseClock(wakeValue)
    const wakeAt = P.nextWakeAt(now, wakeMinutes, Number(fallMinutes) || 0)
    const period = wakeMinutes < 12 * 60 ? '上午' : '下午'
    const h12 = Math.floor(wakeMinutes / 60) % 12 || 12
    return (
      P.dayLabel(wakeAt, now) +
      ' ' +
      period +
      ' ' +
      T.pad2(h12) +
      ':' +
      T.pad2(wakeMinutes % 60) +
      ' 起床'
    )
  },

  refreshWakeContext(wakeValue, fallMinutes) {
    const value = wakeValue === undefined ? this.data.wakeTime : wakeValue
    const fall = fallMinutes === undefined ? this.data.fallAsleep : fallMinutes
    const text = this.wakeContextText(value, fall, Date.now())
    if (text !== this.data.wakeContext) this.setData({ wakeContext: text })
  },

  startClock() {
    this.stopClock()
    // 对齐到下一个整分再起 60s 定时器，避免分钟数最多迟到半分钟
    const delay = CLOCK_INTERVAL - (Date.now() % CLOCK_INTERVAL)
    this._clockAlign = setTimeout(() => {
      this._clockAlign = null
      if (!this._alive) return
      this.refreshNow()
      this._clockTimer = setInterval(() => {
        if (this._alive) this.refreshNow()
      }, CLOCK_INTERVAL)
    }, delay)
  },

  stopClock() {
    if (this._clockAlign) {
      clearTimeout(this._clockAlign)
      this._clockAlign = null
    }
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
    if (this.data.mode === 'sleep') this._sleepTouched = true

    const patch = { flipped: false, view: null }
    patch[key] = value
    this.setData(patch)

    // 只记住起床时间；入睡时间每次跟随当前时间，入睡耗时默认 15 分
    if (key === 'wakeTime') {
      this.savePrefs({ wakeTime: value })
      this.refreshWakeContext(T.parseClock(value), this.data.fallAsleep)
    }
  },

  toggleMode() {
    const next = this.data.mode === 'wake' ? 'sleep' : 'wake'
    const patch = { mode: next, flipped: false, view: null }
    // 从结果面反向切换时，用刚算出的推荐时间作为种子，保持双向计算连续；
    // 只有正面的普通切换才退回“跟随当前时间”。种子是一次明确的用户意图，不再被 onShow 覆盖。
    const view = this.data.view
    const seed =
      this.data.flipped && view && typeof view.mainTime === 'string' && view.mainTime.indexOf(':') >= 0
        ? view.mainTime
        : ''
    if (next === 'sleep') {
      if (seed) {
        patch.sleepTime = seed
        this._sleepTouched = true
      } else if (!this._sleepTouched) {
        const value = F.fmtClock(T.minutesOf(Date.now()))
        patch.sleepTime = value
        patch.nowText = value
      }
    }
    if (next === 'wake') {
      if (seed) patch.wakeTime = seed
      patch.wakeContext = this.wakeContextText(
        patch.wakeTime || this.data.wakeTime,
        this.data.fallAsleep,
        Date.now()
      )
    }
    this.setData(patch)
  },

  onNowTap() {
    const now = Date.now()
    const value = F.fmtClock(T.minutesOf(now))
    this._sleepTouched = true
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
    if (this.data.mode === 'wake') this.refreshWakeContext(this.data.wakeTime, minutes)
    if (this.data.flipped) this.calc(true)
  },

  /** 结果面也能调整入睡耗时并立即重算（PRD 3.4） */
  cycleFall() {
    const options = this.data.fallOptions
    const index = options.indexOf(this.data.fallAsleep)
    const minutes = options[(index + 1) % options.length]
    this.setData({ fallAsleep: minutes })
    if (this.data.mode === 'wake') this.refreshWakeContext(this.data.wakeTime, minutes)
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
          // 跨午夜时“今天/明天”不如“凌晨/晚上”直观
          day: F.periodLabel(slot.at),
          duration: F.fmtDuration(slot.durationMin),
          passed: slot.passed
        }))

      view = {
        label: main ? '推荐入睡时间' : '现在睡',
        mainTime: main ? F.fmtClockTs(main.at) : F.fmtDuration(plan.availableMin),
        mainDay: main ? F.periodLabel(main.at) : '',
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
        day: F.periodLabel(slot.at),
        duration: F.fmtDuration(slot.durationMin),
        passed: false
      }))

      view = {
        label: '推荐起床时间',
        mainTime: F.fmtClockTs(main.at),
        mainDay: F.periodLabel(main.at),
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
    // 付费背景到期是静默回退：这里给一次明确提示，否则用户会以为“背景被弄丢了”。
    const expiredRecently =
      unlocked &&
      Number(unlocked.expireAt) > 0 &&
      Number(unlocked.expireAt) <= now &&
      now - Number(unlocked.expireAt) < 6 * 60 * 60 * 1000
    if (expiredRecently && !this._bgExpiryNotified) {
      this._bgExpiryNotified = true
      wx.showToast({ title: '背景使用时长已到，已切回默认', icon: 'none' })
    }
    const items = list.map((item) => {
      const itemUnlocked = backgrounds.isUnlocked(unlocked, item.id, now)
      return {
        id: item.id,
        title: item.title,
        category: item.category,
        url: item.url,
        thumbUrl: item.thumbUrl,
        localPath: backgrounds.localPathOf(item.url),
        isDefault: !!defaultItem && item.id === defaultItem.id,
        unlocked: itemUnlocked,
        remainHours: itemUnlocked
          ? Math.max(1, Math.ceil((Number(unlocked.expireAt) - now) / 3600000))
          : 0
      }
    })

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
      // 首帧配置还在路上时不能断言“后台没有配置”，否则弱网下会给出错误结论。
      if (!this._cfgLoaded) {
        wx.showLoading({ title: '加载背景图', mask: true })
        loadConfig(true)
          .then(() => {
            this._cfgLoaded = true
            wx.hideLoading()
            if (this._alive) this.openBgPicker()
          })
          .catch(() => {
            this._cfgLoaded = true
            wx.hideLoading()
            if (this._alive) {
              wx.showToast({ title: '背景图加载失败，请稍后重试', icon: 'none' })
            }
          })
        return
      }
      // loadConfig 失败时也会返回兜底（backgrounds=[]），必须区分“确实为空”与“没拉到”。
      const status = getConfigStatus()
      if (status.failed) {
        wx.showModal({
          title: '背景图加载失败',
          content: '网络或服务暂时不可用，是否重试？',
          confirmText: '重试',
          cancelText: '稍后',
          success: (res) => {
            if (!res.confirm || !this._alive) return
            this._cfgLoaded = false
            this.openBgPicker()
          }
        })
        return
      }
      wx.showToast({ title: '暂时没有可用的背景图', icon: 'none' })
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
      // 广告已看完：不能因为一次本地写入失败就要求用户重看一遍视频。
      // 保留待发放标记并提供原地重试（同一天重写是幂等的）。
      this._pendingBgGrant = id
      wx.showModal({
        title: '解锁状态未保存',
        content: '本次观看已记录。可立即重试保存；若仍失败，请清理背景缓存后再试。',
        confirmText: '重试',
        cancelText: '稍后',
        success: (res) => {
          if (!res.confirm || !this._alive) return
          this.finishBackgroundUnlock(id)
        }
      })
      return
    }
    this._pendingBgGrant = ''
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
