/**
 * 跨页迷你播放器。
 * 声音入口仍然只在入睡页（audio-dock）；这里只在「已经播放过」时出现，
 * 让用户在计算器/统计页也能暂停、继续、停止，不必切回入睡页。
 * 监听 play/pause/stop/error，并作为 ended 的“第二处理人”：audio-dock 只在入睡页常驻，
 * 但两个组件可能同时收到同一个 ended，因此用 playerState.claimEnded() 去重；
 * 曲末推进统一交给 audio-player（单曲回环 / 列表换下一首），组件不再各写一套。
 */
const storage = require('../../utils/storage')
const audioTimer = require('../../utils/audio-timer')
const playerState = require('../../utils/player-state')
const events = require('../../utils/events')
const audioSession = require('../../utils/audio-session')
const player = require('../../utils/audio-player')
const { noticeText } = require('../../utils/player-notices')
const { isReallyPlaying } = require('../../utils/player-surface')
const tabbar = require('../../utils/tabbar')
const { getConfig } = require('../../utils/config')

const TOGGLE_GUARD_MS = 220
const EXPIRY_TOAST_WINDOW_MS = 2000
// 续播后播放条停留时长：用户刚点完播放，控件立刻缩回音符会让人以为没点上
const RESUME_PEEK_MS = 3000

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
      this._peekTimer = null
      this._loadingTimer = null
      this._reconcileTimer = null
      this._unsubTimer = null
      this._onPlay = () => this.handlePlay()
      this._onPause = () => this.handlePause()
      this._onStop = () => this.handleStop()
      this._onEnded = () => this.handleEnded()
      this._onError = (err) => this.handleError(err)
      this._onCanplay = () => this.handleCanPlay()
      this._onTimeUpdate = () => this.handleTimeUpdate()
      this.setup()
      // 首页/统计页也要收到播放器提示（到期、加载超时、失败…）：
      // 事件层在 App.onLaunch 已统一初始化，这里只补本页的文案出口。
      player.init({ notice: (code) => this.handlePlayerNotice(code) })
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
      this.clearPeek()
      if (this._reconcileTimer) {
        clearTimeout(this._reconcileTimer)
        this._reconcileTimer = null
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
      // 另一页已经把“记忆展开”关掉时，本页不能还停在展开态（两页必须同一个形态）
      if (!this.expandedPreferred() && this.data.miniExpanded) {
        this.setData({ miniExpanded: false })
      }
      this.sync(false)
      // 系统/会话层续播可能比本页 show 晚一拍：800ms 后按真实状态再对一次账
      this.scheduleReconcile()
    },
    hide() {
      this._pageVisible = false
    }
  },

  methods: {
    setup() {
      if (this._audio) return
      // 实例由 audio-player 单例持有，这里只订阅它，不再自己创建。
      const audio = player.audio()
      if (!audio) return
      this._audio = audio
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
        const playing = isReallyPlaying(audio)
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

    /** 播放器事件提示（文案与入睡页共用 utils/player-notices） */
    handlePlayerNotice(code) {
      if (!this._alive || !this._pageVisible) return
      const text = noticeText(code)
      if (!text) return
      wx.showToast({ title: text, icon: 'none' })
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
      // 后台/锁屏时 onTimeUpdate 不再回调，曲末动作改由定时器兜底（单曲回环 / 列表换曲）
      player.armTail(this._audio)
    },

    handlePause() {
      if (!this._alive) return
      // 任何来源的暂停都要保住“已暂停”条：不能正好卡在续播亮相的 3 秒里被收走
      this.clearPeek()
      this.disarmLoadingGuard()
      // 缓冲导致的系统 pause 不是用户暂停：与 audio-player 同一口径——
      // 不冻结倒计时、不把条子收成“已暂停”，保持“缓冲中”等播放器重试。
      if (player.isBuffering() && !audioSession.isUserPaused()) {
        this.setData({ playing: false, loading: true })
        this.armLoadingGuard()
        return
      }
      // 通知栏/锁屏/耳机暂停也必须冻结倒计时（与入睡页 dock 同口径）。
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
      const live = isReallyPlaying(this._audio)
      if (this.data.loading || (live && !this.data.playing)) {
        this.setData({ loading: false, playing: live || this.data.playing })
      }
      player.armTail(this._audio)
    },

    handleTimeUpdate() {
      if (!this._alive) return
      // 真机反馈（2026-10-27）：关掉音乐再回小程序会自动续播，但条子仍写“已暂停”。
      // play 事件早到/丢失时 UI 会停在旧态；timeupdate 只会在真正出声时触发，
      // 所以这里按真实状态自愈一次（不是靠事件顺序）。
      if (!this.data.playing && isReallyPlaying(this._audio)) {
        this.setData({ playing: true, loading: false })
        storage.patchMeta({ lastTrackPlaying: true })
        this.sync(true)
      }
      // 权益到期统一由 audio-player 的 timeupdate 巡检收口（15s 一次 + stop）；
      // 这里不再自己 pause，否则同一轮到期在首页会停在“已暂停”，在入睡页却是条子消失。
      // 曲末动作与入睡页同源：列表循环在 ended 前换下一首，单曲才无缝回环
      if (!player.tailTick(this._audio)) playerState.seamlessLoop(this._audio)
      // 前台每秒校准曲末定时器；锁屏后没有 timeupdate 时由它独立兜底
      player.armTail(this._audio)
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
      // 取源、https 校验、缓存优先、期望源记账都在 audio-player 里，两个组件共用一份
      const attached = player.rebuild(meta.lastTrackId, { audio: this._audio })
      if (!attached) return false
      // 接入层已经赋过 src，这里只同步期望源，避免重复赋值触发重新加载
      this._expectSrc = attached.url
      audioSession.setExpectedSrc(attached.url)
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
      // 曲末推进统一交给播放器：单曲循环回环 / 列表循环换下一首，口径只有一份。
      // 推进失败（配置未落地 / 曲目找不到）时保留会话与“已暂停”入口，
      // 等 App.onShow 拉到真实配置后由 audio-session.onConfigReady 续播。
      if (!player.advance()) {
        storage.patchMeta({ lastTrackPlaying: false })
        this.setData({ playing: false })
        this.sync(true)
      }
    },

    /** 以 meta + 后台音频状态为准同步展示；任何事件都走这里，避免多实例口径漂移 */
    sync(force) {
      if (!this._alive) return
      const view = player.surfaceOf({ audio: this._audio })
      const meta = view.meta
      const surface = view.surface
      if (!surface.visible) {
        // 只有“用户显式停止”或从未播放过才收起入口
        this.collapse()
        this.syncTimer(true)
        return
      }
      // 冷启动/悬浮 X 停止后的残影：只把播放态归零，**不清会话**。
      // 清了会话（markStopped）会让用户重进小程序时迷你条消失，无法继续听。
      if (view.coldPatch) storage.patchMeta(view.coldPatch)

      const playing = surface.playing
      const title = meta.lastTrackTitle || '环境音'
      const category = meta.lastTrackCategory || ''
      // 播放中保留用户手动展开的状态（含跨页记忆），避免 play/pause 事件把条瞬间收回
      const miniExpanded = playing ? this.data.miniExpanded || this.expandedPreferred() : true

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
            const stillPlaying = isReallyPlaying(this._audio)
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

    /**
     * 跨页记忆：用户点开播放条后，切到别的 tab 仍保持展开。
     * 只存在 globalData（本次启动有效），不落磁盘——下次冷启动默认还是音符，
     * 避免每次进小程序都被一条播放条挡住页面底部。
     */
    expandedPreferred() {
      const app = getApp()
      return !!(app && app.globalData && app.globalData.playerBarExpanded)
    },

    rememberExpanded(value) {
      const app = getApp()
      if (app && app.globalData) app.globalData.playerBarExpanded = !!value
    },

    /**
     * 回前台对账：系统/会话层续播可能比本页 show 晚一拍，
     * 800ms 后按播放器真实状态再刷一次，避免“已在播却显示已暂停”。
     */
    scheduleReconcile() {
      if (this._reconcileTimer) clearTimeout(this._reconcileTimer)
      this._reconcileTimer = setTimeout(() => {
        this._reconcileTimer = null
        if (!this._alive) return
        this.sync(true)
      }, 800)
    },

    expandMini() {
      this.clearPeek()
      this.clearCollapseTimer()
      this.rememberExpanded(true)
      this.setData({ miniExpanded: true, collapsed: false, collapsing: false })
    },

    clearCollapseTimer() {
      if (this._collapseTimer) {
        clearTimeout(this._collapseTimer)
        this._collapseTimer = null
      }
    },

    /** 点击播放条外部：向右收缩回音符，不停止播放（这次收起算用户手动折叠） */
    collapseMini() {
      this.runCollapse(true)
    },

    /**
     * 续播后短暂保留播放条：用户刚点完播放，控件立刻消失会以为没点上。
     * 到点只收成音符、不记为“手动折叠”，所以之后暂停仍会自动展开播放条。
     */
    armResumePeek() {
      this.clearPeek()
      // 用户已经把播放条“钉”在展开态：续播后不要再自动收回
      if (this.expandedPreferred()) return
      this._peekTimer = setTimeout(() => {
        this._peekTimer = null
        if (!this._alive || !this.data.playing) return
        // 缓冲中先不收（此时用户最需要看到“缓冲中”和暂停键），起播后再看一轮；
        // 加载守卫 12 秒必结算，不会无限续期
        if (this.data.loading) {
          this.armResumePeek()
          return
        }
        this.runCollapse(false)
      }, RESUME_PEEK_MS)
    },

    clearPeek() {
      if (this._peekTimer) {
        clearTimeout(this._peekTimer)
        this._peekTimer = null
      }
    },

    runCollapse(sticky) {
      this.clearPeek()
      // 用户主动收起才改“记忆展开”；续播亮相的自动收起不算用户意图
      if (sticky !== false) this.rememberExpanded(false)
      if (this.data.collapsed || this.data.collapsing) return
      this.clearCollapseTimer()
      this.setData({ collapsing: true })
      this._collapseTimer = setTimeout(() => {
        this._collapseTimer = null
        if (!this._alive) return
        this.setData({ collapsing: false, miniExpanded: false, collapsed: sticky !== false })
      }, 210)
    },

    /** 点击播放条：切到入睡页并打开环境声音抽屉 */
    openAudio() {
      this.clearPeek()
      const app = getApp()
      if (app && app.globalData) app.globalData.openAudioSheet = true
      // 统一走 tabbar.switchTo：先落选中意图 + 旧条重绘，避免切页过渡残留旧高亮
      tabbar.switchTo(1, '/pages/sleep/sleep', () => {
        if (app && app.globalData) app.globalData.openAudioSheet = false
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
      this.clearPeek()
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
      this.clearPeek()
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
      const audio = this._audio
      const meta = storage.getMeta()
      // 归属与分支统一由 audio-player 判定（旧源迟到 / 1.5s 内 / 仍在出声 / 回退 / 终态）。
      // 这样“首页/统计页遇到坏缓存要回退远程”和“坏源要拉黑”两件事只剩一份实现。
      const plan = player.errorPlan({
        audio,
        expected,
        track: player.trackOf(meta.lastTrackId),
        fromCache: !!(audio && audio.src && audio.src.indexOf('https://') !== 0)
      })
      if (plan.action === 'playing') {
        this.sync(true)
        return
      }
      if (plan.action === 'ignore' || plan.action === 'too_soon') {
        this.sync(true)
        return
      }
      if (plan.action === 'fallback') {
        // 用户已在小程序内暂停：只把坏源拉黑，不得重新赋源起播
        // （给 BAM 赋 src 会自动出声；与 audio-player 的同一道闸门）
        if (!audioSession.canAutoStart()) {
          player.markBadSource(plan.badUrl)
          storage.patchMeta({ lastTrackPlaying: false })
          this.sync(true)
          return
        }
        // 同一轮错误只允许一个组件执行“坏缓存失效 + 远程回退”；
        // 另一个实例（audio-dock）已经处理过时直接同步即可。
        if (playerState.isFallbacking(plan.badUrl)) {
          this.sync(true)
          return
        }
        playerState.markFallback(plan.badUrl)
        // 与 audio-dock 同一实现：磁盘可用就不删、但本会话一律拉黑
        player.markBadSource(plan.badUrl)
        storage.patchMeta({ lastTrackActive: true, lastTrackPlaying: true })
        this.setAudioSrc(plan.badUrl)
        return
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
        if (isReallyPlaying(audio)) {
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
      // 用户接管了播放条：取消待执行的“续播亮相”收起
      this.clearPeek()
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
      // 先反馈再调底层：续播时先保住播放条（3 秒后再收成音符），暂停时保持展开
      this.clearCollapseTimer()
      this.setData({
        playing: next,
        loading: next,
        miniExpanded: true,
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
          // 这条直调 BAM 的续播也是起播入口：同样要排自动缓存（与 player.play/resume 同口径）
          const current = player.trackOf(storage.getMeta().lastTrackId)
          if (current) player.scheduleAutoCache(current)
          // 续播成功后再起表：失败/立刻暂停都不该触发“3 秒后收起”
          this.armResumePeek()
        } else {
          audio.pause()
          audioTimer.pause()
        }
      } catch (e) {
        this.clearPeek()
        this.disarmLoadingGuard()
        this.setData({ playing: !next, loading: false })
        storage.patchMeta({ lastTrackPlaying: !next })
        if (this._pageVisible) wx.showToast({ title: '操作失败，请重试', icon: 'none' })
      }
      // 定时状态此时才落定（暂停/续时都会改文案），最后统一刷新一次
      this.syncTimer()
    },

    /**
     * 手动下一首：统一交给播放器（列表循环优先队列快照，其余按配置列表）。
     * 两个入口不能各自算一遍下一首——audio-dock 与迷你条必须切到同一首。
     */
    next() {
      this.clearStopArm()
      this.clearPeek()
      if (!this.canPlay()) {
        this.rejectLocked()
        return
      }
      if (!this._audio) return
      if (!player.next()) {
        if (this._pageVisible) wx.showToast({ title: '只有一个音源', icon: 'none' })
        return
      }
      // 切歌后保住播放条 3 秒，让用户看到曲名已经换了
      this.clearCollapseTimer()
      this.setData({
        playing: true,
        loading: true,
        miniExpanded: true,
        collapsed: false,
        collapsing: false
      })
      this.armLoadingGuard()
      this.armResumePeek()
      this.applyTimerPreference(audioTimer.total())
      this.syncTimer()
      // play 事件不保证到达（部分基础库/自动化环境）：切歌后主动把入口拉起来，
      // 否则「停止→再切歌」会留在隐藏态，用户以为没反应。
      if (!this.data.visible) this.setData({ visible: true })
    },

    /**
     * 停止二次确认：首点只上膛 3 秒（图标转暖红 + toast 提示），再点才真正停止。
     * 迷你条上的停止方块与播放键相邻，睡前误触一次就整夜没声音，成本太高。
     */
    requestStop() {
      this.clearPeek()
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
      // 用户主动停止统一走播放器：会话终止、停止意图、重试/自动缓存定时器、
      // 定时偏好一处收口。直调 audio.stop() 会漏掉这些清理——残留的缓冲重试
      // 4 秒后还会再发一次 play()（空 src），并留下 currentId 让下次点按重建音源起播。
      player.stop()
      this.collapse()
    },

    goSleep() {
      tabbar.switchTo(1, '/pages/sleep/sleep')
    }
  }
})
