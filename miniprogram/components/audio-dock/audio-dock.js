const { getConfig, loadConfig } = require('../../utils/config')
const storage = require('../../utils/storage')
const cache = require('../../utils/audio-cache')
const api = require('../../utils/api')
const { withLogin } = require('../../utils/login')
const ad = require('../../utils/ad')
const events = require('../../utils/events')
const audioTimer = require('../../utils/audio-timer')
const playerState = require('../../utils/player-state')
const tabbar = require('../../utils/tabbar')

const ICONS = ['rain', 'wave', 'fire', 'noise', 'night']
const TOGGLE_GUARD_MS = 220
const TONES = {
  自然之声: 'teal',
  白噪音: 'blue',
  环境音: 'amber',
  雨声: 'teal'
}

function toneOf(category) {
  const name = String(category || '')
  if (TONES[name]) return TONES[name]
  if (/雨|水|海|溪|浪/.test(name)) return 'teal'
  if (/火|柴|炉/.test(name)) return 'amber'
  if (/噪|白/.test(name)) return 'blue'
  return 'violet'
}
const TIMER_OPTIONS = [
  { value: 30, label: '30分' },
  { value: 60, label: '60分' },
  { value: 90, label: '90分' },
  { value: 0, label: '关' }
]

Component({
  data: {
    open: false,
    tracks: [],
    filteredTracks: [],
    categories: ['全部'],
    keyword: '',
    activeCategory: '全部',
    favoriteIds: [],
    unlocked: false,
    freeMode: false,
    unlockHours: 24,
    unlockRemainText: '',
    timerOptions: TIMER_OPTIONS,
    // 默认不自动关闭：用户明确选 30/60/90 后才开始倒计时
    timerMinutes: 0,
    timerRemainText: '',
    currentId: '',
    currentTitle: '',
    currentCategory: '',
    playing: false,
    // 播放中默认收成右侧绿色音符；点开才展开播放条，点播放条再开抽屉
    miniExpanded: false,
    // 手动折叠后即使暂停也保持音符形态；播放/展开时复位
    collapsed: false,
    // 折叠中：保留播放条播放“向右收缩”动画，动画结束后再切音符
    collapsing: false,
    // 源已赋值但尚未真正起播（弱网/缓存文件损坏）时，文案显示“连接中”而不是“正在播放”
    loading: false,
    playerSub: '',
    cacheText: '',
    cacheCount: 0,
    sheetShow: false,
    unlocking: false,
    prepareText: '',
    unlockTitle: '解锁环境音',
    unlockDesc: '',
    unlockConfirm: '观看视频',
    unlockCancel: '先不用',
    timerEnabled: true
  },

  lifetimes: {
    attached() {
      this._alive = true
      // 等 pageLifetimes.show 再置 true，避免首帧就弹到别的页面上
      this._pageVisible = false
      this._audio = null
      this._cfg = getConfig()
      this._sheetTrackId = ''
      this._collapseTimer = null
      this._stopRequested = false
      this._playingFromCache = false
      this._currentTrack = null
      // 本会话已判定损坏的缓存 URL：即使文件删除失败也不再命中，避免每轮循环重演“报错→回退”
      this._badUrls = {}
      this._wasUnlocked = false
      // 广告看完了但本地有效期写入失败时，至少保证本次会话可用；
      // 否则抽屉显示“已解锁”、点曲目却重新弹解锁。
      this._sessionUnlocked = false
      this._ttlDays = (this._cfg.cache && this._cfg.cache.ttlDays) || 7
      this._onCacheChange = () => this.refreshCache()

      cache.onChange(this._onCacheChange)
      const lastTrackId = storage.getMeta().lastTrackId
      const lastTrack = (this._cfg.audio || []).filter((track) => track.id === lastTrackId)[0]
      cache.maybePrune(this._cfg.cache, lastTrack && lastTrack.url)

      this.applyConfig(this._cfg)
      this.setupAudio()
      ad.init(this._cfg.unlock && this._cfg.unlock.adUnitId)
      this.refreshUnlock()
      // 先让定时器按“真实存活会话”清理或恢复，再同步 UI。
      // 顺序反过来会先读到上个进程残留的 lastTrackPlaying，界面短暂显示幽灵播放态。
      audioTimer.restore()
      this.syncFromAudio()

      this._unsubTimer = audioTimer.subscribe((left) => {
        if (!this._alive) return
        if (left === 0 && this.data.currentId && storage.getMeta().lastTrackActive === false) {
          const expiredAt = audioTimer.lastExpiredAt()
          if (
            expiredAt &&
            Date.now() - expiredAt < 2000 &&
            this._pageVisible &&
            playerState.claimExpiryToast()
          ) {
            wx.showToast({ title: '定时结束，已停止播放', icon: 'none' })
          }
          // 到点即结束这一段会话：定时胶囊复位到“关”，不会静默重新起表
          this.setData({ currentId: '', currentTitle: '', currentCategory: '', playing: false, timerMinutes: 0 })
        }
        // 隐藏页不逐秒算文案，回到前台时由 show 补一次
        if (this._pageVisible) this.syncPlayerText()
      })
      this._unlockTimer = setInterval(() => {
        // 隐藏页不 setData；回到前台由 pageLifetimes.show 补一次
        if (this._alive && this._pageVisible) this.refreshUnlock()
      }, 60 * 1000)

      // 定时关闭默认“关”：不跨会话回忆上次档位——旧版本会把默认 60 分钟写进
      // meta.audioTimerMinutes，“回忆旧值”会让默认值失效；有跨进程恢复的
      // 运行中/暂停中倒计时时，按真实状态回显档位。
      this.setData({ timerMinutes: audioTimer.total() || 0 })

      loadConfig(true).then((cfg) => {
        if (!this._alive || !cfg) return
        this._cfg = cfg
        this.applyConfig(cfg)
        this.syncFromAudio()
        ad.init(cfg.unlock && cfg.unlock.adUnitId)
        if (this.isUnlocked() && cfg.features && cfg.features.preload) {
          cache.warmup(this.data.tracks, cfg.cache, true)
        }
      })
    },

    detached() {
      this._alive = false
      this.disarmLoadingGuard()
      if (this._collapseTimer) {
        clearTimeout(this._collapseTimer)
        this._collapseTimer = null
      }
      cache.offChange(this._onCacheChange)
      if (this._unsubTimer) {
        this._unsubTimer()
        this._unsubTimer = null
      }
      if (this._unlockTimer) {
        clearInterval(this._unlockTimer)
        this._unlockTimer = null
      }
      this.offAudio()
    }
  },

  pageLifetimes: {
    show() {
      this._pageVisible = true
      // 回到前台/切回入睡页时按墙钟再校准一次定时；app.onShow 之外的幂等兜底
      audioTimer.restore()
      // 统计页“清除数据”会 stop 音频并清空 meta；回到入睡页时同步清掉残留迷你条
      // 与定时胶囊（数据已清，偏好回到默认“关”）
      if (storage.getMeta().lastTrackActive === false && this.data.currentId) {
        this.setData({ currentId: '', currentTitle: '', currentCategory: '', playing: false, loading: false, playerSub: '', timerRemainText: '', timerMinutes: 0, miniExpanded: false, collapsed: false, collapsing: false })
      }
      // 从计算器/统计页切回来时以真实 BackgroundAudioManager 状态为准，
      // 不能沿用隐藏前的 playing，否则会出现“已暂停却显示正在播放、点暂停无效”。
      this.syncFromAudio()
      this.syncPlayerText()
      // 隐藏期间解锁可能到期；回前台补一次，避免继续显示“已解锁”
      this.refreshUnlock()
      if (this.data.open) tabbar.hide()
      else tabbar.show()
    },
    hide() {
      this._pageVisible = false
    }
  },

  methods: {
    noop() {},

    /**
     * 起播兜底：BackgroundAudioManager 在弱网/坏源时可能既不给 play 也不给 error，
     * 没有这个定时器“正在连接音频…”会永久挂在迷你条上，且没有任何重试出口。
     */
    armLoadingGuard() {
      this.disarmLoadingGuard()
      this._loadingTimer = setTimeout(() => {
        this._loadingTimer = null
        if (!this._alive || !this.data.loading) return
        this.setData({ loading: false, playerSub: '加载超时，点音符重试' })
      }, 12000)
    },

    disarmLoadingGuard() {
      if (this._loadingTimer) {
        clearTimeout(this._loadingTimer)
        this._loadingTimer = null
      }
    },

    applyConfig(cfg) {
      const tracks = (cfg.audio || []).map((item) => {
        const iconKey = ICONS.indexOf(item.icon) >= 0 ? item.icon : 'noise'
        return {
          id: item.id,
          title: item.title || '环境音',
          subtitle: item.subtitle || '循环播放 · 支持锁屏',
          category: item.category || '环境音',
          tone: toneOf(item.category || '环境音'),
          url: item.url,
          icon: '/assets/icon-' + iconKey + '.png'
        }
      })

      const categories = ['全部', '收藏']
      tracks.forEach((track) => {
        if (categories.indexOf(track.category) < 0) categories.push(track.category)
      })

      const copy = cfg.copy || {}
      const unlock = cfg.unlock || {}
      const timerEnabled = !cfg.features || cfg.features.timer !== false
      this._ttlDays = (cfg.cache && cfg.cache.ttlDays) || 7
      this.setData({
        tracks,
        categories,
        unlockHours: unlock.ttlHours || 24,
        unlockTitle: copy.unlockTitle || '解锁环境音',
        unlockDesc: copy.unlockDesc || '',
        unlockConfirm: copy.unlockConfirm || '观看视频',
        unlockCancel: copy.unlockCancel || '先不用',
        timerEnabled,
        favoriteIds: storage.getFavorites(),
        activeCategory: categories.indexOf(this.data.activeCategory) >= 0 ? this.data.activeCategory : '全部'
      })
      if (!timerEnabled) audioTimer.clear(undefined, true)
      this.applyFilter()
      this.refreshCache()
      this.refreshUnlock()
    },

    /* ---------------- 缓存 ---------------- */
    refreshCache() {
      if (!this._alive) return
      const tracks = this.data.tracks
      const current = this.findTrack(this.data.currentId)
      const count = cache.cachedCount(tracks, this._ttlDays, current && current.url)
      const mb = (cache.usedBytes() / 1024 / 1024).toFixed(1)
      this.setData({
        cacheCount: count,
        cacheText: '已缓存 ' + count + '/' + tracks.length + ' · 占用 ' + mb + ' MB'
      })
      this.applyFilter()
    },

    onCleanCache() {
      if (!this.data.cacheCount) {
        wx.showToast({ title: '暂无缓存', icon: 'none' })
        return
      }
      wx.showModal({
        title: '清理音频缓存',
        content: '清理后再次播放需要重新下载，Wi-Fi 下会自动补全。',
        confirmText: '清理',
        cancelText: '取消',
        success: (res) => {
          if (!res.confirm) return
          // 正在播放的文件不能被删，否则当前曲目可能中断；其余缓存全部清掉。
          const current = this.findTrack(this.data.currentId)
          cache.cleanAll(current && current.url ? current.url : '')
          this.refreshCache()
          wx.showToast({ title: '已清理', icon: 'none' })
        }
      })
    },

    /* ---------------- 解锁 ---------------- */
    isUnlocked() {
      return this._sessionUnlocked || storage.getUnlockExpire() > Date.now()
    },

    isFreeMode() {
      const unlock = this._cfg.unlock || {}
      return unlock.mode !== 'rewarded' || !unlock.adUnitId
    },

    refreshUnlock() {
      if (!this._alive) return
      const unlocked = this.isUnlocked()
      const freeMode = this.isFreeMode()
      const expired = this._wasUnlocked && !unlocked && !freeMode
      this._wasUnlocked = unlocked
      let remainText = ''
      if (unlocked) {
        const expireAt = storage.getUnlockExpire()
        if (expireAt > Date.now()) {
          const left = expireAt - Date.now()
          const hours = Math.floor(left / 3600000)
          const minutes = Math.floor((left % 3600000) / 60000)
          remainText = '剩余约 ' + hours + ' 小时' + (minutes > 0 ? ' ' + minutes + ' 分钟' : '')
        } else {
          // 广告已看完但有效期写入失败：本次会话可听，重进小程序需重新解锁。
          remainText = '本次会话有效 · 重进需重新解锁'
        }
      }
      // 文案未变时不要每分钟 setData（60s 轮询的常态）
      const changed =
        unlocked !== this.data.unlocked ||
        freeMode !== this.data.freeMode ||
        remainText !== this.data.unlockRemainText
      if (changed) {
        this.setData({
          unlocked,
          freeMode,
          unlockRemainText: remainText
        })
      }
      // 到期即停止当前曲目，避免“已过期但仍可续播”的权益漏洞。
      if (expired && this.data.currentId) {
        this.stopPlayback()
        if (this._pageVisible) {
          wx.showToast({ title: '解锁已到期，重新解锁后继续', icon: 'none' })
        }
      }
    },

    showAd() {
      const unlock = this._cfg.unlock || {}
      if (unlock.mode !== 'rewarded' || !unlock.adUnitId) return Promise.resolve(true)

      return ad.show().then((result) => {
        if (result === 'skipped') {
          wx.showToast({ title: '视频没看完，先不解锁', icon: 'none' })
          return false
        }
        if (result === 'error' || result === 'unavailable') {
          if (unlock.onAdError === 'deny') {
            wx.showToast({ title: '广告暂不可用，稍后再试', icon: 'none' })
            return false
          }
          wx.showToast({ title: '广告没加载出来，本次直接放行', icon: 'none' })
        }
        return true
      })
    },

    finishUnlock(ttlMs) {
      const persist = (expire) => {
        if (!storage.setUnlockExpire(expire)) {
          // 本会话兜底解锁，并同步给 now-playing，避免首页把这次有效会话当成未解锁
          this._sessionUnlocked = true
          const app = getApp()
          if (app && app.globalData) app.globalData.audioUnlockedSession = true
          wx.showToast({ title: '解锁状态保存失败，请清理存储空间', icon: 'none' })
          return false
        }
        return true
      }
      return withLogin((code) => api.unlockAudio(code))
        .then((res) => {
          // 服务端时钟偏慢可能返回过去时间：此时按本地 TTL 兜底，避免“已解锁”提示但实际无效
          const now = Date.now()
          const serverExpire = Number(res && res.expireAt)
          const expire = serverExpire > now ? serverExpire : now + ttlMs
          return persist(expire)
        })
        .catch(() => persist(Date.now() + ttlMs))
    },

    /* ---------------- 音频 ---------------- */
    setupAudio() {
      if (this._audio || !wx.getBackgroundAudioManager) return
      let audio = null
      try {
        audio = wx.getBackgroundAudioManager()
      } catch (e) {
        audio = null
      }
      if (!audio) return

      this._audio = audio
      const handlers = {
        play: () => {
          if (!this._alive) return
          this.disarmLoadingGuard()
          playerState.clearFallback()
          const app = getApp()
          if (app && app.globalData) app.globalData.audioSession = true
          storage.patchMeta({ lastTrackPlaying: true })
          this.setData({ playing: true, loading: false })
          // 系统侧恢复（通知栏/锁屏/耳机）与首次起播都走这里：
          // 暂停事件已冻结倒计时，这里续剩余；没有运行中的倒计时才按本会话已明确
          // 选择的档位起表（默认“关”= 不起表，不跨会话回忆旧档位）。
          this.applyTimerPreference(this.data.timerMinutes)
          this.syncPlayerText()
        },
        pause: () => {
          if (!this._alive) return
          this.disarmLoadingGuard()
          // 系统侧暂停（通知栏/锁屏/耳机）不走 togglePlay，必须在这里冻结倒计时，
          // 否则用户睡前从锁屏暂停后，定时仍会偷跑并在到点时把会话清掉。
          audioTimer.pause()
          storage.patchMeta({ lastTrackPlaying: false })
          this.setData({ playing: false, loading: false, miniExpanded: true })
          this.syncPlayerText()
        },
        canplay: () => {
          if (!this._alive) return
          this.disarmLoadingGuard()
          if (this.data.loading) this.setData({ loading: false })
        },
        timeupdate: () => {
          if (!this._alive || this._stopRequested) return
          // 曲末前无缝回环：不进 ended、不换 src，保住微信悬浮音符（见 player-state.seamlessLoop）
          playerState.seamlessLoop(this._audio)
        },
        stop: () => {
          if (!this._alive) return
          this.disarmLoadingGuard()
          const stoppedByUser = this._stopRequested
          this._stopRequested = false
          storage.patchMeta({ lastTrackPlaying: false })
          this.setData({ playing: false, loading: false })
          if (stoppedByUser) {
            this.setData({ currentId: '', currentTitle: '', playerSub: '' })
          }
          this.syncPlayerText()
        },
        ended: () => {
          if (!this._alive) return
          // now-playing 也注册了 onEnded：同一轮 ended 只让一个组件重播，
          // 否则会重复赋同一个 src 并各自 play()，循环点必然出现重播双写。
          if (!playerState.claimEnded()) return
          // 锁屏期间 JS 可能被挂起；重新播放前先按墙钟检查定时是否已到点。
          // restore 到点时会立刻停音频并清 endAt，之后 shouldStop() 恒 false，
          // 因此还要看“刚刚到点”的时间戳，避免到点后又循环重播。
          audioTimer.restore()
          const expiredAt = audioTimer.lastExpiredAt()
          const justExpired = expiredAt && Date.now() - expiredAt < 2000
          if (audioTimer.shouldStop() || justExpired) {
            this.stopPlayback()
            return
          }
          this.replay()
        },
        error: () => {
          if (!this._alive) return
          this.disarmLoadingGuard()
          if (this._playingFromCache && this._currentTrack) {
            this._playingFromCache = false
            const badUrl = this._currentTrack.url
            // 本地文件损坏后必须失效，否则每次 ended→replay 都会再次命中同一个坏文件，
            // 形成“每轮循环静默卡顿一次”的循环；删除失败时用会话黑名单兜底。
            this._badUrls[badUrl] = true
            cache.remove(badUrl)
            this.refreshCache()
            this.setData({ loading: false })
            // 同一轮错误只允许一个组件执行远程回退；now-playing 已处理过时不要重复赋 src。
            if (playerState.isFallbacking(badUrl)) return
            // 标记“正在回退”，让同时监听的 now-playing 不要把这次错误当终态。
            playerState.markFallback(badUrl)
            storage.patchMeta({ lastTrackActive: true })
            this._audio.src = this._currentTrack.url
            return
          }
          // 终态失败：结束本次会话，和 now-playing 的错误态保持同一口径，
          // 避免入睡页还留着一个点不动的“已暂停”迷你条。
          playerState.clearFallback()
          const app = getApp()
          if (app && app.globalData) app.globalData.audioSession = false
          this.setData({
            currentId: '',
            currentTitle: '',
            currentCategory: '',
            playing: false,
            loading: false,
            playerSub: '',
            timerRemainText: '',
            // 终态失败同样结束这一段会话：定时胶囊复位到“关”
            timerMinutes: 0
          })
          storage.patchMeta({ lastTrackActive: false, lastTrackPlaying: false })
          audioTimer.clear(undefined, true)
          // 播放中可能人在首页/统计页：那边由 now-playing 负责提示，避免双 toast
          if (this._pageVisible) wx.showToast({ title: '音频加载失败', icon: 'none' })
        }
      }
      this._handlers = handlers
      audio.onPlay(handlers.play)
      audio.onPause(handlers.pause)
      audio.onStop(handlers.stop)
      audio.onEnded(handlers.ended)
      audio.onError(handlers.error)
      if (audio.onCanplay) audio.onCanplay(handlers.canplay)
      if (audio.onTimeUpdate) audio.onTimeUpdate(handlers.timeupdate)
    },

    offAudio() {
      const audio = this._audio
      const handlers = this._handlers || {}
      if (audio) {
        const pairs = [
          ['offPlay', 'play'],
          ['offPause', 'pause'],
          ['offStop', 'stop'],
          ['offEnded', 'ended'],
          ['offError', 'error'],
          ['offCanplay', 'canplay'],
          ['offTimeUpdate', 'timeupdate']
        ]
        pairs.forEach((pair) => {
          if (typeof audio[pair[0]] !== 'function') return
          try {
            audio[pair[0]](handlers[pair[1]])
          } catch (e) {}
        })
      }
      this._audio = null
    },

    /** 清掉迷你条/音符的展示态（不动持久化的播放偏好） */
    clearPlayerSurface() {
      this.disarmLoadingGuard()
      if (!this.data.currentId && !this.data.playing && !this.data.loading) return
      this.setData({
        currentId: '',
        currentTitle: '',
        currentCategory: '',
        playing: false,
        loading: false,
        playerSub: '',
        miniExpanded: false,
        collapsed: false,
        collapsing: false
      })
    },

    syncFromAudio() {
      if (!this._audio) return
      this.disarmLoadingGuard()
      const meta = storage.getMeta()
      // 冷启动/进程被杀后 BackgroundAudioManager 没有 src，本进程也没创建过音频会话：
      // 此时 meta 里的 lastTrackPlaying 只是上个进程的残影，不能当成真实播放态，
      // 否则会“显示正在播放但无声”，且点暂停会走进重建音源分支把声音放出来。
      // 判据与 now-playing.sync 保持一致（audioSession 只在本次启动播放过时为 true）。
      const app = getApp()
      const session = !!(app && app.globalData && app.globalData.audioSession)
      if (!this._audio.src && !session) {
        if (meta.lastTrackActive !== false || meta.lastTrackPlaying !== false) {
          storage.patchMeta({ lastTrackActive: false, lastTrackPlaying: false })
        }
        this.clearPlayerSurface()
        return
      }
      const track = meta.lastTrackId && meta.lastTrackActive !== false
        ? this.findTrack(meta.lastTrackId)
        : null
      if (!track) {
        this.clearPlayerSurface()
        return
      }
      // 系统 stop 会清空 src，但会话仍有效；没有 src 时以最后一次播放事件为准
      const playing = this._audio.src ? !this._audio.paused : meta.lastTrackPlaying !== false
      this.setData({
        currentId: track.id,
        currentTitle: track.title,
        currentCategory: track.category || '',
        playing,
        loading: false,
        // 播放中收成音符；已暂停则直接展开播放条，方便继续
        miniExpanded: !playing
      })
      this.syncPlayerText()
    },

    syncPlayerText() {
      const left = audioTimer.remaining()
      const paused = audioTimer.isPaused()
      let timerText = ''
      let liveText = ''
      if (left > 0) {
        const mins = Math.max(1, Math.ceil(left / 60000))
        // 暂停时倒计时是冻结的，不能说“分钟后关闭”，否则会误导用户
        timerText = paused ? '定时剩 ' + mins + ' 分钟' : mins + ' 分钟后关闭'
        liveText = paused ? '剩 ' + mins + ' 分钟 · 已暂停' : '剩 ' + mins + ' 分钟'
      }
      let sub = ''
      if (this.data.currentId) {
        sub = (this.data.playing ? '正在播放' : '已暂停') + (timerText ? ' · ' + timerText : '')
      }
      // audioTimer 每秒 emit 一次；文案未变化时不要 setData
      if (liveText === this.data.timerRemainText && sub === this.data.playerSub) return
      this.setData({ timerRemainText: liveText, playerSub: sub })
    },

    findTrack(id) {
      const list = this.data.tracks
      for (let i = 0; i < list.length; i += 1) {
        if (list[i].id === id) return list[i]
      }
      return null
    },

    /** 命中缓存才返回本地路径；本会话判坏的 URL 一律走远程 */
    peekCached(url) {
      if (!url || this._badUrls[url]) return ''
      return cache.peek(url, this._ttlDays, url)
    },

    play(track, localPath) {
      if (!track.url || track.url.indexOf('https://') !== 0) {
        wx.showToast({ title: '音频地址未配置', icon: 'none' })
        return
      }
      if (!this._audio) {
        wx.showToast({ title: '当前版本不支持后台播放', icon: 'none' })
        return
      }

      this._stopRequested = false
      playerState.clearFallback()
      const app = getApp()
      if (app && app.globalData) app.globalData.audioSession = true
      const cached = localPath || this.peekCached(track.url)
      this._currentTrack = track
      this._playingFromCache = !!cached
      this.clearCollapseTimer()

      this.setData({
        currentId: track.id,
        currentTitle: track.title,
        currentCategory: track.category || '',
        playing: true,
        miniExpanded: false,
        collapsed: false,
        collapsing: false,
        // 源还没加载完；canplay/play 事件到达后清除，避免弱网下误显示“正在播放”
        loading: true
      })
      this.armLoadingGuard()
      this.syncPlayerText()

      this._audio.title = '睡点 · ' + track.title
      this._audio.epname = '环境音'
      this._audio.singer = '睡点'
      this._audio.src = cached || track.url

      const savedMeta = storage.patchMeta({
        lastTrackId: track.id,
        lastTrackTitle: track.title,
        lastTrackCategory: track.category || '',
        lastTrackActive: true,
        lastTrackPlaying: true
      })
      // 存储满时播放本身仍可用，但下次进入无法恢复曲目，必须让用户知道
      if (!savedMeta) wx.showToast({ title: '播放状态保存失败', icon: 'none' })
      events.track('audio_play', track.id)

      this.applyTimerPreference(this.data.timerMinutes)
    },

    /** play() 在部分基础库会同步抛错；失败时回到暂停态，别留下“正在播放”的假状态 */
    safePlay() {
      if (!this._audio) return false
      try {
        this._audio.play()
        return true
      } catch (e) {
        this.disarmLoadingGuard()
        this.setData({ playing: false, loading: false })
        storage.patchMeta({ lastTrackPlaying: false })
        if (this._pageVisible) wx.showToast({ title: '播放失败，请重试', icon: 'none' })
        return false
      }
    },

    replay() {
      // 自然播放结束不应因 onPause/playing 状态先被置 false 而停止循环；
      // 只有用户主动 stop（_stopRequested）才允许中断。
      if (this._stopRequested || !this.data.currentId) return
      if (!this.isUnlocked() && !this.isFreeMode()) {
        this.stopPlayback()
        if (this._pageVisible) wx.showToast({ title: '解锁已到期，重新解锁后继续', icon: 'none' })
        return
      }
      const track = this.findTrack(this.data.currentId)
      if (!track || !this._audio) return
      const cached = this.peekCached(track.url)
      this._playingFromCache = !!cached
      this.setData({ loading: true })
      this.armLoadingGuard()
      this._audio.title = '睡点 · ' + track.title
      this._audio.src = cached || track.url
      // 赋值 src 不会在所有基础库上自动起播；与 now-playing.handleEnded 及
      // togglePlay 正常分支保持同一口径，否则自然播完会静默停住。
      this.safePlay()
    },

    togglePlay() {
      if (!this._audio || !this.data.currentId) return
      const now = Date.now()
      if (now - (this._toggleAt || 0) < TOGGLE_GUARD_MS) return
      this._toggleAt = now
      // 以 BackgroundAudioManager 的真实 paused 为准；不能用 data.playing，
      // 页面隐藏期间系统侧暂停时 data 可能滞后，导致“点暂停没反应”。
      if (!this._audio.paused) {
        this.clearCollapseTimer()
        this.setData({ playing: false, miniExpanded: true, collapsed: false, collapsing: false })
        storage.patchMeta({ lastTrackPlaying: false })
        this._audio.pause()
        audioTimer.pause()
        return
      }

      // 解锁到期后允许暂停，但不允许从迷你条直接续播；必须回入睡页重新解锁。
      if (!this.isUnlocked() && !this.isFreeMode()) {
        this.stopPlayback()
        if (this._pageVisible) wx.showToast({ title: '解锁已到期，重新解锁后继续', icon: 'none' })
        return
      }

      // 系统侧 stop（通知栏/锁屏/被其他音频抢占）后部分基础库会清空 src，
      // 直接 play() 不会重新起播；此时按 replay 的口径重建源。
      if (!this._audio.src) {
        const track = this.findTrack(this.data.currentId)
        if (!track || !track.url) return
        const cached = this.peekCached(track.url)
        this._currentTrack = track
        this._playingFromCache = !!cached
        this.clearCollapseTimer()
        this.setData({ loading: true, playing: true, miniExpanded: false, collapsed: false, collapsing: false })
        this.armLoadingGuard()
        this._audio.title = '睡点 · ' + track.title
        this._audio.epname = '环境音'
        this._audio.singer = '睡点'
        this._audio.src = cached || track.url
        storage.patchMeta({
          lastTrackId: track.id,
          lastTrackTitle: track.title,
          lastTrackCategory: track.category || '',
          lastTrackActive: true,
          lastTrackPlaying: true
        })
        this.applyTimerPreference(this.data.timerMinutes)
        // 系统侧 stop 后重设 src 不会自动起播：必须显式 play，否则首次点击无声、
        // 需要再点一次（与同函数末尾的正常恢复分支一致）。
        this.safePlay()
        return
      }

      this.applyTimerPreference(this.data.timerMinutes)
      storage.patchMeta({ lastTrackPlaying: true })
      this.clearCollapseTimer()
      this.setData({ playing: true, miniExpanded: false, collapsed: false, collapsing: false })
      this.safePlay()
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

    stopPlayback() {
      this._stopRequested = true
      this.disarmLoadingGuard()
      // 停止本次播放即结束这一段会话：定时偏好回到“关”，下次播放需明确重新选择
      audioTimer.clear(undefined, true)
      storage.patchMeta({ lastTrackActive: false, lastTrackPlaying: false })
      const app = getApp()
      if (app && app.globalData) app.globalData.audioSession = false
      this.clearCollapseTimer()
      this.setData({ currentId: '', currentTitle: '', currentCategory: '', playing: false, loading: false, playerSub: '', timerRemainText: '', timerMinutes: 0, miniExpanded: false, collapsed: false, collapsing: false })
      if (this._audio) {
        try {
          this._audio.stop()
        } catch (e) {}
      }
    },

    /* ---------------- 抽屉交互 ---------------- */
    openSheet() {
      // 打开抽屉前再按真实播放器同步一次，避免抽屉里的状态和播放条相互矛盾
      this.syncFromAudio()
      this.clearCollapseTimer()
      tabbar.hide()
      this.setData({ favoriteIds: storage.getFavorites(), miniExpanded: true, collapsed: false, collapsing: false })
      this.refreshUnlock()
      this.refreshCache()
      this.setData({ open: true })
    },

    closeSheet() {
      // 关闭抽屉后，播放中收成绿色音符；暂停时保留播放条方便继续
      this.clearCollapseTimer()
      tabbar.show()
      this.setData({ open: false, miniExpanded: !this.data.playing, collapsed: false, collapsing: false })
    },

    onKeywordInput(event) {
      this.setData({ keyword: event.detail.value || '' }, () => this.applyFilter())
    },

    onClearKeyword() {
      this.setData({ keyword: '' }, () => this.applyFilter())
    },

    onSearchConfirm() {
      if (wx.hideKeyboard) {
        try {
          wx.hideKeyboard()
        } catch (e) {}
      }
    },

    onPickCategory(event) {
      const category = event.currentTarget.dataset.cat
      if (!category || category === this.data.activeCategory) return
      this.setData({ activeCategory: category }, () => this.applyFilter())
    },

    applyFilter() {
      if (!this._alive) return
      const keyword = String(this.data.keyword || '').trim().toLowerCase()
      const category = this.data.activeCategory
      const favorites = this.data.favoriteIds || []
      const list = this.data.tracks
        .filter((track) => {
          if (category === '收藏' && favorites.indexOf(track.id) < 0) return false
          if (category !== '全部' && category !== '收藏' && track.category !== category) return false
          if (!keyword) return true
          return (track.title + ' ' + track.subtitle + ' ' + track.category).toLowerCase().indexOf(keyword) >= 0
        })
        .map((track) =>
          Object.assign({}, track, {
            favorite: favorites.indexOf(track.id) >= 0,
            cached: !!this.peekCached(track.url)
          })
        )
      this.setData({ filteredTracks: list })
    },

    onToggleFavorite(event) {
      const id = event.currentTarget.dataset.id
      if (!id) return
      const favorites = storage.toggleFavorite(id)
      this.setData({ favoriteIds: favorites }, () => this.applyFilter())
    },

    onTrackTap(event) {
      const track = this.findTrack(event.currentTarget.dataset.id)
      if (!track) return

      if (this.data.currentId === track.id) {
        // 当前曲目在解锁到期后也必须重新走解锁，不能靠“点一下”继续播。
        if (!this.isUnlocked() && !this.isFreeMode()) {
          this.stopPlayback()
          this._sheetTrackId = track.id
          this.setData({ sheetShow: true, prepareText: '' })
          return
        }
        this.togglePlay()
        return
      }

      if (!this.isUnlocked() && !this.isFreeMode()) {
        this._sheetTrackId = track.id
        this.setData({ sheetShow: true, prepareText: '' })
        return
      }

      this.play(track)
    },

    onSheetConfirm() {
      if (this.data.unlocking) return
      const track = this.findTrack(this._sheetTrackId)
      if (!track) {
        this.setData({ sheetShow: false })
        wx.showToast({ title: '该声音已下架', icon: 'none' })
        this.refreshCache()
        return
      }
      const seq = (this._unlockSeq || 0) + 1
      this._unlockSeq = seq

      const unlock = this._cfg.unlock || {}
      const ttlMs = (unlock.ttlHours || 24) * 60 * 60 * 1000
      this.setData({ unlocking: true, prepareText: '正在准备音频…' })

      // 广告与下载并行，广告结束时通常已经能从本地缓存秒播
      // 下载只做后台预热，不再阻塞“看完广告立即播放”；弱网下用远程 URL 兜底
      cache
        .ensure(
          track.url,
          (percent) => {
            if (this._alive && this.data.unlocking) {
              this.setData({ prepareText: '缓存中 ' + percent + '%' })
            }
          },
          this._ttlDays
        )
        .catch(() => '')

      this.showAd()
        .then((ok) => {
          if (seq !== this._unlockSeq) return null
          if (!ok) {
            // 用户没看完广告：后台预热下载也要停掉，避免继续占流量/写缓存
            if (track && track.url && cache.cancel) cache.cancel(track.url)
            if (this._alive) this.setData({ unlocking: false, prepareText: '' })
            return null
          }
          return this.finishUnlock(ttlMs)
        })
        .then((finished) => {
          if (finished === null || seq !== this._unlockSeq || !this._alive) return
          // 有效期写入失败时保留“本次会话已解锁”，避免抽屉文案与点击行为互相矛盾。
          if (finished === false) this._sessionUnlocked = true
          const localPath = cache.peek(track.url, this._ttlDays, track.url)
          this.setData({
            sheetShow: false,
            unlocking: false,
            prepareText: '',
            unlocked: this.isUnlocked()
          })
          wx.showToast({
            title: finished === false ? '已解锁（本次有效，重进需重新解锁）' : '已解锁',
            icon: 'none'
          })
          events.track('audio_unlock', track.id)
          this.play(track, localPath || '')
        })
        .catch(() => {
          if (!this._alive || seq !== this._unlockSeq) return
          this.setData({ unlocking: false, prepareText: '' })
          wx.showToast({ title: '解锁失败，请重试', icon: 'none' })
        })
    },

    onSheetCancel() {
      // 广告卡住时也必须能退出；递增 seq 让在途回调失效
      const track = this.findTrack(this._sheetTrackId)
      this._unlockSeq = (this._unlockSeq || 0) + 1
      this._sheetTrackId = ''
      this.setData({ sheetShow: false, unlocking: false, prepareText: '' })
      // 用户没看完广告就取消时，不应继续在后台下载并写入缓存。
      if (track && track.url && cache.cancel) cache.cancel(track.url)
    },

    /* ---------------- 定时 ---------------- */
    /** 定时偏好为 0（默认关）时清掉可能残留的暂停倒计时，不能让它悄悄复活 */
    applyTimerPreference(minutes) {
      if (!this.data.timerEnabled) return
      const value = Number(minutes) || 0
      if (value > 0) audioTimer.arm(value)
      else audioTimer.clear()
    },

    onTimerTap(event) {
      const minutes = Number(event.currentTarget.dataset.value)
      // 页面隐藏期间系统侧暂停/恢复会让 data.playing 滞后，起表判断必须用真实播放器状态
      const playing = !!(this._audio && !this._audio.paused)
      if (minutes === this.data.timerMinutes) {
        // 重复点当前项时，若计时已结束，重新启用；不改变偏好
        if (minutes && playing && !audioTimer.remaining()) {
          audioTimer.start(minutes)
          this.syncPlayerText()
          wx.showToast({ title: minutes + ' 分钟后自动关闭', icon: 'none' })
        }
        return
      }
      this.setData({ timerMinutes: minutes })
      const saved = storage.patchMeta({ audioTimerMinutes: minutes })
      if (!saved) wx.showToast({ title: '定时设置保存失败', icon: 'none' })

      if (!minutes) {
        const wasOn = audioTimer.remaining() > 0
        audioTimer.clear()
        this.syncPlayerText()
        if (wasOn) wx.showToast({ title: '已关闭定时', icon: 'none' })
        return
      }
      if (playing) {
        audioTimer.start(minutes)
        this.syncPlayerText()
        wx.showToast({ title: minutes + ' 分钟后自动关闭', icon: 'none' })
      } else {
        // 未播放/已暂停时只记录偏好，继续播放后再起表，避免暂停时倒计时偷偷走完
        audioTimer.setPreference(minutes)
        this.syncPlayerText()
        wx.showToast({ title: this.data.currentId ? '继续播放后开始计时' : '播放后开始计时', icon: 'none' })
      }
    }
  }
})
