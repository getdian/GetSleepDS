/**
 * 跨页迷你播放器。
 * 声音入口仍然只在入睡页（audio-dock）；这里只在「已经播放过」时出现，
 * 让用户在计算器/统计页也能暂停、继续、停止，不必切回入睡页。
 * 只监听 play/pause/stop/error，不处理 ended（循环重播仍由 audio-dock 负责）。
 */
const storage = require('../../utils/storage')
const audioTimer = require('../../utils/audio-timer')
const playerState = require('../../utils/player-state')
const cache = require('../../utils/audio-cache')
const { getConfig } = require('../../utils/config')

const TOGGLE_GUARD_MS = 220
const EXPIRY_TOAST_WINDOW_MS = 2000
let lastExpiryToastAt = 0

Component({
  data: {
    // visible 同时驱动入场/折叠动效：先渲染隐藏态，下一帧再加 is-in
    visible: false,
    playing: false,
    title: '',
    category: '',
    timerText: '',
    // 播放中默认收成右侧绿色音符；点开才展开播放条
    miniExpanded: false,
    // 手动折叠后即使暂停也保持音符形态；播放/展开时复位
    collapsed: false,
    // 折叠中：保留播放条播放“向右收缩”动画，动画结束后再切音符
    collapsing: false
  },

  lifetimes: {
    attached() {
      this._alive = true
      this._pageVisible = true
      this._audio = null
      this._lastToggleAt = 0
      this._enterTimer = null
      this._collapseTimer = null
      this._unsubTimer = null
      this._onPlay = () => this.handlePlay()
      this._onPause = () => this.handlePause()
      this._onStop = () => this.handleStop()
      this._onEnded = () => this.handleEnded()
      this._onError = () => this.handleError()
      this.setup()
      this.sync(false)
      this._unsubTimer = audioTimer.subscribe(() => {
        if (!this._alive) return
        this.syncTimer()
      })
    },
    detached() {
      this._alive = false
      if (this._enterTimer) {
        clearTimeout(this._enterTimer)
        this._enterTimer = null
      }
      if (this._collapseTimer) {
        clearTimeout(this._collapseTimer)
        this._collapseTimer = null
      }
      if (this._unsubTimer) {
        this._unsubTimer()
        this._unsubTimer = null
      }
      this.off()
    }
  },

  pageLifetimes: {
    show() {
      this._pageVisible = true
      this.setup()
      this.sync(false)
    },
    hide() {
      this._pageVisible = false
    }
  },

  methods: {
    setup() {
      if (this._audio || !wx.getBackgroundAudioManager) return
      try {
        this._audio = wx.getBackgroundAudioManager()
      } catch (e) {
        this._audio = null
      }
      if (!this._audio) return
      this._audio.onPlay(this._onPlay)
      this._audio.onPause(this._onPause)
      this._audio.onStop(this._onStop)
      this._audio.onEnded(this._onEnded)
      this._audio.onError(this._onError)
    },

    off() {
      if (!this._audio) return
      try {
        this._audio.offPlay(this._onPlay)
        this._audio.offPause(this._onPause)
        this._audio.offStop(this._onStop)
        if (this._audio.offEnded) this._audio.offEnded(this._onEnded)
        if (this._audio.offError) this._audio.offError(this._onError)
      } catch (e) {}
      this._audio = null
    },

    timerEnabled() {
      const cfg = getConfig()
      return !cfg.features || cfg.features.timer !== false
    },

    handlePlay() {
      if (!this._alive) return
      const app = getApp()
      if (app && app.globalData) app.globalData.audioSession = true
      storage.patchMeta({ lastTrackPlaying: true })
      this.sync(true)
      // 系统侧暂停已冻结倒计时；恢复播放时续剩余，没有运行中的倒计时才按偏好起表。
      if (this.timerEnabled()) {
        audioTimer.arm(Number(storage.getMeta().audioTimerMinutes) || 0)
      }
    },

    handlePause() {
      if (!this._alive) return
      // 与 audio-dock 同口径：通知栏/锁屏/耳机暂停也必须冻结倒计时。
      audioTimer.pause()
      storage.patchMeta({ lastTrackPlaying: false })
      this.sync(true)
    },

    /** 按 meta.lastTrackId 从配置重建播放源：部分基础库在系统 stop 后会清空 src。 */
    rebuildSource() {
      const meta = storage.getMeta()
      if (!meta.lastTrackId || !this._audio) return false
      const cfg = getConfig()
      const track = (cfg.audio || []).filter((item) => item.id === meta.lastTrackId)[0]
      if (!track || !track.url) return false
      const cached = cache.peek(track.url, (cfg.cache && cfg.cache.ttlDays) || 7)
      this._audio.title = '睡点 · ' + track.title
      this._audio.epname = '环境音'
      this._audio.singer = '睡点'
      this._audio.src = cached || track.url
      storage.patchMeta({ lastTrackActive: true, lastTrackPlaying: true })
      return true
    },

    handleEnded() {
      if (!this._alive) return
      // audio-dock 只挂在入睡页；在首页/统计页自然播完时由这里接管循环与终止态，
      // 否则迷你条会停在“正在播放”再遇到 toggle 的静默 return。
      audioTimer.restore()
      const expiredAt = audioTimer.lastExpiredAt()
      const justExpired = expiredAt && Date.now() - expiredAt < EXPIRY_TOAST_WINDOW_MS
      if (audioTimer.shouldStop() || justExpired || !this.rebuildSource()) {
        storage.patchMeta({ lastTrackActive: false, lastTrackPlaying: false })
        const app = getApp()
        if (app && app.globalData) app.globalData.audioSession = false
        this.collapse()
        return
      }
      try {
        this._audio.play()
      } catch (e) {
        storage.patchMeta({ lastTrackActive: false, lastTrackPlaying: false })
        this.collapse()
      }
    },

    /** 以 meta + 后台音频状态为准同步展示；任何事件都走这里，避免多实例口径漂移 */
    sync(force) {
      if (!this._alive) return
      const meta = storage.getMeta()
      const audio = this._audio
      const hasSrc = !!(audio && audio.src)
      const active = !!meta.lastTrackId && meta.lastTrackActive !== false

      // 跨页时个别基础库会短暂清空 src；只要本次启动创建过音频会话就保留入口，
      // 播放状态用最后一次 play/pause 事件兜底，避免“明明在播却什么都不显示”。
      const app = getApp()
      const session = !!(app && app.globalData && app.globalData.audioSession)
      if (!active || (!hasSrc && !session)) {
        this.collapse()
        this.syncTimer(true)
        return
      }

      const playing = hasSrc ? !audio.paused : meta.lastTrackPlaying !== false
      const title = meta.lastTrackTitle || '环境音'
      const category = meta.lastTrackCategory || ''
      // 播放中保留用户手动展开的状态，避免 play/pause 事件把条瞬间收回
      const miniExpanded = playing ? this.data.miniExpanded : true

      if (!this.data.visible) {
        // 先落地隐藏态，再在下一帧加 is-in，跨页首次出现也能走同一段入场动效
        this.setData({ playing, title, category, miniExpanded, visible: false }, () => {
          if (!this._alive) return
          if (this._enterTimer) clearTimeout(this._enterTimer)
          this._enterTimer = setTimeout(() => {
            this._enterTimer = null
            if (!this._alive) return
            // 入场延迟期间恰好停止播放时不要再弹出来
            const latest = storage.getMeta()
            if (latest.lastTrackActive === false || !this._audio) return
            this.setData({ visible: true })
          }, 32)
        })
        this.syncTimer(true)
        return
      }

      this.syncTimer()
      if (
        !force &&
        playing === this.data.playing &&
        title === this.data.title &&
        category === this.data.category &&
        miniExpanded === this.data.miniExpanded
      ) {
        return
      }
      this.setData({ playing, title, category, miniExpanded })
    },

    expandMini() {
      this.clearCollapseTimer()
      this.setData({ miniExpanded: true, collapsed: false, collapsing: false })
    },

    clearCollapseTimer() {
      if (this._collapseTimer) {
        clearTimeout(this._collapseTimer)
        this._collapseTimer = null
      }
    },

    /** 点击播放条外部：向右收缩回音符，不停止播放 */
    collapseMini() {
      if (this.data.collapsed || this.data.collapsing) return
      this.clearCollapseTimer()
      this.setData({ collapsing: true })
      this._collapseTimer = setTimeout(() => {
        this._collapseTimer = null
        if (!this._alive) return
        this.setData({ collapsing: false, miniExpanded: false, collapsed: true })
      }, 210)
    },

    /** 点击播放条：切到入睡页并打开环境声音抽屉 */
    openAudio() {
      const app = getApp()
      if (app && app.globalData) app.globalData.openAudioSheet = true
      wx.switchTab({
        url: '/pages/sleep/sleep',
        fail: () => {
          if (app && app.globalData) app.globalData.openAudioSheet = false
        }
      })
    },

    syncTimer(force) {
      if (!this._alive) return
      // 隐藏页/折叠态不必每秒算文案；重新展开/回到前台时会补一次
      if (!force && (!this.data.visible || !this._pageVisible)) return
      const left = audioTimer.remaining()
      let text = ''
      if (left > 0) {
        const mins = Math.max(1, Math.ceil(left / 60000))
        text = audioTimer.isPaused() ? '定时剩 ' + mins + ' 分钟' : mins + ' 分钟后关闭'
      }
      if (text !== this.data.timerText) this.setData({ timerText: text })
    },

    collapse() {
      // 即使还没真正展示，也要取消待执行的入场/折叠，避免“已停止后又弹出来”
      if (this._enterTimer) {
        clearTimeout(this._enterTimer)
        this._enterTimer = null
      }
      this.clearCollapseTimer()
      if (!this.data.visible) return
      // 只摘掉 is-in，由 WXSS 完成折叠；元素常驻但不可点，避免 wx:if 硬切
      this.setData({ visible: false, collapsing: false })
    },

    handleStop() {
      if (!this._alive) return
      const expiredAt = audioTimer.lastExpiredAt()
      if (
        expiredAt &&
        Date.now() - expiredAt < EXPIRY_TOAST_WINDOW_MS &&
        this._pageVisible &&
        Date.now() - lastExpiryToastAt > EXPIRY_TOAST_WINDOW_MS
      ) {
        lastExpiryToastAt = Date.now()
        wx.showToast({ title: '定时结束，已停止播放', icon: 'none' })
      }
      this.sync(true)
    },

    handleError() {
      if (!this._alive) return
      const audio = this._audio
      // 本地缓存源损坏时，dock 不在场（首页/统计页）也要自行回退远程一次；
      // 否则重建源会反复命中同一个坏文件，用户点一次播放就失败一次。
      if (audio && audio.src && audio.src.indexOf('https://') !== 0) {
        const meta = storage.getMeta()
        const cfg = getConfig()
        const track = (cfg.audio || []).filter((item) => item.id === meta.lastTrackId)[0]
        if (track && track.url) {
          playerState.markFallback(track.url)
          cache.remove(track.url)
          storage.patchMeta({ lastTrackActive: true, lastTrackPlaying: true })
          audio.src = track.url
          return
        }
      }
      // 两个组件监听同一个全局播放器，事件顺序不保证。
      // 等一个极短窗口，让 audio-dock（播放会话的 owner）先决定：
      // - 缓存失败回退：它会把 lastTrackActive 保持 true 并重设 src；
      // - 终态失败：它会把 lastTrackActive 置 false。
      setTimeout(() => {
        if (!this._alive) return
        const meta = storage.getMeta()
        if (playerState.isFallbacking()) {
          this.sync(true)
          return
        }
        if (meta.lastTrackActive === false) {
          const app = getApp()
          if (app && app.globalData) app.globalData.audioSession = false
          this.setData({ playing: false })
          this.collapse()
          if (this._pageVisible) wx.showToast({ title: '音频加载失败，请重新播放', icon: 'none' })
          return
        }
        const audio = this._audio
        if (audio && audio.src && !audio.paused) {
          this.sync(true)
          return
        }
        // audio-dock 不在场（例如冷启动直接落到首页）时由这里兜底收口。
        playerState.clearFallback()
        audioTimer.clear(undefined, true)
        storage.patchMeta({ lastTrackActive: false, lastTrackPlaying: false })
        const app = getApp()
        if (app && app.globalData) app.globalData.audioSession = false
        this.setData({ playing: false })
        this.collapse()
        if (this._pageVisible) wx.showToast({ title: '音频加载失败，请重新播放', icon: 'none' })
      }, 300)
    },

    toggle() {
      const audio = this._audio
      if (!audio) return
      const app = getApp()
      if (app && app.globalData) app.globalData.audioSession = true
      const now = Date.now()
      if (now - this._lastToggleAt < TOGGLE_GUARD_MS) return
      this._lastToggleAt = now

      if (!audio.src) {
        // 系统侧 stop 会清空 src：此前这里静默 return，用户点播放毫无反应。
        if (!this.rebuildSource()) {
          wx.showToast({ title: '音频已结束，请重新播放', icon: 'none' })
          return
        }
        this.sync(true)
      }

      const next = !!audio.paused
      // 先反馈再调底层：播放中收回音符，暂停时展开播放条
      this.clearCollapseTimer()
      this.setData({ playing: next, miniExpanded: !next, collapsed: false, collapsing: false })
      storage.patchMeta({ lastTrackPlaying: next })
      try {
        if (next) {
          // 与入睡页 dock 一致：暂停中续剩余，没有运行中的倒计时才按偏好重新起表
          if (this.timerEnabled()) {
            audioTimer.arm(Number(storage.getMeta().audioTimerMinutes) || 0)
          }
          audio.play()
        } else {
          audio.pause()
          audioTimer.pause()
        }
      } catch (e) {
        this.setData({ playing: !next })
        storage.patchMeta({ lastTrackPlaying: !next })
        if (this._pageVisible) wx.showToast({ title: '操作失败，请重试', icon: 'none' })
      }
      // 定时状态此时才落定（暂停/续时都会改文案），最后统一刷新一次
      this.syncTimer()
    },

    close() {
      // 关闭播放条是“停止本次会话”，不是“把下次定时偏好归零”。
      audioTimer.clear(undefined, true)
      storage.patchMeta({ lastTrackActive: false, lastTrackPlaying: false })
      const app = getApp()
      if (app && app.globalData) app.globalData.audioSession = false
      this.collapse()
      if (this._audio) {
        try {
          this._audio.stop()
        } catch (e) {}
      }
    },

    goSleep() {
      wx.switchTab({ url: '/pages/sleep/sleep' })
    }
  }
})
