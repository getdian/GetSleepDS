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
const audioSession = require('../../utils/audio-session')
const { resolvePlayerSurface } = require('../../utils/player-surface')
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
    collapsing: false,
    // 停止按钮已“上膛”：3 秒内再点一次才真正停止（防睡前误触）
    stopArmed: false
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
      // 组件销毁时清掉“停止上膛”的定时器（_alive 已置 false，不会再 setData）
      this.clearStopArm()
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
      // 任何来源的起播都算会话存活（含中断结束后的自动续播）
      audioSession.onPlay()
      storage.patchMeta({ lastTrackPlaying: true })
      this.setData({ loading: false })
      this.sync(true)
      // 系统侧暂停已冻结倒计时；恢复播放时续剩余，没有运行中的倒计时才按偏好起表。
      // 与入睡页 dock 同口径：偏好取内存中的 audioTimer.total()（默认“关”=0，
      // 不跨会话回忆 meta 里的旧档位）。
      this.applyTimerPreference(audioTimer.total())
      // 后台/锁屏时 onTimeUpdate 不再回调，回环点改由定时器兜底
      playerState.armLoop(this._audio)
    },

    handlePause() {
      if (!this._alive) return
      this.disarmLoadingGuard()
      // 与 audio-dock 同口径：通知栏/锁屏/耳机暂停也必须冻结倒计时。
      audioTimer.pause()
      // 只有用户在小程序内暂停才阻止自动恢复
      audioSession.onPause()
      storage.patchMeta({ lastTrackPlaying: false })
      if (this.data.loading) this.setData({ loading: false })
      this.sync(true)
    },

    handleCanPlay() {
      if (!this._alive) return
      this.disarmLoadingGuard()
      // 部分基础库起播时不补发 play 事件：以播放器真实状态自愈，
      // 否则会“声音在播、迷你条显示已暂停”。
      const live = !!(this._audio && !this._audio.paused)
      if (this.data.loading || (live && !this.data.playing)) {
        this.setData({ loading: false, playing: live || this.data.playing })
      }
      playerState.armLoop(this._audio)
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
      // 前台每秒校准回环定时器；锁屏后没有 timeupdate 时由它独立兜底
      playerState.armLoop(this._audio)
    },

    /** 统一设置音源并记录最后一次赋值，供 onError 判断是否为旧源 */
    setAudioSrc(url) {
      const next = url || ''
      this._expectSrc = next
      // 与 audio-dock 共用同一份期望源：错误归属判断不能各自为政
      audioSession.setExpectedSrc(next)
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
      // 会话已被显式终止（用户停止 / 定时到点）：迟到的 ended 不能把音频重新拉响。
      // 两个组件是同一个播放器的监听者，谁先拿到 claim 不确定，口径必须一致。
      if (!audioSession.isActive()) {
        storage.patchMeta({ lastTrackPlaying: false })
        this.setData({ playing: false })
        this.sync(true)
        return
      }
      // 同一轮 ended 只允许一个组件重播（audio-dock 也会收到），否则会重复赋 src + play()。
      if (!playerState.claimEnded()) return
      // 坏源/极短源的自动重播限流（与 audio-dock 共用同一窗口）
      if (!audioSession.allowReplay()) {
        audioSession.onPlayFailed()
        storage.patchMeta({ lastTrackPlaying: false })
        this.setData({ playing: false })
        this.sync(true)
        if (this._pageVisible) wx.showToast({ title: '播放异常，请重新播放', icon: 'none' })
        return
      }
      // 到期后不再自动循环续播；保留入口让用户回入睡页重新解锁（业务终止，允许收会话）。
      if (!this.canPlay()) {
        audioSession.markStopped()
        this.collapse()
        this.rejectLocked()
        return
      }
      // audio-dock 只挂在入睡页；在首页/统计页自然播完时由这里接管循环与终止态，
      // 否则迷你条会停在“正在播放”再遇到 toggle 的静默 return。
      audioTimer.restore()
      const expiredAt = audioTimer.lastExpiredAt()
      const justExpired = expiredAt && Date.now() - expiredAt < EXPIRY_TOAST_WINDOW_MS
      if (audioTimer.shouldStop() || justExpired) {
        // 定时到点：业务终止，隐藏入口
        audioSession.markStopped()
        this.collapse()
        return
      }
      if (!this.rebuildSource()) {
        // 配置还没落地/曲目暂时找不到：保留会话与“已暂停”入口，
        // 等 App.onShow 拉到真实配置后由 audio-session.onConfigReady 续播。
        storage.patchMeta({ lastTrackPlaying: false })
        this.setData({ playing: false })
        this.sync(true)
        return
      }
      try {
        this.armLoadingGuard()
        this._audio.play()
      } catch (e) {
        this.disarmLoadingGuard()
        // 起播失败同样保留会话，交给 onError / 用户点按重试收口
        storage.patchMeta({ lastTrackPlaying: false })
        this.setData({ playing: false })
        this.sync(true)
      }
    },

    /** 以 meta + 后台音频状态为准同步展示；任何事件都走这里，避免多实例口径漂移 */
    sync(force) {
      if (!this._alive) return
      const meta = storage.getMeta()
      const audio = this._audio
      const app = getApp()
      const surface = resolvePlayerSurface({
        lastTrackId: meta.lastTrackId,
        lastTrackActive: meta.lastTrackActive,
        lastTrackPlaying: meta.lastTrackPlaying,
        hasSrc: !!(audio && audio.src),
        // 必须严格 false 才算在播：BAM 无 src 时 paused 是 undefined，!paused 会是 true
        playingNow: !!(audio && audio.src) && audio.paused === false,
        sessionLive: !!(app && app.globalData && app.globalData.audioSession)
      })
      if (!surface.visible) {
        // 只有“用户显式停止”或从未播放过才收起入口
        this.collapse()
        this.syncTimer(true)
        return
      }
      // 冷启动/悬浮 X 停止后的残影：只把播放态归零，**不清会话**。
      // 清了会话（markStopped）会让用户重进小程序时迷你条消失，无法继续听。
      if (surface.cold && meta.lastTrackPlaying !== false) {
        storage.patchMeta({ lastTrackPlaying: false })
      }

      const playing = surface.playing
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
            // 入场延迟期间恰好停止播放时不要再弹出来；
            // 但“外部中断把 lastTrackActive 误清、播放器仍在出声”不算停止
            const latest = storage.getMeta()
            const stillPlaying = !!(this._audio && !this._audio.paused)
            if (!this._audio || (latest.lastTrackActive === false && !stillPlaying)) return
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
      // 系统 stop（微信浮窗 X / 系统回收）只取消自动续播意图，不结束会话
      audioSession.onStop()
      // 必须落“已暂停”：src 已被清空时 sync 会用这个字段兜底，
      // 漏写会把暂停态渲染成“正在播放”，点暂停反而重建音源起播。
      storage.patchMeta({ lastTrackPlaying: false })
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
      // 期望源以会话模块为准：自动续播会重设 src，组件本地值可能是旧的。
      const expected = audioSession.getExpectedSrc() || this._expectSrc
      if (!expected) return
      if (!playerState.isCurrentSourceError(this._audio && this._audio.src, expected)) {
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
      // 仍在出声：网络/解码抖动交给底层重连，不能清会话。
      // 否则会出现“音乐还在播，首页/统计页迷你条已经消失”的状态错位。
      if (this._audio && !this._audio.paused) {
        this.sync(true)
        return
      }
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
      // - 会话已被显式终止（用户停止/定时到点）：lastTrackActive=false。
      setTimeout(() => {
        if (!this._alive) return
        const meta = storage.getMeta()
        if (playerState.isFallbacking()) {
          this.sync(true)
          return
        }
        if (meta.lastTrackActive === false) {
          // 会话已终止：只取消播放意图，不重复 markStopped（避免把 stoppedAt
          // 推到 now，害得用户 800ms 内的“点按重试”被当成迟到事件）
          audioSession.onStop()
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
        // 终态失败也**保留会话**：迷你条继续以“已暂停”显示，用户可点按重试。
        // 只有用户主动停止（close）才允许移除入口——外部原因不算停止。
        playerState.clearFallback()
        audioSession.onPlayFailed()
        // 失败后冻结倒计时，避免到点 stopAudio() 把“外部失败”变成业务终止
        audioTimer.pause()
        storage.patchMeta({ lastTrackPlaying: false })
        this.setData({ playing: false })
        this.sync(true)
        if (this._pageVisible) wx.showToast({ title: '音频加载失败，点按重试', icon: 'none' })
      }, 300)
    },

    toggle() {
      // 用户改按播放/暂停：取消未完成的“停止上膛”
      this.clearStopArm()
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

      // 续播意图必须在重建音源之前确定：BAM 赋 src 会自动起播，
      // 之后再看 audio.paused 可能已经是 false，会把刚重建的播放又暂停一次。
      let next = !!audio.paused
      if (!audio.src) {
        // 系统侧 stop 会清空 src：此前这里静默 return，用户点播放毫无反应。
        if (!this.rebuildSource()) {
          wx.showToast({ title: '音频已结束，请重新播放', icon: 'none' })
          return
        }
        next = true
        this.sync(true)
      }
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
      // 用户在小程序内的暂停/续播：这是“是否允许中断后自动恢复”的判定依据
      if (next) audioSession.markUserPlay()
      else audioSession.markUserPause()
      try {
        if (next) {
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

    /**
     * 停止二次确认：首点只上膛 3 秒（图标转暖红 + toast 提示），再点才真正停止。
     * 迷你条上的停止方块与播放键相邻，睡前误触一次就整夜没声音，成本太高。
     */
    requestStop() {
      if (this._stopArmTimer) {
        this.close()
        return
      }
      if (this._alive) this.setData({ stopArmed: true })
      wx.showToast({ title: '再点一次停止播放', icon: 'none', duration: 1500 })
      this._stopArmTimer = setTimeout(() => {
        this._stopArmTimer = null
        if (this._alive) this.setData({ stopArmed: false })
      }, 3000)
    },

    clearStopArm() {
      if (this._stopArmTimer) {
        clearTimeout(this._stopArmTimer)
        this._stopArmTimer = null
      }
      if (this._alive && this.data.stopArmed) this.setData({ stopArmed: false })
    },

    close() {
      this.clearStopArm()
      // 关闭播放条是“停止本次会话”，不是“把下次定时偏好归零”。
      audioTimer.clear(undefined, true)
      // 用户主动停止：唯一允许隐藏迷你条并关闭自动恢复的入口
      audioSession.markStopped()
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
