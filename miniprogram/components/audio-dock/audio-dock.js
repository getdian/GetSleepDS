const { getConfig, loadConfig } = require('../../utils/config')
const storage = require('../../utils/storage')
const cache = require('../../utils/audio-cache')
const api = require('../../utils/api')
const { wxLogin } = require('../../utils/login')
const ad = require('../../utils/ad')
const events = require('../../utils/events')
const audioTimer = require('../../utils/audio-timer')

const ICONS = ['rain', 'wave', 'fire', 'noise', 'night']
const TIMER_OPTIONS = [
  { value: 30, label: '30 分' },
  { value: 60, label: '60 分' },
  { value: 90, label: '90 分' },
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
    timerMinutes: 60,
    timerRemainText: '',
    currentId: '',
    currentTitle: '',
    playing: false,
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
      this._audio = null
      this._cfg = getConfig()
      this._sheetTrackId = ''
      this._stopRequested = false
      this._playingFromCache = false
      this._currentTrack = null
      this._ttlDays = (this._cfg.cache && this._cfg.cache.ttlDays) || 7
      this._onCacheChange = () => this.refreshCache()

      cache.onChange(this._onCacheChange)
      cache.maybePrune(this._cfg.cache)

      this.applyConfig(this._cfg)
      this.setupAudio()
      ad.init(this._cfg.unlock && this._cfg.unlock.adUnitId)
      this.refreshUnlock()
      this.syncFromAudio()

      this._unsubTimer = audioTimer.subscribe((left) => {
        if (!this._alive) return
        if (left === 0 && this.data.currentId && storage.getMeta().lastTrackActive === false) {
          this.setData({ currentId: '', currentTitle: '', playing: false })
        }
        this.syncPlayerText()
      })
      this._unlockTimer = setInterval(() => {
        if (this._alive) this.refreshUnlock()
      }, 60 * 1000)

      const meta = storage.getMeta()
      if (!this._cfg.features || this._cfg.features.timer === false) {
        this.setData({ timerMinutes: 0 })
      } else if (typeof meta.audioTimerMinutes === 'number') {
        this.setData({ timerMinutes: meta.audioTimerMinutes })
      } else {
        this.setData({ timerMinutes: 60 })
      }

      loadConfig(false).then((cfg) => {
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

  methods: {
    noop() {},

    applyConfig(cfg) {
      const tracks = (cfg.audio || []).map((item) => {
        const iconKey = ICONS.indexOf(item.icon) >= 0 ? item.icon : 'noise'
        return {
          id: item.id,
          title: item.title || '环境音',
          subtitle: item.subtitle || '循环播放 · 支持锁屏',
          category: item.category || '环境音',
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
      if (!timerEnabled) audioTimer.clear()
      this.applyFilter()
      this.refreshCache()
      this.refreshUnlock()
    },

    /* ---------------- 缓存 ---------------- */
    refreshCache() {
      if (!this._alive) return
      const tracks = this.data.tracks
      const count = cache.cachedCount(tracks, this._ttlDays)
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
          cache.cleanAll()
          this.refreshCache()
          wx.showToast({ title: '已清理', icon: 'none' })
        }
      })
    },

    /* ---------------- 解锁 ---------------- */
    isUnlocked() {
      return storage.getUnlockExpire() > Date.now()
    },

    isFreeMode() {
      const unlock = this._cfg.unlock || {}
      return unlock.mode !== 'rewarded' || !unlock.adUnitId
    },

    refreshUnlock() {
      if (!this._alive) return
      const unlocked = this.isUnlocked()
      let remainText = ''
      if (unlocked) {
        const left = storage.getUnlockExpire() - Date.now()
        const hours = Math.floor(left / 3600000)
        const minutes = Math.floor((left % 3600000) / 60000)
        remainText = '剩余约 ' + hours + ' 小时' + (minutes > 0 ? ' ' + minutes + ' 分钟' : '')
      }
      this.setData({
        unlocked,
        freeMode: this.isFreeMode(),
        unlockRemainText: remainText
      })
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
      return wxLogin()
        .then((code) => api.unlockAudio(code))
        .then((res) => {
          const expire = res && res.expireAt ? res.expireAt : Date.now() + ttlMs
          storage.setUnlockExpire(expire)
        })
        .catch(() => {
          storage.setUnlockExpire(Date.now() + ttlMs)
        })
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
          this.setData({ playing: true })
          this.syncPlayerText()
        },
        pause: () => {
          if (!this._alive) return
          this.setData({ playing: false })
          this.syncPlayerText()
        },
        stop: () => {
          if (!this._alive) return
          const stoppedByUser = this._stopRequested
          this._stopRequested = false
          this.setData({ playing: false })
          if (stoppedByUser) {
            this.setData({ currentId: '', currentTitle: '', playerSub: '' })
          }
          this.syncPlayerText()
        },
        ended: () => {
          if (this._alive) this.replay()
        },
        error: () => {
          if (!this._alive) return
          if (this._playingFromCache && this._currentTrack) {
            this._playingFromCache = false
            this._audio.src = this._currentTrack.url
            return
          }
          this.setData({ playing: false })
          wx.showToast({ title: '音频加载失败', icon: 'none' })
        }
      }
      this._handlers = handlers
      audio.onPlay(handlers.play)
      audio.onPause(handlers.pause)
      audio.onStop(handlers.stop)
      audio.onEnded(handlers.ended)
      audio.onError(handlers.error)
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
          ['offError', 'error']
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

    syncFromAudio() {
      if (!this._audio) return
      const meta = storage.getMeta()
      if (!meta.lastTrackId || meta.lastTrackActive === false) return
      if (!this._audio.src && this._audio.paused) return
      const track = this.findTrack(meta.lastTrackId)
      if (!track) return
      this.setData({
        currentId: track.id,
        currentTitle: track.title,
        playing: !this._audio.paused
      })
      this.syncPlayerText()
    },

    syncPlayerText() {
      const left = audioTimer.remaining()
      const remain = left > 0 ? Math.ceil(left / 60000) + ' 分钟后关闭' : ''
      let sub = ''
      if (this.data.currentId) {
        sub = this.data.playing ? remain || '正在播放 · 循环' : '已暂停'
      }
      this.setData({ timerRemainText: remain, playerSub: sub })
    },

    findTrack(id) {
      const list = this.data.tracks
      for (let i = 0; i < list.length; i += 1) {
        if (list[i].id === id) return list[i]
      }
      return null
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
      const cached = localPath || cache.peek(track.url, this._ttlDays)
      this._currentTrack = track
      this._playingFromCache = !!cached

      this.setData({
        currentId: track.id,
        currentTitle: track.title,
        playing: true
      })
      this.syncPlayerText()

      this._audio.title = '睡点 · ' + track.title
      this._audio.epname = '环境音'
      this._audio.singer = '睡点'
      this._audio.src = cached || track.url

      storage.patchMeta({
        lastTrackId: track.id,
        lastTrackTitle: track.title,
        lastTrackActive: true
      })
      events.track('audio_play', track.id)

      if (this.data.timerEnabled && this.data.timerMinutes && !audioTimer.remaining()) {
        audioTimer.start(this.data.timerMinutes)
      }
    },

    replay() {
      if (!this.data.playing) return
      const track = this.findTrack(this.data.currentId)
      if (!track || !this._audio) return
      const cached = cache.peek(track.url, this._ttlDays)
      this._playingFromCache = !!cached
      this._audio.title = '睡点 · ' + track.title
      this._audio.src = cached || track.url
    },

    togglePlay() {
      if (!this._audio || !this.data.currentId) return
      if (this.data.playing) this._audio.pause()
      else this._audio.play()
    },

    stopPlayback() {
      this._stopRequested = true
      audioTimer.clear()
      storage.patchMeta({ lastTrackActive: false })
      this.setData({ currentId: '', currentTitle: '', playing: false, playerSub: '', timerRemainText: '' })
      if (this._audio) {
        try {
          this._audio.stop()
        } catch (e) {}
      }
    },

    /* ---------------- 抽屉交互 ---------------- */
    openSheet() {
      this.setData({ favoriteIds: storage.getFavorites() })
      this.refreshUnlock()
      this.refreshCache()
      this.setData({ open: true })
    },

    closeSheet() {
      this.setData({ open: false })
    },

    onKeywordInput(event) {
      this.setData({ keyword: event.detail.value || '' }, () => this.applyFilter())
    },

    onClearKeyword() {
      this.setData({ keyword: '' }, () => this.applyFilter())
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
            cached: !!cache.peek(track.url, this._ttlDays)
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
        return
      }

      const unlock = this._cfg.unlock || {}
      const ttlMs = (unlock.ttlHours || 24) * 60 * 60 * 1000
      this.setData({ unlocking: true, prepareText: '正在准备音频…' })

      // 广告与下载并行，广告结束时通常已经能从本地缓存秒播
      const downloading = cache
        .ensure(
          track.url,
          (percent) => {
            if (this._alive) this.setData({ prepareText: '缓存中 ' + percent + '%' })
          },
          this._ttlDays
        )
        .catch(() => '')

      Promise.all([this.showAd(), downloading])
        .then((results) => {
          if (!results[0]) {
            if (this._alive) this.setData({ unlocking: false, prepareText: '' })
            return null
          }
          return this.finishUnlock(ttlMs).then(() => results[1])
        })
        .then((localPath) => {
          if (localPath === null || !this._alive) return
          this.setData({
            sheetShow: false,
            unlocking: false,
            prepareText: '',
            unlocked: true
          })
          wx.showToast({ title: '已解锁', icon: 'none' })
          events.track('audio_unlock', track.id)
          this.play(track, localPath || '')
        })
        .catch(() => {
          if (!this._alive) return
          this.setData({ unlocking: false, prepareText: '' })
          wx.showToast({ title: '解锁失败，请重试', icon: 'none' })
        })
    },

    onSheetCancel() {
      if (this.data.unlocking) return
      this._sheetTrackId = ''
      this.setData({ sheetShow: false, prepareText: '' })
    },

    /* ---------------- 定时 ---------------- */
    onTimerTap(event) {
      const minutes = Number(event.currentTarget.dataset.value)
      if (minutes === this.data.timerMinutes) return
      this.setData({ timerMinutes: minutes })
      storage.patchMeta({ audioTimerMinutes: minutes })

      if (!minutes) {
        audioTimer.clear()
        this.syncPlayerText()
        return
      }
      if (this.data.currentId) {
        audioTimer.start(minutes)
        this.syncPlayerText()
      } else {
        wx.showToast({ title: '播放后开始计时', icon: 'none' })
      }
    }
  }
})
