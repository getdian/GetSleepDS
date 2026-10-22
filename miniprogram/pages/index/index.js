const T = require('../../utils/time')
const F = require('../../utils/format')
const P = require('../../utils/plan')
const G = require('../../utils/sleep-guide')
const storage = require('../../utils/storage')
const adSlots = require('../../utils/ads')
const backgrounds = require('../../utils/backgrounds')
const tabbar = require('../../utils/tabbar')
const ad = require('../../utils/ad')
const { getConfig, loadConfig, getConfigStatus } = require('../../utils/config')

const CLOCK_INTERVAL = 60 * 1000
const DEFAULT_FALL = 15
const CLOCK_RE = /^([01]\d|2[0-3]):[0-5]\d$/

Page({
  data: {
    ads: adSlots.empty(),
    mode: 'wake',
    wakeTime: '07:30',
    wakeContext: '',
    sleepTime: '23:00',
    fallAsleep: DEFAULT_FALL,
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
    // 结果面的计算锚点：同一次结果内的重算（改入睡耗时以外的重算、切后台回来）
    // 必须沿用同一个“现在”，否则入睡模式会因 30 分钟宽限把推荐静默推后一天。
    this._anchorAt = 0
    const now = Date.now()
    const prefs = storage.getPrefs()
    // 入睡默认跟随真实当前时间（时间轮支持 1 分钟粒度），不再固定白天 23:00
    const nowClock = F.fmtClock(T.minutesOf(now))
    // 本地偏好可能被写脏（如 99:99），非法时回退默认值，避免算出四天后的日期
    const wakeTime = CLOCK_RE.test(prefs.wakeTime || '') ? prefs.wakeTime : '07:30'
    this.setData({
      wakeTime,
      // 起床时间补一个“今天/明天”的上下文，避免 07:30 上午不知道指哪天
      wakeContext: this.wakeContextText(wakeTime, DEFAULT_FALL, now),
      sleepTime: nowClock,
      // 入睡耗时以 15 分为默认起点；旧版本存下的 5 分不再作为初值
      fallAsleep: DEFAULT_FALL,
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
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) tabBar.setData({ selected: 0 })
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
    // 结果面：可用时长与"已错过的档位"必须随分钟重算，否则停在结果页 10 分钟数字不动
    if (this.data.flipped) this.calc(true)
  },

  /** 起床选择的上下文：今天/明天 + 时段词 + 24h 时间（与结果面一致） */
  wakeContextText(wakeValue, fallMinutes, now) {
    const wakeMinutes = typeof wakeValue === 'number' ? wakeValue : T.parseClock(wakeValue)
    return P.wakeContextText(now, wakeMinutes, Number(fallMinutes) || 0)
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
    // 输入变了：下一次计算重新取“现在”
    this._anchorAt = 0

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
    this._anchorAt = 0
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
    this._anchorAt = 0
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
    // 只改“入睡耗时”不换计算锚点：锚点代表这一次计算会话的“现在”，
    // 清零会让结果面停留跨过 30 分钟宽限后，整组推荐静默推后一天。
    this.setData({ fallAsleep: minutes })
    if (this.data.mode === 'wake') this.refreshWakeContext(this.data.wakeTime, minutes)
    if (this.data.flipped) this.calc(true)
  },

  /** 结果面也能调整入睡耗时并立即重算（PRD 3.4） */
  cycleFall() {
    const options = this.data.fallOptions
    const index = options.indexOf(this.data.fallAsleep)
    const minutes = options[(index + 1) % options.length]
    // 同上：改耗时不是一次新的计算时刻，锚点必须沿用。
    this.setData({ fallAsleep: minutes })
    if (this.data.mode === 'wake') this.refreshWakeContext(this.data.wakeTime, minutes)
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
    if (this.data.flipped) this.calc(true)
  },

  onCalc() {
    // 点主按钮 = 明确的一次计算：以此刻为锚点，结果面的后续重算沿用这个锚点
    this._anchorAt = Date.now()
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
    // 锚点固定后，切后台回来/在结果面改入睡耗时都不会让 recommended 时间整体漂移一天
    const now = this._anchorAt || Date.now()
    const value =
      explicitValue || (this.data.mode === 'wake' ? this.data.wakeTime : this.data.sleepTime)
    let view = null

    if (this.data.mode === 'wake') {
      const wakeMinutes = T.parseClock(value)
      const plan = P.bedtimesForWake(now, wakeMinutes, this.data.fallAsleep, Date.now())
      const main = plan.slots.filter((slot) => !slot.passed)[0] || null
      const mainGuide = main ? G.guidanceOf(main.cycles) : null
      const mainLate = main ? G.isLateNight(main.at) : false

      let note = '三个完整周期都已错过'
      if (main) {
        if (mainGuide.tone === 'long') {
          // 时长超过建议上限时“提前上床”反而更糟，直接陈述事实
          note = mainGuide.note
        } else if (mainGuide.tone !== 'ok' && mainLate) {
          note =
            (mainGuide.tone === 'low' ? '时长不足' : '时长偏短') +
            '且入睡较晚；成人常见睡眠时长为 7–9 小时'
        } else if (mainGuide.tone !== 'ok') {
          note = mainGuide.note
        } else if (mainLate) {
          note = G.lateNote()
        } else {
          note = '已为入睡留出 ' + this.data.fallAsleep + ' 分钟'
        }
      }

      const rows = plan.slots
        .filter((slot) => !main || slot.cycles !== main.cycles)
        .map((slot) => {
          const guide = G.guidanceOf(slot.cycles)
          return {
            cycles: slot.cycles,
            time: F.fmtClockTs(slot.at),
            // 跨午夜时“今天/明天”不如“凌晨/晚上”直观
            day: F.periodLabel(slot.at),
            duration: F.fmtDuration(slot.durationMin),
            guideLabel: guide.label,
            guideTone: guide.tone,
            passed: slot.passed
          }
        })

      view = {
        label: main ? '推荐入睡时间' : '现在睡',
        mainTime: main ? F.fmtClockTs(main.at) : F.fmtDuration(plan.availableMin),
        // 跨天后必须写“明天 早晨”：只给时段词会让用户把次日时间读成今天。
        mainDay: main ? this.dayLabelPrefix(main.at, now) + F.periodLabel(main.at) : '',
        mainMeta: main
          ? main.cycles + ' 个周期 · ' + F.fmtDuration(main.durationMin)
          : '距离 ' + value + ' 起床',
        mainGuideLabel: mainGuide ? mainGuide.label : '',
        mainGuideTone: mainGuide ? mainGuide.tone : '',
        note,
        compact: !main,
        rows
      }
    } else {
      const sleepMinutes = T.parseClock(value)
      const plan = P.wakeTimesForSleep(now, sleepMinutes, this.data.fallAsleep)
      const main = plan.slots[0]
      const mainGuide = G.guidanceOf(main.cycles)
      const late = G.isLateNight(plan.sleepAt)
      // 结果面主时间只用「凌晨/早晨」这类时段词，不含日期；
      // 入睡时间已过 30 分钟宽限时会按次日算，这里必须把「明天」写出来，否则用户看不到日期已经变了。
      const sleepDay = P.dayLabel(plan.sleepAt, now)

      const rows = plan.slots.slice(1).map((slot) => {
        const guide = G.guidanceOf(slot.cycles)
        return {
          cycles: slot.cycles,
          time: F.fmtClockTs(slot.at),
          day: F.periodLabel(slot.at),
          duration: F.fmtDuration(slot.durationMin),
          guideLabel: guide.label,
          guideTone: guide.tone,
          passed: false
        }
      })

      view = {
        label: '推荐起床时间',
        mainTime: F.fmtClockTs(main.at),
        mainDay: this.dayLabelPrefix(main.at, now) + F.periodLabel(main.at),
        mainMeta: main.cycles + ' 个周期 · ' + F.fmtDuration(main.durationMin),
        mainGuideLabel: mainGuide.label,
        mainGuideTone: mainGuide.tone,
        // late 分支只讲后半夜质量，日期前缀仍要保留：凌晨 2 点选 1 点入睡时，
        // 入睡时刻已被宽限推到明天，吞掉日期会让整组推荐看起来像“今天”。
        note: late
          ? (sleepDay === '今天' ? '' : sleepDay + ' ' + value + ' 上床；') + G.lateNote()
          : (sleepDay === '今天' ? '从 ' + value + ' 上床算起，已含 ' : sleepDay + ' ' + value + ' 上床，已含 ') +
            this.data.fallAsleep +
            ' 分钟入睡',
        compact: false,
        rows
      }
    }

    this.setData({ view, flipped: true })
    if (!silent && wx.vibrateShort) wx.vibrateShort({ type: 'light' })
  },

  /** 非“今天”时给时段词加日期前缀（“明天 早晨”）；今天不加，避免首屏噪音 */
  dayLabelPrefix(timestamp, now) {
    const label = P.dayLabel(timestamp, now)
    return label && label !== '今天' ? label + ' ' : ''
  },

  reset() {
    // 回到正面后下次计算重新取“现在”
    this._anchorAt = 0
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
    tabbar.hide()
    this.setData({ bgOpen: true })
  },

  closeBgPicker() {
    tabbar.show()
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
    const activeValid =
      !!activeUnlock && backgrounds.isUnlocked(activeUnlock, activeUnlock.id, now)
    // 已有一张付费背景处于有效期内，切到任何别的背景（包括另一张付费图）都会覆盖掉
    // 这条解锁记录——必须提前告知，否则剩余时长会被静默作废。
    const switchingFromPaid = activeValid && activeUnlock.id !== id

    const proceed = () => {
      if (isDefault) {
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
    }

    if (switchingFromPaid) {
      const leftHours = Math.max(1, Math.ceil((activeUnlock.expireAt - now) / 3600000))
      wx.showModal({
        title: isDefault ? '切换到默认背景？' : '切换背景？',
        content:
          '当前付费背景还剩约 ' + leftHours + ' 小时。切换后会结束本次解锁，再使用需重新' +
          (freeMode ? '选择' : '观看视频') +
          '。',
        confirmText: '切换',
        cancelText: '保留',
        success: (res) => {
          if (res.confirm) proceed()
        }
      })
      return
    }

    proceed()
  },

  showBackgroundAd(id) {
    // 双保险：onBgSelect 已判 bgBusy，但广告回调/其他入口仍可能重入
    if (this.data.bgBusy) return
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

      if (result === 'busy') {
        // 另一路广告正在播放：不放弃本次解锁，也不白送
        wx.showToast({ title: '广告正在播放，请稍后再试', icon: 'none' })
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
    tabbar.show()
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
    tabbar.show()
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
