const T = require('../../utils/time')
const F = require('../../utils/format')
const P = require('../../utils/plan')
const storage = require('../../utils/storage')

Page({
  data: {
    mode: 'wake',
    wakeTime: '07:30',
    sleepTime: '23:00',
    fallAsleep: 15,
    fallOptions: [5, 10, 15, 20],
    wakeView: null,
    sleepView: null,
    wakeFlipped: false,
    sleepFlipped: false,
    nowText: ''
  },

  onLoad() {
    this._alive = true
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
  },

  onShow() {
    this._alive = true
    const now = Date.now()
    this.setData({ nowText: F.fmtClock(Math.round(T.minutesOf(now) / 5) * 5) })
  },

  onUnload() {
    this._alive = false
  },

  savePrefs(patch) {
    storage.setPrefs(patch)
  },

  onWakeChange(event) {
    const value = event.detail.value
    if (!value || value === this.data.wakeTime) return
    this.setData({ wakeTime: value, wakeView: null, wakeFlipped: false })
    this.savePrefs({ wakeTime: value })
  },

  onSleepChange(event) {
    const value = event.detail.value
    if (!value || value === this.data.sleepTime) return
    this.setData({ sleepTime: value, sleepView: null, sleepFlipped: false })
    this.savePrefs({ sleepTime: value })
  },

  onNowTap() {
    const now = Date.now()
    const minutes = Math.round(T.minutesOf(now) / 5) * 5
    const value = F.fmtClock(minutes)
    this.setData({
      sleepTime: value,
      nowText: value,
      sleepView: null,
      sleepFlipped: false,
      mode: 'sleep'
    })
    this.savePrefs({ sleepTime: value })
  },

  onFallAsleepTap(event) {
    const minutes = Number(event.currentTarget.dataset.min)
    if (!minutes || minutes === this.data.fallAsleep) return
    this.setData({ fallAsleep: minutes })
    this.savePrefs({ fallAsleep: minutes })
    if (this.data.wakeFlipped) this.calcWake()
    if (this.data.sleepFlipped) this.calcSleep()
  },

  toggleMode(event) {
    const mode = event.currentTarget.dataset.mode
    if (!mode) return
    const next = this.data.mode === mode ? '' : mode
    this.setData({
      mode: next,
      wakeFlipped: next === 'wake' ? this.data.wakeFlipped : false,
      sleepFlipped: next === 'sleep' ? this.data.sleepFlipped : false
    })
  },

  calcWake() {
    const now = Date.now()
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

    const view = {
      label: main ? '推荐入睡' : '现在睡',
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

    this.setData({ wakeView: view, wakeFlipped: true })
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
  },

  calcSleep() {
    const now = Date.now()
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

    this.setData({
      sleepView: {
        label: '预计起床',
        mainTime: F.fmtClockTs(main.at),
        mainDay: main.dayLabel,
        mainMeta: main.cycles + ' 个周期 · ' + F.fmtDuration(main.durationMin),
        note: '从 ' + this.data.sleepTime + ' 上床算起，已含 ' + this.data.fallAsleep + ' 分钟入睡',
        allPassed: false,
        compact: false,
        rows
      },
      sleepFlipped: true
    })
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
  },

  resetWake() {
    this.setData({ wakeView: null, wakeFlipped: false })
  },

  resetSleep() {
    this.setData({ sleepView: null, sleepFlipped: false })
  }
})
