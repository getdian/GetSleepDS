/**
 * now-playing 暂停口径冒烟：缓冲导致的系统 pause 不等于用户暂停。
 *
 * 背景（2026-10-31 交互审查）：now-playing 原先无条件 `audioTimer.pause()` 并把条子
 * 收成“已暂停”，与 audio-player 的 30s 缓冲窗口判定不一致——缓冲时条子闪一下
 * “已暂停”、倒计时被冻结；若播放器事件层未就绪，还会永久停在那里。
 * 现在缓冲判定统一由 `player.isBuffering()` 给出，两个视图必须看到同一结果。
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const memory = {}
const appState = { globalData: { audioSession: true, audioUnlockedSession: true } }
const handlers = {}
let manager = null

function fakeAudio() {
  return {
    src: '',
    title: '',
    epname: '',
    singer: '',
    paused: true,
    duration: 180,
    currentTime: 0,
    play() {
      this.paused = false
    },
    pause() {
      this.paused = true
    },
    seek() {},
    stop() {
      this.paused = true
      this.src = ''
    },
    onPlay(fn) { handlers.play = fn },
    onPause(fn) { handlers.pause = fn },
    onStop(fn) { handlers.stop = fn },
    onEnded(fn) { handlers.ended = fn },
    onError(fn) { handlers.error = fn },
    onWaiting(fn) { handlers.waiting = fn },
    onCanplay(fn) { handlers.canplay = fn },
    onTimeUpdate(fn) { handlers.timeupdate = fn }
  }
}

global.getApp = () => appState
global.getCurrentPages = () => []
global.wx = {
  env: { USER_DATA_PATH: '/tmp/sleep-now-playing-test' },
  getStorageSync(key) {
    return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : ''
  },
  setStorageSync(key, value) {
    memory[key] = value
  },
  removeStorageSync(key) {
    delete memory[key]
  },
  getBackgroundAudioManager() {
    return manager
  },
  getFileSystemManager() {
    return {
      accessSync() {
        throw new Error('missing')
      }
    }
  },
  showToast() {},
  request() {}
}

const storage = require('../miniprogram/utils/storage')
const audioTimer = require('../miniprogram/utils/audio-timer')
const audioSession = require('../miniprogram/utils/audio-session')
const player = require('../miniprogram/utils/audio-player')
const events = require('../miniprogram/utils/events')
// 埋点走队列 + 4s 定时 flush（未 unref），测试里直接吞掉，避免挂住进程
events.track = () => {}

let def = null
global.Component = (config) => {
  def = config
}
require('../miniprogram/components/now-playing/now-playing')

const TRACK = {
  id: 'sleep-10001',
  title: '雨声',
  category: '自然之声',
  url: 'https://img.qfmaster.com/sleep/sleep-10001.mp3'
}

function reset() {
  Object.keys(memory).forEach((key) => delete memory[key])
  Object.keys(handlers).forEach((key) => delete handlers[key])
  appState.globalData.audioSession = true
  appState.globalData.audioUnlockedSession = true
  audioTimer.clear()
  audioSession._resetForTest()
  player._resetForTest()
  manager = player.setManager(fakeAudio())
  player.init()
  storage.patchMeta({
    lastTrackId: TRACK.id,
    lastTrackTitle: '雨声',
    lastTrackActive: true,
    lastTrackPlaying: true
  })
}

/** 只实现 handlePause 用到的成员 */
function instance(overrides) {
  return Object.assign(
    {
      _alive: true,
      _pageVisible: true,
      data: { playing: true, loading: false },
      setData(patch) {
        Object.assign(this.data, patch)
      },
      clearPeek() {},
      disarmLoadingGuard() {},
      armLoadingGuard() {
        this.guarded = true
      },
      sync() {
        this.synced = true
      }
    },
    overrides || {}
  )
}

test('缓冲中的系统 pause：保持“缓冲中”，不冻结定时、不写已暂停', () => {
  reset()
  handlers.waiting() // 播放器进入缓冲窗口
  audioTimer.start(30)
  try {
    const inst = instance()
    def.methods.handlePause.call(inst)
    assert.equal(inst.data.loading, true, '应保持缓冲态')
    assert.equal(inst.data.playing, false)
    assert.equal(inst.guarded, true, '应起本页加载兜底')
    assert.equal(audioTimer.isPaused(), false, '缓冲暂停不得冻结倒计时')
    assert.equal(audioTimer.remaining() > 0, true)
  } finally {
    audioTimer.clear()
  }
})

test('用户在小程序内暂停：冻结倒计时并收成“已暂停”', () => {
  reset()
  player.play(TRACK, { cached: '' }) // markUserPlay
  player.pause() // markUserPause + BAM.pause
  audioTimer.start(30)
  try {
    const inst = instance()
    def.methods.handlePause.call(inst)
    assert.equal(audioTimer.isPaused(), true, '用户暂停必须冻结倒计时')
    assert.equal(inst.data.loading, false)
    assert.equal(storage.getMeta().lastTrackPlaying, false)
  } finally {
    // stop 顺带清掉 play() 排的自动缓存定时器（20s，未 unref），否则进程要多等一轮
    player.stop()
    audioTimer.clear()
  }
})
