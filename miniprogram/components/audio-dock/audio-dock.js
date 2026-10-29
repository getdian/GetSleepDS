const { getConfig, loadConfig } = require('../../utils/config')
const storage = require('../../utils/storage')
const cache = require('../../utils/audio-cache')
const api = require('../../utils/api')
const { withLogin } = require('../../utils/login')
const ad = require('../../utils/ad')
const events = require('../../utils/events')
const audioTimer = require('../../utils/audio-timer')
const player = require('../../utils/audio-player')
const { isReallyPlaying } = require('../../utils/player-surface')
const favCounts = require('../../utils/audio-favorites')
const tabbar = require('../../utils/tabbar')

const ICONS = ['rain', 'wave', 'fire', 'noise', 'night']
// 播放器只发 code，文案留在视图层（同一事件在两个页面可以有不同说法）
const PLAYER_NOTICES = {
  expired: '解锁已到期，重新解锁后继续',
  network_back: '网络已恢复，解锁后可继续播放',
  play_failed: '播放失败，请重试',
  load_timeout: '连接超时，点按重试',
  audio_failed: '音频加载失败，点按重试',
  replay_limited: '播放异常，请重新播放',
  timer_stop: '定时结束，已停止播放',
  only_one_track: '只有一个音源',
  bad_url: '音频地址未配置',
  unsupported: '当前版本不支持后台播放',
  meta_save_failed: '播放状态保存失败'
}
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
  // 带上人气基数：后台改了收藏数也要触发 applyConfig，否则回前台时列表数字是旧的
  const tracks = (cfg.audio || []).map((item) => item.id + ':' + (Number(item.favBase) || 0)).join(',')
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
      this._reconcileTimer = null
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
      // 播放器按同一档位起表：它负责起播时的定时偏好，UI 只是回显
      player.setTimerMinutes(audioTimer.total() || 0)

      loadConfig(true).then((cfg) => this.applyRemoteConfig(cfg))
    },

    detached() {
      this._alive = false
      this.clearStopArm()
      if (this._collapseTimer) {
        clearTimeout(this._collapseTimer)
        this._collapseTimer = null
      }
      if (this._peekTimer) {
        clearTimeout(this._peekTimer)
        this._peekTimer = null
      }
      if (this._reconcileTimer) {
        clearTimeout(this._reconcileTimer)
        this._reconcileTimer = null
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
      // 系统/会话层续播可能比本页 show 晚一拍：800ms 后按真实状态再对一次账
      this.scheduleReconcile()
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

    applyConfig(cfg) {
      // 展示值 = 当前配置基数 + 服务端真实收藏（_realFavs 由 refreshFavCounts 维护）。
      // 不用旧展示值兜底：运营调低/调高基数都要立刻生效，不能被旧值压住。
      const tracks = favCounts.withRealCounts(
        (cfg.audio || []).map((item) => {
          const iconKey = ICONS.indexOf(item.icon) >= 0 ? item.icon : 'noise'
          return {
            id: item.id,
            title: item.title || '环境音',
            subtitle: item.subtitle || '循环播放 · 支持锁屏',
            category: item.category || '环境音',
            tone: toneOf(item.category || '环境音'),
            url: item.url,
            icon: '/assets/icon-' + iconKey + '.png',
            favBase: Math.max(0, Math.floor(Number(item.favBase) || 0))
          }
        }),
        this._realFavs
      )
      // 排序快照只在配置/统计变更时重建：点 ♥ 只改数字，列表位置不动
      this._rankCounts = favCounts.rankOf(tracks)

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
    /** 缓存状态只体现在每行的 ↓ 标记上，不再有汇总文案与整库清理入口 */
    refreshCache() {
      if (!this._alive) return
      this.applyFilter()
    },

    /* ---------------- 收藏人数 ---------------- */
    /**
     * 拉取真实收藏数 real（不含后台基数）。失败静默保留现有值：
     * 统计是锦上添花，不能因为一次网络抖动让列表文案变成 0 人。
     */
    refreshFavCounts() {
      if (!this._alive || this._favLoading) return
      this._favLoading = true
      api.fetchAudioFavorites().then(
        (res) => {
          this._favLoading = false
          if (!this._alive) return
          const real = {}
          const source = (res && res.real) || {}
          Object.keys(source).forEach((id) => {
            const value = Number(source[id])
            if (Number.isFinite(value) && value >= 0) real[id] = value
          })
          this._realFavs = real
          this.rebuildFavCounts()
        },
        () => {
          this._favLoading = false
        }
      )
    },

    /** 展示值 = 后台基数 + 真实收藏；配置或计数任一变化都走这里重算并重建排序快照 */
    rebuildFavCounts() {
      if (!this._alive) return
      const tracks = favCounts.withRealCounts(this.data.tracks, this._realFavs)
      this._rankCounts = favCounts.rankOf(tracks)
      this.setData({ tracks }, () => this.applyFilter())
    },

    /** 收藏上报返回的是该曲目的真实数（不含基数），更新后重算展示值 */
    patchFavCount(id, real) {
      if (!this._alive) return
      const value = Math.max(0, Math.floor(Number(real) || 0))
      this._realFavs = Object.assign({}, this._realFavs || {}, { [id]: value })
      this.rebuildFavCounts()
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
    /**
     * 播放器由 audio-player 统一持有并注册事件；这里只订阅 snapshot。
     * 组件卸载不注销事件（跨页播放要继续），只解除本视图的订阅。
     */
    setupAudio() {
      this._audio = player.audio()
      if (!this._audio) return
      this._unsubPlayer = player.subscribe((view) => this.applyPlayerState(view))
      player.init({
        notice: (code) => this.handlePlayerNotice(code),
        timerMinutes: Number(this.data.timerMinutes) || 0
      })
    },

    /** 把 snapshot 落到 data：只写变化的键，避免逐秒整块 setData */
    applyPlayerState(view) {
      if (!this._alive) return
      const patch = {}
      if (this.data.playing !== view.playing) patch.playing = view.playing
      if (this.data.loading !== view.loading) patch.loading = view.loading
      if (this.data.currentId !== view.currentId) patch.currentId = view.currentId
      if (this.data.currentTitle !== view.currentTitle) patch.currentTitle = view.currentTitle
      if (this.data.currentCategory !== view.currentCategory) patch.currentCategory = view.currentCategory
      if (!view.currentId) {
        patch.playerSub = ''
        patch.timerRemainText = ''
      }
      if (Object.keys(patch).length) this.setData(patch)
      this.syncPlayerText()
    },

    /** 播放器事件产生的提示：文案留在视图层，播放器只发 code */
    handlePlayerNotice(code) {
      const text = PLAYER_NOTICES[code]
      if (!text || !this._pageVisible || !this._alive) return
      wx.showToast({ title: text, icon: 'none' })
    },

    offAudio() {
      if (this._unsubPlayer) {
        this._unsubPlayer()
        this._unsubPlayer = null
      }
      this._audio = null
    },
    clearPlayerSurface() {
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
      // 交给播放器决定到期提示说“解锁到期”还是“网络已恢复”
      player.setRecovering(this._recovered)
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
      const view = player.surfaceOf({ audio: this._audio })
      const meta = view.meta
      const surface = view.surface
      if (!surface.visible) {
        this.clearPlayerSurface()
        return
      }
      // 冷启动/悬浮 X 停止后：只归零播放态，保留会话让用户能接着听。
      // coldPatch 由 audio-player 统一给出，避免两个组件各写一遍判据。
      if (view.coldPatch) storage.patchMeta(view.coldPatch)
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

    /**
     * 回前台对账：系统/会话层续播可能比本页 show 晚一拍，
     * 800ms 后按播放器真实状态再对一次，避免“已在播却显示已暂停”。
     */
    scheduleReconcile() {
      if (this._reconcileTimer) clearTimeout(this._reconcileTimer)
      this._reconcileTimer = setTimeout(() => {
        this._reconcileTimer = null
        if (!this._alive) return
        this.syncFromAudio()
        this.syncPlayerText()
      }, 800)
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
    /** 起播：源选择/meta/埋点/定时都在 audio-player 收口，这里只做视图反应 */
    play(track, localPath) {
      const cached = localPath || this.peekCached(track.url)
      if (!player.play(track, { cached })) return
      this.clearCollapseTimer()
      // 用户主动点播/切歌：按记忆偏好展开播放条（自动连播不弹条）
      this.setData({ miniExpanded: this.expandedPreferred(), collapsed: false, collapsing: false, resumeLabel: '' })
      // 播放即排队缓存：移动网络等 20s（避免试听浪费），Wi-Fi 等 8s 让首播先稳
      this.scheduleAutoCache(track)
    },
    /**
     * 迷你条「下一首」：与跨页迷你条同一套候选（收藏连播优先，其余列表循环）。
     * 切歌必须走 play()：meta、缓存、埋点、定时偏好都在那里收口，避免两个入口两套行为。
     */
    onNextTap() {
      if (!player.next()) return
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

    /** 点 ✓：删除这首的缓存（不喜欢的、占空间的），不影响其它已缓存音源 */
    onRemoveCacheTap(event) {
      const id = event.currentTarget.dataset.id
      const track = this.findTrack(id)
      if (!track) return
      this.confirmRemoveCache(track)
    },

    /** 长按曲目：与点 ✓ 同一套确认口径 */
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
      const result = player.toggle()
      if (result === 'paused') {
        this.clearCollapseTimer()
        this.setData({ miniExpanded: true, collapsed: false, collapsing: false })
        return
      }
      if (result === 'played') {
        this.clearCollapseTimer()
        this.setData({ miniExpanded: true, collapsed: false, collapsing: false })
        this.peekMiniBar()
      }
    },
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
      player.stop()
      this.clearCollapseTimer()
      // 主动停止后不再启动新的后台缓存；已开始的下载保留（下次可命中）
      this.clearAutoCacheTimer()
      this.setData({
        playerSub: '',
        timerRemainText: '',
        timerMinutes: 0,
        miniExpanded: false,
        collapsed: false,
        collapsing: false,
        resumeLabel: ''
      })
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
      // 收藏人数：不阻塞抽屉打开，回来后重建排序快照
      this.refreshFavCounts()
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
      const filtered = this.data.tracks
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
      // 「收藏」Tab 是用户自己的集合，保持配置顺序；其余按收藏人数降序。
      // 排序用打开抽屉时的快照（_rankCounts），点 ♥ 只变数字不重排，否则刚点的那行会当场跳走。
      const list = category === '收藏' ? filtered : favCounts.sortByRank(filtered, this._rankCounts)
      this.setData({ filteredTracks: list })
    },

    onToggleFavorite(event) {
      const id = event.currentTarget.dataset.id
      if (!id) return
      const favorites = storage.toggleFavorite(id)
      const on = favorites.indexOf(id) >= 0
      // 本地先落地：数字立即 ±1，排序快照不动
      const delta = on ? 1 : -1
      const tracks = this.data.tracks.map((track) => {
        if (track.id !== id) return track
        const next = Math.max(0, (Number(track.favCount) || 0) + delta)
        return Object.assign({}, track, { favCount: next, favText: favCounts.formatFavText(next) })
      })
      this.setData({ favoriteIds: favorites, tracks }, () => this.applyFilter())
      // 全站计数异步上报；失败不回滚本地收藏，下次打开抽屉重新对账
      withLogin((code) => api.setAudioFavorite(code, id, on)).then(
        (res) => {
          const real = Number(res && res.real)
          if (Number.isFinite(real) && real >= 0) this.patchFavCount(id, real)
        },
        () => {}
      )
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
      player.setTimerMinutes(minutes)
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
