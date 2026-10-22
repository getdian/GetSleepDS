/**
 * 跨页迷你播放器。
 * 声音入口仍然只在入睡页（audio-dock）；这里只在「已经播放过」时出现，
 * 让用户在计算器/统计页也能暂停、继续、停止，不必切回入睡页。
 * 监听 play/pause/stop/error，并作为 ended 的“第二处理人”：audio-dock 只在入睡页常驻，
 * 但两个组件可能同时收到同一个 ended，因此用 playerState.claimEnded() 去重，
 * 保证每轮循环只有一个组件重建音源并重播。
 */
const storage = require('../../utils/storage')
const audioTimer = require('../../utils/audio-timer')
const playerState = require('../../utils/player-state')
const cache = require('../../utils/audio-cache')
const events = require('../../utils/events')
const { getConfig } = require('../../utils/config')

const TOGGLE_GUARD_MS = 220
const EXPIRY_TOAST_WINDOW_MS = 2000

Component({
  data: {
    // visible 同时驱动入场/折叠动效：先渲染隐藏态，下一帧再加 is-in
    visible: false,
    playing: false,
    loading: false,
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
      // 等 pageLifetimes.show 再置 true，避免首帧就弹到别的页面上
      this._pageVisible = false
      this._audio = null
      // 最后一次赋给 BackgroundAudioManager 的 src；onError 不带源标识，
      // 用它判断“这条错误是不是已经切走的旧源迟到的”。
      this._expectSrc = ''
      this._lastToggleAt = 0
      this._enterTimer = null
      this._collapseTimer = null
      this._loadingTimer = null
      this._unsubTimer = null
      this._onPlay = () => this.handlePlay()
      this._onPause = () => this.handlePause()
      this._onStop = () => this.handleStop()
      this._onEnded = () => this.handleEnded()
      this._onError = (err) => this.handleError(err)
      this._onCanplay = () => this.handleCanPlay()
      this._onTimeUpdate = () => this.handleTimeUpdate()
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
      this.disarmLoadingGuard()
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
      // 切回页面时按墙钟校准定时；到点会立即停止并折叠
      audioTimer.restore()
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
      if (this._audio.onCanplay) this._audio.onCanplay(this._onCanplay)
      if (this._audio.onTimeUpdate) this._audio.onTimeUpdate(this._onTimeUpdate)
    },

    off() {
      if (!this._audio) return
      try {
        this._audio.offPlay(this._onPlay)
        this._audio.offPause(this._onPause)
        this._audio.offStop(this._onStop)
        if (this._audio.offEnded) this._audio.offEnded(this._onEnded)
        if (this._audio.offError) this._audio.offError(this._onError)
        if (this._audio.offCanplay) this._audio.offCanplay(this._onCanplay)
        if (this._audio.offTimeUpdate) this._audio.offTimeUpdate(this._onTimeUpdate)
      } catch (e) {}
      this._audio = null
    },

    timerEnabled() {
      const cfg = getConfig()
      return !cfg.features || cfg.features.timer !== false
    },

    applyTimerPreference(minutes) {
      if (!this.timerEnabled()) return
      const value = Number(minutes) || 0
      if (value > 0) audioTimer.arm(value)
      else audioTimer.clear()
    },

    armLoadingGuard() {
      this.disarmLoadingGuard()
      this._loadingTimer = setTimeout(() => {
        this._loadingTimer = null
        if (!this._alive || !this.data.loading) return
        const audio = this._audio
        const playing = !!(audio && audio.src && !audio.paused)
        this.setData({ loading: false, playing })
        if (!playing && this._pageVisible) {
          wx.showToast({ title: '音频加载超时，请重试', icon: 'none' })
        }
      }, 12000)
    },

    disarmLoadingGuard() {
      if (this._loadingTimer) {
        clearTimeout(this._loadingTimer)
        this._loadingTimer = null
      }
    },

    isUnlocked() {
      const app = getApp()
      if (app && app.globalData && app.globalData.audioUnlockedSession) return true
      return storage.getUnlockExpire() > Date.now()
    },

    isFreeMode() {
      const unlock = getConfig().unlock || {}
      return unlock.mode !== 'rewarded' || !unlock.adUnitId
    },

    canPlay() {
      return this.isUnlocked() || this.isFreeMode()
    },

    rejectLocked() {
      if (this._pageVisible) {
        wx.showToast({ title: '解锁已到期，请到入睡页重新解锁', icon: 'none' })
      }
    },

    handlePlay() {
      if (!this._alive) return
      // 系统侧恢复/锁屏播放也要过权益校验，避免到期后靠通知栏续播。
      if (!this.canPlay()) {
        try {
          this._audio.pause()
        } catch (e) {}
        storage.patchMeta({ lastTrackPlaying: false })
        this.setData({ playing: false, loading: false })
        this.sync(true)
        this.rejectLocked()
        return
      }
      const app = getApp()
      if (app && app.globalData) app.globalData.audioSession = true
      this.disarmLoadingGuard()
      storage.patchMeta({ lastTrackPlaying: true })
      this.setData({ loading: false })
      this.sync(true)
      // 系统侧暂停已冻结倒计时；恢复播放时续剩余，没有运行中的倒计时才按偏好起表。
      // 与入睡页 dock 同口径：偏好取内存中的 audioTimer.total()（默认“关”=0，
      // 不跨会话回忆 meta 里的旧档位）。
      this.applyTimerPreference(audioTimer.total())
    },

    handlePause() {
      if (!this._alive) return
      this.disarmLoadingGuard()
      // 与 audio-dock 同口径：通知栏/锁屏/耳机暂停也必须冻结倒计时。
      audioTimer.pause()
      storage.patchMeta({ lastTrackPlaying: false })
      if (this.data.loading) this.setData({ loading: false })
      this.sync(true)
    },

    handleCanPlay() {
      if (!this._alive) return
      this.disarmLoadingGuard()
      if (this.data.loading) this.setData({ loading: false })
    },

    handleTimeUpdate() {
      if (!this._alive) return
      // 无缝回环绕过 onEnded，而首页/统计页没有 audio-dock 的 60s 到期扫描；
      // 低频复检一次权益，避免到期后一直循环播放。
      const now = Date.now()
      if (now - (this._entitlementAt || 0) > 15000) {
        this._entitlementAt = now
        if (this._audio && !this._audio.paused && !this.canPlay()) {
          try {
            this._audio.pause()
          } catch (e) {}
          storage.patchMeta({ lastTrackPlaying: false })
          this.setData({ playing: false, loading: false })
          this.sync(true)
          this.rejectLocked()
          return
        }
      }
      // 曲末前无缝回环：不进 ended、不换 src，保住微信悬浮音符（见 player-state.seamlessLoop）
      playerState.seamlessLoop(this._audio)
    },

    /** 统一设置音源并记录最后一次赋值，供 onError 判断是否为旧源 */
    setAudioSrc(url) {
      const next = url || ''
      this._expectSrc = next
      if (this._audio) this._audio.src = next
    },

    /** 按 meta.lastTrackId 从配置重建播放源：部分基础库在系统 stop 后会清空 src。 */
    rebuildSource() {
      if (!this.canPlay()) return false
      const meta = storage.getMeta()
      if (!meta.lastTrackId || !this._audio) return false
      const cfg = getConfig()
      const track = (cfg.audio || []).filter((item) => item.id === meta.lastTrackId)[0]
      // 与 audio-dock.play 同口径：非 https 源不重建，避免进入静默 onError 循环
      if (!track || !track.url || track.url.indexOf('https://') !== 0) return false
      const cached = cache.peek(track.url, (cfg.cache && cfg.cache.ttlDays) || 7, track.url)
      this._audio.title = '睡点 · ' + track.title
      this._audio.epname = '环境音'
      this._audio.singer = '睡点'
      this.setAudioSrc(cached || track.url)
      storage.patchMeta({ lastTrackActive: true, lastTrackPlaying: true })
      return true
    },

    handleEnded() {
      if (!this._alive) return
      // 同一轮 ended 只允许一个组件重播（audio-dock 也会收到），否则会重复赋 src + play()。
      if (!playerState.claimEnded()) return
      // 到期后不再自动循环续播；保留入口让用户回入睡页重新解锁。
      if (!this.canPlay()) {
        storage.patchMeta({ lastTrackActive: false, lastTrackPlaying: false })
        const app = getApp()
        if (app && app.globalData) app.globalData.audioSession = false
        this.collapse()
        this.rejectLocked()
        return
      }
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
        this.armLoadingGuard()
        this._audio.play()
      } catch (e) {
        this.disarmLoadingGuard()
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
      this.disarmLoadingGuard()
      // 即使还没真正展示，也要取消待执行的入场/折叠，避免“已停止后又弹出来”
      if (this._enterTimer) {
        clearTimeout(this._enterTimer)
        this._enterTimer = null
      }
      this.clearCollapseTimer()
      if (!this.data.visible) return
      // 只摘掉 is-in，由 WXSS 完成折叠；元素常驻但不可点，避免 wx:if 硬切
      this.setData({ visible: false, collapsing: false, loading: false })
    },

    handleStop() {
      if (!this._alive) return
      this.disarmLoadingGuard()
      if (this.data.loading) this.setData({ loading: false })
      const expiredAt = audioTimer.lastExpiredAt()
      if (
        expiredAt &&
        Date.now() - expiredAt < EXPIRY_TOAST_WINDOW_MS &&
        this._pageVisible &&
        playerState.claimExpiryToast(EXPIRY_TOAST_WINDOW_MS)
      ) {
        wx.showToast({ title: '定时结束，已停止播放', icon: 'none' })
      }
      this.sync(true)
    },

    handleError(err) {
      if (!this._alive) return
      // 切歌/回退竞态：旧源的错误迟到时不能拿去处理新会话（会误删新曲缓存、清掉迷你条）。
      if (!playerState.isCurrentSourceError(this._audio && this._audio.src, this._expectSrc)) {
        return
      }
      // 与 audio-dock 同口径：错误码进事件队列，1s 内只报一条
      const now = Date.now()
      if (now - (this._lastErrorAt || 0) > 1000) {
        this._lastErrorAt = now
        const code = (err && (err.errCode || err.code)) || 'unknown'
        events.track(
          'audio_error',
          (storage.getMeta().lastTrackId || 'unknown') + '|' + code
        )
      }
      this.disarmLoadingGuard()
      if (this.data.loading) this.setData({ loading: false })
      const audio = this._audio
      // 本地缓存源损坏时，dock 不在场（首页/统计页）也要自行回退远程一次；
      // 否则重建源会反复命中同一个坏文件，用户点一次播放就失败一次。
      if (audio && audio.src && audio.src.indexOf('https://') !== 0) {
        const meta = storage.getMeta()
        const cfg = getConfig()
        const track = (cfg.audio || []).filter((item) => item.id === meta.lastTrackId)[0]
        if (track && track.url) {
          // 同一轮错误只允许一个组件执行“坏缓存失效 + 远程回退”；
          // 另一个实例（audio-dock）已经处理过时直接同步即可。
          if (playerState.isFallbacking(track.url)) {
            this.sync(true)
            return
          }
          playerState.markFallback(track.url)
          // 与 audio-dock 同口径：只有磁盘文件确实不可用才删。
          // 网络/解码错误时文件是好的，直接删会误伤健康缓存（还可能删到在播文件）。
          if (!cache.isUsable(track.url)) cache.remove(track.url)
          storage.patchMeta({ lastTrackActive: true, lastTrackPlaying: true })
          this.setAudioSrc(track.url)
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
      const now = Date.now()
      if (now - this._lastToggleAt < TOGGLE_GUARD_MS) return
      this._lastToggleAt = now

      // 暂停/继续都要过权益校验；已到期时允许暂停，但不允许再起播。
      if (audio.paused && !this.canPlay()) {
        this.rejectLocked()
        return
      }

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
      this.setData({
        playing: next,
        loading: next,
        miniExpanded: !next,
        collapsed: false,
        collapsing: false
      })
      storage.patchMeta({ lastTrackPlaying: next })
      try {
        if (next) {
          const app = getApp()
          if (app && app.globalData) app.globalData.audioSession = true
          // 与入睡页 dock 一致：暂停中续剩余，没有运行中的倒计时才按偏好重新起表；
          // 偏好取 audioTimer.total()（默认“关”=0，不跨会话回忆旧档位）
          this.applyTimerPreference(audioTimer.total())
          this.armLoadingGuard()
          audio.play()
        } else {
          audio.pause()
          audioTimer.pause()
        }
      } catch (e) {
        this.disarmLoadingGuard()
        this.setData({ playing: !next, loading: false })
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
