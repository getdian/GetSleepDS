const { getConfig, loadConfig } = require('../../utils/config')
const storage = require('../../utils/storage')
const cache = require('../../utils/audio-cache')
const api = require('../../utils/api')
const { withLogin } = require('../../utils/login')
const ad = require('../../utils/ad')
const events = require('../../utils/events')
const audioTimer = require('../../utils/audio-timer')
const playerState = require('../../utils/player-state')
const audioSession = require('../../utils/audio-session')
const { resolvePlayerSurface, isReallyPlaying } = require('../../utils/player-surface')
const { nextTrackInQueue, nextTrackManual } = require('../../utils/player-queue')
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

/** 配置指纹：用于回前台时判断是否需要重新 apply（避免每 show 都 setData 一遍） */
function configSignature(cfg) {
  if (!cfg) return ''
  const tracks = (cfg.audio || []).map((item) => item.id).join(',')
  const unlock = cfg.unlock || {}
  return [
    cfg.version,
    tracks,
    unlock.mode,
    unlock.adUnitId,
    unlock.ttlHours,
    cfg.degraded ? 'degraded' : 'ok'
  ].join('|')
}

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
    // 抽屉「结束播放」已上膛：3 秒内再点一次才真正停止（防睡前误触）
    stopArmed: false,
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
    timerEnabled: true,
    // 播放模式：single=单曲循环（默认，最简）；favorites=收藏连播
    queueMode: 'single',
    // 「继续上次」：冷启动/重进小程序时一键接着听（不自动播放，避免半夜突然出声）
    resumeLabel: ''
  },

  lifetimes: {
    attached() {
      this._alive = true
      // 等 pageLifetimes.show 再置 true，避免首帧就弹到别的页面上
      this._pageVisible = false
      this._audio = null
      this._cfg = getConfig()
      // 兜底配置（服务端/缓存都没有）的标记：用来区分“后台就是免费模式”
      this._degraded = this._cfg && this._cfg.degraded === true
      this._recovered = false
      this._cfgSig = configSignature(this._cfg)
      this._sheetTrackId = ''
      this._collapseTimer = null
      this._peekTimer = null
      this._stopRequested = false
      this._playingFromCache = false
      this._currentTrack = null
      // 最后一次赋给 BackgroundAudioManager 的 src；onError 不带源标识，
      // 用它判断“这条错误是不是已经切走的旧源迟到的”。
      this._expectSrc = ''
      this._wasUnlocked = false
      // 广告看完了但本地有效期写入失败时，至少保证本次会话可用；
      // 否则抽屉显示“已解锁”、点曲目却重新弹解锁。
      this._sessionUnlocked = false
      this._ttlDays = (this._cfg.cache && this._cfg.cache.ttlDays) || 7
      // 主动播放后的自动缓存：Wi-Fi 立即、移动网络延迟（见 scheduleAutoCache）
      this._netType = ''
      this._autoCacheTimer = null
      if (wx.getNetworkType) {
        wx.getNetworkType({
          success: (res) => {
            this._netType = (res && res.networkType) || ''
          }
        })
      }
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
        // 锁屏/切后台也要巡检：只在页可见时才跑会让整夜播放越过解锁有效期，
        // 回前台才被停掉（权益超期未收口）。refreshUnlock 内部文案未变不 setData。
        if (this._alive) this.refreshUnlock()
      }, 60 * 1000)

      // 定时关闭默认“关”：不跨会话回忆上次档位——旧版本会把默认 60 分钟写进
      // meta.audioTimerMinutes，“回忆旧值”会让默认值失效；有跨进程恢复的
      // 运行中/暂停中倒计时时，按真实状态回显档位。
      this.setData({ timerMinutes: audioTimer.total() || 0 })

      loadConfig(true).then((cfg) => this.applyRemoteConfig(cfg))
    },

    detached() {
      this._alive = false
      this.disarmLoadingGuard()
      this.clearStopArm()
      if (this._collapseTimer) {
        clearTimeout(this._collapseTimer)
        this._collapseTimer = null
      }
      if (this._peekTimer) {
        clearTimeout(this._peekTimer)
        this._peekTimer = null
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
      this.clearAutoCacheTimer()
      clearTimeout(this._waitRetryTimer)
      clearTimeout(this._pauseRetryTimer)
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
        this.setData({ currentId: '', currentTitle: '', currentCategory: '', playing: false, loading: false, playerSub: '', timerRemainText: '', timerMinutes: 0, miniExpanded: false, collapsed: false, collapsing: false, resumeLabel: '' })
      }
      // 从计算器/统计页切回来时以真实 BackgroundAudioManager 状态为准，
      // 不能沿用隐藏前的 playing，否则会出现“已暂停却显示正在播放、点暂停无效”。
      this.syncFromAudio()
      this.syncPlayerText()
      // 隐藏期间解锁可能到期；回前台补一次，避免继续显示“已解锁”
      this.refreshUnlock()
      // tabBar 的显隐由页面 owner 统一负责：这里只保证“抽屉开着时必须隐藏”。
      // 之前 else tabbar.show() 会在结束/补记/编辑面板开着回前台时把 tabBar 翻出来，
      // 而 tabBar 是独立 root，页面遮罩压不住它。
      if (this.data.open) tabbar.hide()
      // 配置自愈：首拉失败时 _cfg 会一直是内置兜底（只有 1 条雨声），
      // 且 tab 页常驻不会重建组件。切回本页时 force 拉一次，
      // 后台改了音轨/解锁时长/文案，下一次回到本页就生效。
      // loadConfig 内部有 3 秒 force 去重，不会在连续切 tab 时放大请求。
      loadConfig(true).then((cfg) => {
        if (!cfg || configSignature(cfg) === this._cfgSig) return
        this.applyRemoteConfig(cfg)
      })
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
        // 超时前已实际起播：不能判失败（play 事件可能丢失）
        if (isReallyPlaying(this._audio)) {
          this.setData({ playing: true, loading: false })
          return
        }
        // 12s 还没起播：不能只改文案而留下 playing=true 的绿音符。
        // 复位播放态 + 展开播放条，让「连接超时，点按重试」可见且控件回到“播放”图标。
        this.setData({
          playing: false,
          loading: false,
          miniExpanded: true,
          playerSub: '连接超时，点按重试'
        })
        storage.patchMeta({ lastTrackPlaying: false })
        audioSession.onPlayFailed()
        try {
          if (this._audio) this._audio.pause()
        } catch (e) {}
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
      // meta 只读一次：setData 里连写三次 getMeta 会做三次 Storage 读取
      const meta = storage.getMeta()
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
        queueMode: meta.audioQueueMode === 'favorites' ? 'favorites' : 'single',
        resumeLabel:
          meta.lastTrackActive !== false && meta.lastTrackId
            ? meta.lastTrackTitle || '上次的环境音'
            : '',
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
        cacheText: '已缓存 ' + count + '/' + tracks.length + ' 首 · 占用 ' + mb + ' MB'
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
        const trackId = this.data.currentId || 'unknown'
        if (result === 'skipped') {
          events.track('audio_unlock_fail', 'skipped|' + trackId)
          wx.showToast({ title: '视频没看完，先不解锁', icon: 'none' })
          return false
        }
        if (result === 'busy') {
          events.track('audio_unlock_fail', 'busy|' + trackId)
          wx.showToast({ title: '广告正在播放，请稍后再试', icon: 'none' })
          return false
        }
        if (result === 'error' || result === 'unavailable') {
          // onAdError=grant 时仍放行，但必须留下失败原因：
          // 否则后台只能看到 audio_unlock 成功数，无法判断真实填充/加载质量。
          events.track('audio_unlock_fail', result + '|' + trackId)
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
          // 系统侧恢复（通知栏/锁屏/耳机）也要过权益校验：到期后不能靠系统控件续播。
          if (!this.isUnlocked() && !this.isFreeMode()) {
            try {
              this._audio.pause()
            } catch (e) {}
            storage.patchMeta({ lastTrackPlaying: false })
            this.setData({ playing: false, loading: false })
            if (this._pageVisible) {
              wx.showToast({ title: '解锁已到期，重新解锁后继续', icon: 'none' })
            }
            return
          }
          this.disarmLoadingGuard()
          // 真正起播：清掉缓冲标记与重试定时器
          this._waitingAt = 0
          this._pauseRetry = 0
          clearTimeout(this._waitRetryTimer)
          clearTimeout(this._pauseRetryTimer)
          playerState.clearFallback()
          // 任何来源的起播都算会话存活（含系统通知栏/锁屏续播）
          audioSession.onPlay()
          storage.patchMeta({ lastTrackPlaying: true })
          this.setData({ playing: true, loading: false })
          // 系统侧恢复（通知栏/锁屏/耳机）与首次起播都走这里：
          // 暂停事件已冻结倒计时，这里续剩余；没有运行中的倒计时才按本会话已明确
          // 选择的档位起表（默认“关”= 不起表，不跨会话回忆旧档位）。
          this.applyTimerPreference(this.data.timerMinutes)
          // 后台/锁屏时 onTimeUpdate 不再回调，回环点改由定时器兜底
          playerState.armLoop(this._audio)
          this.syncPlayerText()
        },
        pause: () => {
          if (!this._alive) return
          // BAM 缓冲时会自动 pause：这不是用户暂停，不能冻结定时、也不能收成“已暂停”条，
          // 否则弱网首播会表现为“刚点播放就暂停，定时也停了”。
          const buffering = Date.now() - (this._waitingAt || 0) < 30 * 1000
          const userPaused = audioSession.isUserPaused()
          this.disarmLoadingGuard()
          // 缓冲期内且不是用户暂停：保持“连接中”，3s 后补一次 play（最多 2 次）。
          // 没有这一层时，真机上点新歌播几秒被缓冲打断，会直接停在“已暂停，点击继续”。
          const retry =
            buffering && !userPaused && !this._stopRequested && !!this.data.currentId && (this._pauseRetry || 0) < 2
          if (retry) {
            this._pauseRetry = (this._pauseRetry || 0) + 1
            this.setData({ playing: false, loading: true, miniExpanded: true })
            this.armLoadingGuard()
            this.syncPlayerText()
            clearTimeout(this._pauseRetryTimer)
            this._pauseRetryTimer = setTimeout(() => {
              if (!this._alive || this._stopRequested) return
              if (isReallyPlaying(this._audio)) return
              this.safePlay()
            }, 3000)
            return
          }
          if (buffering) this.armLoadingGuard()
          else audioTimer.pause()
          // 只有用户在小程序内暂停才阻止自动恢复；来电/其他 App 造成的暂停留给
          // 中断结束或回前台续播（audio-session 内部判定）
          audioSession.onPause()
          storage.patchMeta({ lastTrackPlaying: false })
          this.setData({
            playing: false,
            loading: buffering || this.data.loading,
            miniExpanded: !buffering
          })
          this.syncPlayerText()
        },
        waiting: () => {
          if (!this._alive || this._stopRequested) return
          // 音频加载中（弱网/首次播放）：只进“连接中”，**不要**把 playing 置 false。
          // BAM 缓冲时经常只发 waiting、不再补发 play，置 false 会让正在播放的音频
          // 一直显示“已暂停”（实机/模拟器均复现）。
          this._waitingAt = Date.now()
          this.setData({ loading: true })
          this.armLoadingGuard()
          this.syncPlayerText()
          clearTimeout(this._waitRetryTimer)
          this._waitRetryTimer = setTimeout(() => {
            if (!this._alive || !this._audio || this._stopRequested) return
            if (!this.data.currentId) return
            if (isReallyPlaying(this._audio)) {
              // 实际已在播，只是 play 事件没到：以真实状态为准自愈
              this.setData({ playing: true, loading: false })
              return
            }
            // 个别基础库缓冲结束后不自动续播：补一次 play
            this.safePlay()
          }, 4000)
        },
        canplay: () => {
          if (!this._alive) return
          this.disarmLoadingGuard()
          // canplay 比 play 事件更可靠：部分基础库起播时不补发 play。
          // 以播放器真实状态自愈，避免“声音在播、UI 显示已暂停”。
          const live = isReallyPlaying(this._audio)
          if (this.data.loading || (live && !this.data.playing)) {
            this.setData({ loading: false, playing: live || this.data.playing })
          }
          playerState.armLoop(this._audio)
        },
        timeupdate: () => {
          if (!this._alive || this._stopRequested) return
          // 无缝回环绕过 onEnded，而 60s 的 refreshUnlock 只在页面可见时跑；
          // 低频复检一次权益，避免切到首页/统计页后“看一次广告播整夜”。
          const now = Date.now()
          if (now - (this._entitlementAt || 0) > 15000) {
            this._entitlementAt = now
            if (this.data.currentId && !this.isUnlocked() && !this.isFreeMode()) {
              // 从“配置没拉到”的免费兜底恢复到真实配置时，用户并没有做过到期操作，
              // 不能报“解锁已到期”（会让人以为广告白看了）。
              const title = this._recovered
                ? '网络已恢复，解锁后可继续播放'
                : '解锁已到期，重新解锁后继续'
              this.stopPlayback()
              if (this._pageVisible) wx.showToast({ title, icon: 'none' })
              return
            }
          }
          // 曲末前无缝回环：不进 ended、不换 src，保住微信悬浮音符（见 player-state.seamlessLoop）
          playerState.seamlessLoop(this._audio)
          // 前台每秒校准回环定时器；锁屏后没有 timeupdate 时由它独立兜底
          playerState.armLoop(this._audio)
        },
        stop: () => {
          if (!this._alive) return
          this.disarmLoadingGuard()
          const stoppedByUser = this._stopRequested
          this._stopRequested = false
          // 系统 stop（浮窗 X / 系统回收）不结束会话，只取消“应继续播放”的意图：
          // 迷你条继续以“已暂停”显示，与需求「只有小程序内停止才消失」一致。
          audioSession.onStop()
          storage.patchMeta({ lastTrackPlaying: false })
          this.setData({ playing: false, loading: false })
          if (stoppedByUser) {
            this.setData({ currentId: '', currentTitle: '', playerSub: '' })
          }
          this.syncPlayerText()
        },
        ended: () => {
          if (!this._alive) return
          // 会话已被显式终止（用户停止 / 定时到点）：迟到的 ended 不能重新起播。
          // 两个组件监听同一个播放器、派发顺序不保证，先到者必须同样让路。
          if (!audioSession.isActive()) {
            storage.patchMeta({ lastTrackPlaying: false })
            this.setData({ playing: false })
            return
          }
          // now-playing 也注册了 onEnded：同一轮 ended 只让一个组件重播，
          // 否则会重复赋同一个 src 并各自 play()，循环点必然出现重播双写。
          if (!playerState.claimEnded()) return
          // 坏源/极短源可能在 10s 内反复 ended：打满上限后停在“已暂停”，
          // 交给用户手动重试，避免无限重建音源。
          if (!audioSession.allowReplay()) {
            audioSession.onPlayFailed()
            storage.patchMeta({ lastTrackPlaying: false })
            this.setData({ playing: false })
            if (this._pageVisible) wx.showToast({ title: '播放异常，请重新播放', icon: 'none' })
            return
          }
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
          this.advance()
        },
        error: (err) => {
          if (!this._alive) return
          // 切歌/缓存回退竞态：旧源的 onError 可能在新源已经起播后到达，
          // 处理它会把新曲的缓存删掉、甚至把新会话清成空态。
          // 期望源以会话模块为准：自动续播（audio-session.playCurrent）会重设 src，
          // 但组件本地 _expectSrc 仍是旧值；先用本地值会把真实错误当成旧源丢掉。
          const expected = audioSession.getExpectedSrc() || this._expectSrc
          // 没有任何期望源 = 本进程没起过播：无法归属的错误一律不处理，
          // 否则冷启动/旧会话残留的错误会把当前会话误杀。
          if (!expected) return
          if (!playerState.isCurrentSourceError(this._audio && this._audio.src, expected)) {
            return
          }
          // 错误码此前被丢弃，线上无法判断是网络、解码还是文件损坏；
          // 同一轮可能触发多次，1s 内只上报一条（target = trackId|code，服务端 64 字符内）。
          const now = Date.now()
          if (now - (this._lastErrorAt || 0) > 1000) {
            this._lastErrorAt = now
            const code = (err && (err.errCode || err.code)) || 'unknown'
            events.track('audio_error', (this.data.currentId || 'unknown') + '|' + code)
          }
          this.disarmLoadingGuard()
          // 播放器仍在出声：网络/解码类错误可能只是当前分片抖动，底层会自行重连。
          // 这时绝不能清会话——否则会出现“音乐还在播，首页/统计页迷你条已经消失、
          // 入睡页回到空闲态”。只把 loading 收掉，等真实的 pause/stop 再判定。
          if (isReallyPlaying(this._audio)) {
            this.setData({ loading: false })
            return
          }
          // onError 不带 src：刚切歌（<1.5s）的这条错误很可能来自上一个源。
          // 此时不删缓存、不拉黑，只收 loading——否则会把新曲的正常缓存误删。
          if (Date.now() - (this._srcSetAt || 0) < 1500) {
            this.setData({ loading: false })
            return
          }
          if (this._playingFromCache && this._currentTrack) {
            this._playingFromCache = false
            const badUrl = this._currentTrack.url
            // 只有磁盘文件确实不可用才删文件：网络/解码错误时文件本身是好的，
            // 删掉会误伤（切歌竞态下删的还可能是新曲的正常缓存）。
            if (!cache.isUsable(badUrl)) cache.remove(badUrl)
            // 会话内一律不再命中：文件还在也说明这条源播不出来；
            // 用户主动重播（play）时会清掉黑名单，重新验证一次。
            cache.markBad(badUrl)
            this.refreshCache()
            this.setData({ loading: false })
            // 同一轮错误只允许一个组件执行远程回退；now-playing 已处理过时不要重复赋 src。
            if (playerState.isFallbacking(badUrl)) return
            // 标记“正在回退”，让同时监听的 now-playing 不要把这次错误当终态。
            playerState.markFallback(badUrl)
            // 与 play/replay 同口径：赋值 src 不保证自动起播，且要重新挂 loading 兜底，
            // 否则回退远程后可能停在“正在连接”直到 12s 超时。
            this.armLoadingGuard()
            this.setAudioSrc(this._currentTrack.url)
            this.safePlay()
            return
          }
          // 终态失败：**保留会话**，迷你条以“已暂停”留在三个页面，用户可点按重试。
          // 只有用户主动停止（stopPlayback）才允许移除入口，外部原因不算停止。
          playerState.clearFallback()
          audioSession.onPlayFailed()
          this.setData({ playing: false, loading: false })
          storage.patchMeta({ lastTrackPlaying: false })
          // 失败后冻结倒计时：否则到点时会 stopAudio()，把“用户没停”变成业务终止
          audioTimer.pause()
          // 播放中可能人在首页/统计页：那边由 now-playing 负责提示，避免双 toast
          if (this._pageVisible) wx.showToast({ title: '音频加载失败，点按重试', icon: 'none' })
        }
      }
      this._handlers = handlers
      audio.onPlay(handlers.play)
      audio.onPause(handlers.pause)
      audio.onStop(handlers.stop)
      audio.onEnded(handlers.ended)
      audio.onError(handlers.error)
      if (audio.onWaiting) audio.onWaiting(handlers.waiting)
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

    /**
     * 应用一次远程配置（首次拉取与回前台自愈共用）。
     * - 曲目被运营下架时结束当前会话，避免继续播一个已不在清单里的源；
     * - 从兜底配置恢复到真实配置时记下 _recovered，供权益中断文案区分原因。
     */
    applyRemoteConfig(cfg) {
      if (!this._alive || !cfg) return
      const wasDegraded = this._degraded === true
      this._cfg = cfg
      this._degraded = cfg.degraded === true
      this._cfgSig = configSignature(cfg)
      if (wasDegraded && !this._degraded) this._recovered = true
      this.applyConfig(cfg)
      ad.init(cfg.unlock && cfg.unlock.adUnitId)
      // findTrack 读的是 applyConfig 之后的新 tracks
      if (this.data.currentId && !this.findTrack(this.data.currentId)) {
        this.stopPlayback()
      } else {
        this.syncFromAudio()
      }
      if (this.isUnlocked() && cfg.features && cfg.features.preload) {
        cache.warmup(this.data.tracks, cfg.cache, true)
      }
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
      const surface = resolvePlayerSurface({
        lastTrackId: meta.lastTrackId,
        lastTrackActive: meta.lastTrackActive,
        lastTrackPlaying: meta.lastTrackPlaying,
        hasSrc: !!this._audio.src,
        // 必须严格 false 才算在播：BAM 无 src 时 paused 是 undefined，!paused 会是 true
        playingNow: !!this._audio.src && this._audio.paused === false,
        sessionLive: !!(app && app.globalData && app.globalData.audioSession)
      })
      if (!surface.visible) {
        this.clearPlayerSurface()
        return
      }
      // 冷启动/悬浮 X 停止后：只归零播放态，保留会话让用户能接着听
      if (surface.cold && meta.lastTrackPlaying !== false) {
        storage.patchMeta({ lastTrackPlaying: false })
      }
      const track = this.findTrack(meta.lastTrackId)
      if (!track) {
        // 音源已在后台下架：属于业务终止，可以收会话
        audioSession.markStopped()
        this.clearPlayerSurface()
        return
      }
      const playing = surface.playing
      this.setData({
        currentId: track.id,
        currentTitle: track.title,
        currentCategory: track.category || '',
        playing,
        loading: false,
        // 已经有当前曲目时不再显示「继续上次」：否则与上方播放条重复讲同一首
        resumeLabel: '',
        // 播放中收成音符（除非用户把条钉开）；已暂停则直接展开播放条，方便继续
        miniExpanded: !playing || this.expandedPreferred()
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

    /** 命中缓存才返回本地路径；坏源黑名单由 audio-cache 统一维护（peek 会跳过） */
    peekCached(url) {
      if (!url) return ''
      return cache.peek(url, this._ttlDays, url)
    },

    clearAutoCacheTimer() {
      if (this._autoCacheTimer) {
        clearTimeout(this._autoCacheTimer)
        this._autoCacheTimer = null
      }
    },

    /**
     * 用户主动播放后的自动缓存。
     * 小程序无法复用 BackgroundAudioManager 的流缓存，所以首次会与流式播放并行
     * （约多耗 1 倍流量），换来之后每次播放都走本地、不再重复下载；
     * 移动网络延迟 20s，避免“点开听两秒”也下整首。
     */
    scheduleAutoCache(track) {
      this.clearAutoCacheTimer()
      if (!this._alive || !track || !track.url) return
      if (cache.peek(track.url, this._ttlDays, track.url)) return
      const url = track.url
      const trackId = track.id
      const arm = (netType) => {
        // getNetworkType 是异步的：回调到来前用户可能已停止/切歌（stopPlayback 会清 currentId）
        if (!this._alive || this.data.currentId !== trackId) return
        // 离线时不排队；网络类型按“此刻”取：挂载时的快照在 Wi-Fi→4G 后会误判为立即下载
        if (netType === 'none') return
        this.clearAutoCacheTimer()
        this._autoCacheTimer = setTimeout(() => {
          this._autoCacheTimer = null
          if (!this._alive) return
          // 容量上限此前只靠每天一次 maybePrune 收敛；自动缓存不能把占用推过 maxMB
          if (!cache.canAutoCache(this._cfg && this._cfg.cache)) return
          cache.ensure(url, null, this._ttlDays).catch(() => {})
        }, cache.autoCacheDelay(netType))
      }
      if (!wx.getNetworkType) {
        arm(this._netType)
        return
      }
      wx.getNetworkType({
        success: (res) => {
          this._netType = (res && res.networkType) || ''
          arm(this._netType)
        },
        fail: () => arm(this._netType)
      })
    },

    /**
     * 统一设置音源并记录“最后一次赋值的 src”。
     * 必须走这里：切歌/缓存回退/重建源三处若直接赋 src，onError 就无从判断旧源。
     */
    setAudioSrc(url) {
      const next = url || ''
      this._expectSrc = next
      // 记录赋值时刻：onError 不带 src，用它识别“切歌后迟到的旧源错误”
      this._srcSetAt = Date.now()
      // 会话模块也记一份：now-playing 在别的页面可能没有本地期望源，
      // onError 时用它判断“这条错误是不是已经切走的旧源”。
      audioSession.setExpectedSrc(next)
      if (this._audio) this._audio.src = next
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
      // 到期后不允许从任何入口（锁屏恢复/跨页/程序化）重新起播；
      // 与 now-playing.handlePlay 同一口径，避免“到期但还能续播”的权益漏洞。
      if (!this.isUnlocked() && !this.isFreeMode()) {
        this.stopPlayback()
        if (this._pageVisible) wx.showToast({ title: '解锁已到期，重新解锁后继续', icon: 'none' })
        return
      }

      this.clearStopArm()
      this._stopRequested = false
      // 新一轮起播：清掉上一轮的缓冲标记与重试定时器
      this._waitingAt = 0
      clearTimeout(this._waitRetryTimer)
      playerState.clearFallback()
      // 用户在应用内主动起播：允许后续中断自动恢复
      audioSession.markUserPlay()
      // 用户主动点播即视为重试：必须先清黑名单再取缓存，
      // 否则上一轮播放失败拉黑后，这次即使文件已下载好也仍走远程。
      cache.clearBad(track.url)
      const cached = localPath || this.peekCached(track.url)
      this._currentTrack = track
      this._playingFromCache = !!cached
      this.clearCollapseTimer()

      this.setData({
        currentId: track.id,
        currentTitle: track.title,
        currentCategory: track.category || '',
        playing: true,
        // 自动连播（advance）不该弹条：只按用户的“记忆展开”偏好决定
        miniExpanded: this.expandedPreferred(),
        collapsed: false,
        collapsing: false,
        // 已经在播了，不再显示「继续上次」
        resumeLabel: '',
        // 源还没加载完；canplay/play 事件到达后清除，避免弱网下误显示“正在播放”
        loading: true
      })
      this.armLoadingGuard()
      this.syncPlayerText()

      this._audio.title = '睡点 · ' + track.title
      this._audio.epname = '环境音'
      this._audio.singer = '睡点'
      this.setAudioSrc(cached || track.url)
      // 与 replay / togglePlay 同口径：赋值 src 不保证自动起播，补一次 play()，
      // 避免少数基础库停在「正在连接音频…」直到 12s 超时。
      this.safePlay()

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
      // 播放即排队缓存：移动网络等 20s（避免试听浪费），Wi-Fi 等 8s 让首播先稳
      this.scheduleAutoCache(track)

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
        audioSession.onPlayFailed()
        if (this._pageVisible) wx.showToast({ title: '播放失败，请重试', icon: 'none' })
        return false
      }
    },

    replay() {
      // 自然播放结束不应因 onPause/playing 状态先被置 false 而停止循环；
      // 只有用户主动 stop（_stopRequested）才允许中断。
      // 会话已被显式终止时同样不再续播（ended 迟到 / 定时到点后的事件）。
      if (this._stopRequested || !this.data.currentId || !audioSession.isActive()) return
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
      // 回环续播必须重新确认会话存活：上一轮如果被 onError/restore 误清，
      // 这里只重建音源会让“音乐在播但迷你条没了”延续下去。
      // 注意用 markAutoReplay：自动续播不能清空回环限流预算（否则 8 次上限永远打不满）。
      audioSession.markAutoReplay()
      storage.patchMeta({ lastTrackActive: true, lastTrackPlaying: true })
      this.setAudioSrc(cached || track.url)
      // 赋值 src 不会在所有基础库上自动起播；与 now-playing.handleEnded 及
      // togglePlay 正常分支保持同一口径，否则自然播完会静默停住。
      this.safePlay()
    },

    /**
     * 曲末推进：默认单曲循环；收藏连播模式下取下一首收藏。
     * 明确不做“全列表自动顺序播放”——睡前场景半夜换音色容易吵醒，
     * 想听别的由用户主动选。
     */
    advance() {
      const next = this.nextInQueue()
      if (next) {
        this.play(next)
        return
      }
      this.replay()
    },

    nextInQueue() {
      return nextTrackInQueue(
        this.data.tracks,
        this.data.currentId,
        storage.getFavorites(),
        storage.getMeta().audioQueueMode
      )
    },

    /**
     * 迷你条「下一首」：与跨页迷你条同一套候选（收藏连播优先，其余列表循环）。
     * 切歌必须走 play()：meta、缓存、埋点、定时偏好都在那里收口，避免两个入口两套行为。
     */
    onNextTap() {
      const meta = storage.getMeta()
      const track = nextTrackManual(
        this.data.tracks,
        this.data.currentId || meta.lastTrackId,
        storage.getFavorites(),
        meta.audioQueueMode
      )
      if (!track) {
        wx.showToast({ title: '只有一个音源', icon: 'none' })
        return
      }
      this.play(track)
      // 手动切歌才亮相：自动连播（advance）仍保持音符，避免半夜自己弹出播放条
      if (!this.expandedPreferred()) this.setData({ miniExpanded: true, collapsed: false })
      this.peekMiniBar()
    },

    onToggleQueueMode() {
      const favorites = storage.getFavorites() || []
      const next = this.data.queueMode === 'favorites' ? 'single' : 'favorites'
      if (next === 'favorites' && favorites.length < 2) {
        wx.showToast({ title: '至少收藏 2 首才能连播', icon: 'none' })
        return
      }
      storage.patchMeta({ audioQueueMode: next })
      this.setData({ queueMode: next })
      wx.showToast({
        title: next === 'favorites' ? '收藏连播：播完自动下一首' : '单曲循环',
        icon: 'none'
      })
    },

    /** 继续上次：冷启动/重进小程序时一键接着听（不自动播放） */
    onResumeLast() {
      const id = storage.getMeta().lastTrackId
      const track = id && this.findTrack(id)
      if (!track) {
        wx.showToast({ title: '这首已下架，换一首吧', icon: 'none' })
        this.setData({ resumeLabel: '' })
        return
      }
      if (!this.isUnlocked() && !this.isFreeMode()) {
        this._sheetTrackId = track.id
        this.setData({ sheetShow: true, prepareText: '' })
        return
      }
      this.play(track)
    },

    /** 点 ⤓：删除这首的缓存（不喜欢的、占空间的），不影响其它已缓存音源 */
    onRemoveCacheTap(event) {
      const id = event.currentTarget.dataset.id
      const track = this.findTrack(id)
      if (!track) return
      this.confirmRemoveCache(track)
    },

    /** 长按曲目：与点 ⤓ 同一套确认口径 */
    onTrackLongPress(event) {
      const id = event.currentTarget.dataset.id
      const track = this.findTrack(id)
      if (!track) return
      this.confirmRemoveCache(track)
    },

    confirmRemoveCache(track) {
      const size = cache.sizeOf(track.url)
      if (!size) {
        wx.showToast({ title: '这首还没缓存', icon: 'none' })
        return
      }
      if (this.data.currentId === track.id && (this.data.loading || this.data.playing)) {
        wx.showToast({ title: '正在播放，先切歌再删除', icon: 'none' })
        return
      }
      const mb = (size / 1024 / 1024).toFixed(1)
      wx.showModal({
        title: '删除这首的缓存？',
        content: track.title + '（' + mb + ' MB）将从本机移除，下次播放需要重新下载。',
        confirmText: '删除',
        confirmColor: '#F87171',
        success: (res) => {
          if (!res.confirm) return
          cache.remove(track.url)
          this.refreshCache()
          wx.showToast({ title: '已删除该曲缓存', icon: 'none' })
        }
      })
    },

    togglePlay() {
      if (!this._audio || !this.data.currentId) return
      const now = Date.now()
      if (now - (this._toggleAt || 0) < TOGGLE_GUARD_MS) return
      this._toggleAt = now
      // 以 BackgroundAudioManager 的真实 paused 为准；不能用 data.playing，
      // 页面隐藏期间系统侧暂停时 data 可能滞后，导致“点暂停没反应”。
      if (isReallyPlaying(this._audio)) {
        this.clearCollapseTimer()
        this.setData({ playing: false, miniExpanded: true, collapsed: false, collapsing: false })
        storage.patchMeta({ lastTrackPlaying: false })
        // 小程序内主动暂停：唯一不允许中断结束后自动恢复的暂停来源
        audioSession.markUserPause()
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
        this.setData({ loading: true, playing: true, miniExpanded: true, collapsed: false, collapsing: false })
        this.armLoadingGuard()
        this._audio.title = '睡点 · ' + track.title
        this._audio.epname = '环境音'
        this._audio.singer = '睡点'
        audioSession.markUserPlay()
        this.setAudioSrc(cached || track.url)
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
        this.peekMiniBar()
        return
      }

      this.applyTimerPreference(this.data.timerMinutes)
      storage.patchMeta({ lastTrackPlaying: true })
      audioSession.markUserPlay()
      this.clearCollapseTimer()
      this.setData({ playing: true, miniExpanded: true, collapsed: false, collapsing: false })
      this.safePlay()
      this.peekMiniBar()
    },

    /**
     * 跨页“记忆展开”：与 now-playing 共用 app.globalData.playerBarExpanded。
     * 用户在任一页把播放条点开，另外两页也保持展开；点外部收起则三页一起收。
     */
    expandedPreferred() {
      const app = getApp()
      return !!(app && app.globalData && app.globalData.playerBarExpanded)
    },

    rememberExpanded(value) {
      const app = getApp()
      if (app && app.globalData) app.globalData.playerBarExpanded = !!value
    },

    expandMini() {
      clearTimeout(this._peekTimer)
      this._peekTimer = null
      this.clearCollapseTimer()
      this.rememberExpanded(true)
      this.setData({ miniExpanded: true, collapsed: false, collapsing: false })
    },

    /**
     * 手动切歌/续播后让迷你条停留 3 秒，避免刚点完控件就缩成音符。
     * 到点只收形态、不标记“用户折叠”；用户已把条钉开时不再自动收。
     */
    peekMiniBar() {
      clearTimeout(this._peekTimer)
      if (this.expandedPreferred()) return
      this._peekTimer = setTimeout(() => {
        this._peekTimer = null
        if (!this._alive || !this.data.playing || !this.data.miniExpanded) return
        if (this.data.loading) return
        this.clearCollapseTimer()
        this.setData({ collapsing: true })
        this._collapseTimer = setTimeout(() => {
          this._collapseTimer = null
          if (this._alive) this.setData({ collapsing: false, miniExpanded: false })
        }, 210)
      }, 3000)
    },

    clearCollapseTimer() {
      if (this._collapseTimer) {
        clearTimeout(this._collapseTimer)
        this._collapseTimer = null
      }
    },

    /** 点击播放条外部：向右收缩回音符，不停止播放（这次收起算用户手动折叠） */
    collapseMini() {
      clearTimeout(this._peekTimer)
      this._peekTimer = null
      this.rememberExpanded(false)
      if (this.data.collapsed || this.data.collapsing) return
      this.clearCollapseTimer()
      this.setData({ collapsing: true })
      this._collapseTimer = setTimeout(() => {
        this._collapseTimer = null
        if (!this._alive) return
        this.setData({ collapsing: false, miniExpanded: false, collapsed: true })
      }, 210)
    },

    /**
     * 抽屉「结束播放」二次确认：首点只上膛 3 秒，再点才真正停止。
     * 睡前误触一次就整夜没声音，停止必须比播放更难触发。
     */
    requestStop() {
      if (this._stopArmTimer) {
        this.stopPlayback()
        return
      }
      if (this._alive) this.setData({ stopArmed: true })
      wx.showToast({ title: '再点一次结束播放', icon: 'none', duration: 1500 })
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

    stopPlayback() {
      this.clearStopArm()
      this._stopRequested = true
      this._waitingAt = 0
      this._pauseRetry = 0
      clearTimeout(this._waitRetryTimer)
      clearTimeout(this._pauseRetryTimer)
      this.disarmLoadingGuard()
      // 停止本次播放即结束这一段会话：定时偏好回到“关”，下次播放需明确重新选择
      audioTimer.clear(undefined, true)
      // 用户主动停止：清会话 + 关闭自动恢复意图（audio-session 是唯一写入口径）
      audioSession.markStopped()
      this.clearCollapseTimer()
      // 主动停止后不再启动新的后台缓存；已开始的下载保留（下次可命中）
      this.clearAutoCacheTimer()
      this.setData({ currentId: '', currentTitle: '', currentCategory: '', playing: false, loading: false, playerSub: '', timerRemainText: '', timerMinutes: 0, miniExpanded: false, collapsed: false, collapsing: false, resumeLabel: '' })
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
      this.clearStopArm()
      this.clearCollapseTimer()
      tabbar.show()
      this.setData({ open: false, miniExpanded: !this.data.playing, collapsed: false, collapsing: false })
      // 入睡页据此恢复“30s 无操作熄灯”：抽屉打开期间到点的熄灯会被跳过，
      // 若不在关闭时重排，睡前会一直亮屏（组件与页面是唯一的一组宿主关系）。
      this.triggerEvent('sheetclose')
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
      const playing = isReallyPlaying(this._audio)
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
