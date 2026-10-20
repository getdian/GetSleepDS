/**
 * 跨页迷你播放器。
 * 声音入口仍然只在入睡页（audio-dock）；这里只在「已经播放过」时出现，
 * 让用户在计算器/统计页也能暂停、继续、停止，不必切回入睡页。
 * 只监听 play/pause/stop/error，不处理 ended（循环重播仍由 audio-dock 负责）。
 */
const storage = require('../../utils/storage')
const audioTimer = require('../../utils/audio-timer')
const playerState = require('../../utils/player-state')
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
    timerText: ''
  },

  lifetimes: {
    attached() {
      this._alive = true
      this._pageVisible = true
      this._audio = null
      this._lastToggleAt = 0
      this._enterTimer = null
      this._unsubTimer = null
      this._onPlay = () => this.sync(true)
      this._onPause = () => this.sync(true)
      this._onStop = () => this.handleStop()
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
      this._audio.onError(this._onError)
    },

    off() {
      if (!this._audio) return
      try {
        this._audio.offPlay(this._onPlay)
        this._audio.offPause(this._onPause)
        this._audio.offStop(this._onStop)
        if (this._audio.offError) this._audio.offError(this._onError)
      } catch (e) {}
      this._audio = null
    },

    timerEnabled() {
      const cfg = getConfig()
      return !cfg.features || cfg.features.timer !== false
    },

    /** 以 meta + 后台音频状态为准同步展示；任何事件都走这里，避免多实例口径漂移 */
    sync(force) {
      if (!this._alive) return
      const meta = storage.getMeta()
      const audio = this._audio
      const hasSrc = !!(audio && audio.src)
      const active = !!meta.lastTrackId && meta.lastTrackActive !== false

      if (!active || !hasSrc) {
        this.collapse()
        this.syncTimer(true)
        return
      }

      const playing = !audio.paused
      const title = meta.lastTrackTitle || '环境音'
      const category = meta.lastTrackCategory || ''

      if (!this.data.visible) {
        // 先落地隐藏态，再在下一帧加 is-in，跨页首次出现也能走同一段入场动效
        this.setData({ playing, title, category, visible: false }, () => {
          if (!this._alive) return
          if (this._enterTimer) clearTimeout(this._enterTimer)
          this._enterTimer = setTimeout(() => {
            this._enterTimer = null
            if (!this._alive) return
            // 入场延迟期间恰好停止播放时不要再弹出来
            const latest = storage.getMeta()
            if (latest.lastTrackActive === false || !this._audio || !this._audio.src) return
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
        category === this.data.category
      ) {
        return
      }
      this.setData({ playing, title, category })
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
      // 即使还没真正展示，也要取消待执行的入场，避免“已停止后又弹出来”
      if (this._enterTimer) {
        clearTimeout(this._enterTimer)
        this._enterTimer = null
      }
      if (!this.data.visible) return
      // 只摘掉 is-in，由 WXSS 完成折叠；元素常驻但不可点，避免 wx:if 硬切
      this.setData({ visible: false })
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
        storage.patchMeta({ lastTrackActive: false })
        this.setData({ playing: false })
        this.collapse()
        if (this._pageVisible) wx.showToast({ title: '音频加载失败，请重新播放', icon: 'none' })
      }, 300)
    },

    toggle() {
      const audio = this._audio
      if (!audio || !audio.src) return
      const now = Date.now()
      if (now - this._lastToggleAt < TOGGLE_GUARD_MS) return
      this._lastToggleAt = now

      const next = !!audio.paused
      // 先反馈再调底层：不等 onPlay/onPause 事件，图标与状态行立即切换
      this.setData({ playing: next })
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
        if (this._pageVisible) wx.showToast({ title: '操作失败，请重试', icon: 'none' })
      }
      // 定时状态此时才落定（暂停/续时都会改文案），最后统一刷新一次
      this.syncTimer()
    },

    close() {
      // 关闭播放条是“停止本次会话”，不是“把下次定时偏好归零”。
      audioTimer.clear(undefined, true)
      storage.patchMeta({ lastTrackActive: false })
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
