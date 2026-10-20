/**
 * 跨页迷你播放器。
 * 声音入口仍然只在入睡页（audio-dock）；这里只在「已经播放过」时出现，
 * 让用户在计算器/统计页也能暂停、继续、停止，不必切回入睡页。
 * 只监听 play/pause/stop，不处理 ended（循环重播仍由 audio-dock 负责）。
 */
const storage = require('../../utils/storage')
const audioTimer = require('../../utils/audio-timer')

Component({
  data: {
    visible: false,
    playing: false,
    title: ''
  },

  lifetimes: {
    attached() {
      this._audio = null
      this._failed = false
      this._onPlay = () => {
        this._failed = false
        this.sync(true)
      }
      this._onPause = () => this.sync(true)
      this._onStop = () => this.sync(true)
      this._onError = () => {
        this._failed = true
        this.setData({ visible: false, playing: false })
      }
      this.setup()
      this.sync(false)
    },
    detached() {
      this.off()
    }
  },

  pageLifetimes: {
    show() {
      this.setup()
      this.sync(false)
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

    sync(force) {
      if (this._failed) return
      const meta = storage.getMeta()
      const audio = this._audio
      const hasSrc = !!(audio && audio.src)
      const active = !!meta.lastTrackId && meta.lastTrackActive !== false
      const visible = active && hasSrc
      const playing = visible && !audio.paused
      const title = meta.lastTrackTitle || '环境音'

      if (
        !force &&
        visible === this.data.visible &&
        playing === this.data.playing &&
        title === this.data.title
      ) {
        return
      }

      this.setData({ visible, playing, title })
    },

    toggle() {
      const audio = this._audio
      if (!audio || !audio.src) return
      if (audio.paused) {
        // 与入睡页 dock 保持一致：暂停/恢复必须同步倒计时，不能只动音频。
        if (audioTimer.isPaused()) audioTimer.resume()
        else if (!audioTimer.remaining()) {
          const minutes = Number(storage.getMeta().audioTimerMinutes) || 0
          if (minutes > 0) audioTimer.start(minutes)
        }
        this._failed = false
        audio.play()
      } else {
        audio.pause()
        audioTimer.pause()
      }
    },

    close() {
      // 关闭播放条是“停止本次会话”，不是“把下次定时偏好归零”。
      audioTimer.clear(undefined, true)
      storage.patchMeta({ lastTrackActive: false })
      if (this._audio) {
        try {
          this._audio.stop()
        } catch (e) {}
      }
      this.setData({ visible: false, playing: false })
    },

    goSleep() {
      wx.switchTab({ url: '/pages/sleep/sleep' })
    }
  }
})
