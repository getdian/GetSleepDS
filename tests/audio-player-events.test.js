/**
 * audio-player 事件层单测：组件退化为订阅之后，播放状态机第一次可以被直接驱动。
 *
 * 覆盖历史上反复出问题、且以前只能靠模拟器/真机观察的几处：
 * 1) 事件只注册一次（两个组件各注册一遍是 claim 时间窗存在的根因）
 * 2) init/订阅时按 meta 补状态（用户可能在首页先播了歌，再进入睡页才首次 init）
 * 3) play() 写 meta + 起播；pause/stop 的会话语义
 * 4) 曲末 replay、缓存回退（坏源拉黑 + 回退远程）
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const memory = {}
const appState = { globalData: { audioSession: false, audioUnlockedSession: true } }
const handlers = {}
let manager = null
let plays = 0
let stops = 0

function fakeAudio(patch) {
  return Object.assign(
    {
      src: '',
      title: '',
      epname: '',
      singer: '',
      paused: true,
      duration: 180,
      currentTime: 0,
      play() {
        plays += 1
        this.paused = false
      },
      pause() {
        this.paused = true
      },
      seek() {},
      stop() {
        stops += 1
        this.paused = true
        this.src = ''
      },
      onPlay(fn) {
        handlers.play = fn
      },
      onPause(fn) {
        handlers.pause = fn
      },
      onStop(fn) {
        handlers.stop = fn
      },
      onEnded(fn) {
        handlers.ended = fn
      },
      onError(fn) {
        handlers.error = fn
      },
      onWaiting(fn) {
        handlers.waiting = fn
      },
      onCanplay(fn) {
        handlers.canplay = fn
      },
      onTimeUpdate(fn) {
        handlers.timeupdate = fn
      }
    },
    patch || {}
  )
}

global.getApp = () => appState
global.wx = {
  env: { USER_DATA_PATH: '/tmp/sleep-audio-player-events' },
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
  onAudioInterruptionBegin() {},
  onAudioInterruptionEnd() {},
  request() {}
}

const storage = require('../miniprogram/utils/storage')
const audioTimer = require('../miniprogram/utils/audio-timer')
const audioSession = require('../miniprogram/utils/audio-session')
const cache = require('../miniprogram/utils/audio-cache')
const player = require('../miniprogram/utils/audio-player')
const events = require('../miniprogram/utils/events')

// 埋点走 storage 队列，测试里直接吞掉，避免依赖网络层
events.track = () => {}

const TRACK = {
  id: 'sleep-10001',
  title: '雨声',
  category: '自然之声',
  url: 'https://img.qfmaster.com/sleep/sleep-10001.mp3'
}

function reset(metaPatch) {
  Object.keys(memory).forEach((key) => delete memory[key])
  Object.keys(handlers).forEach((key) => delete handlers[key])
  manager = fakeAudio()
  plays = 0
  stops = 0
  appState.globalData.audioSession = false
  appState.globalData.audioUnlockedSession = true
  audioTimer.clear()
  audioSession._resetForTest()
  player._resetForTest()
  manager = player.setManager(fakeAudio())
  cache.clearBad(TRACK.url)
  storage.patchMeta(
    Object.assign(
      {
        lastTrackId: TRACK.id,
        lastTrackTitle: '雨声',
        lastTrackCategory: '自然之声',
        lastTrackActive: true,
        lastTrackPlaying: false
      },
      metaPatch || {}
    )
  )
}

test('init 只注册一次事件：重复调用不会叠加监听', () => {
  reset()
  let registered = 0
  const original = manager.onPlay
  manager.onPlay = function onPlay(fn) {
    registered += 1
    original.call(this, fn)
  }
  assert.equal(player.init(), true)
  assert.equal(player.init({ timerMinutes: 30 }), true)
  assert.equal(registered, 1)
})

test('init 从 meta 补状态：在别的页面播过，进本页仍显示正确曲目与播放态', () => {
  reset()
  manager = player.setManager(fakeAudio({ src: TRACK.url, paused: false }))
  const seen = []
  player.init()
  player.subscribe((view) => seen.push(view))
  assert.equal(seen[0].currentId, TRACK.id)
  assert.equal(seen[0].playing, true)
})

test('play()：写 meta、起播、广播状态', () => {
  reset()
  manager = player.setManager(fakeAudio())
  player.init()
  const seen = []
  player.subscribe((view) => seen.push(view))
  assert.equal(player.play(TRACK, { cached: '' }), true)
  assert.equal(manager.src, TRACK.url)
  assert.equal(plays, 1)
  const meta = storage.getMeta()
  assert.equal(meta.lastTrackId, TRACK.id)
  assert.equal(meta.lastTrackActive, true)
  assert.equal(meta.lastTrackPlaying, true)
  const last = seen[seen.length - 1]
  assert.equal(last.currentId, TRACK.id)
  assert.equal(last.playing, true)
})

test('play()：非 https 源直接拒绝，不起播也不写 meta', () => {
  reset({ lastTrackId: '' })
  manager = player.setManager(fakeAudio())
  player.init()
  assert.equal(player.play(Object.assign({}, TRACK, { url: 'http://insecure/x.mp3' })), false)
  assert.equal(plays, 0)
  assert.equal(storage.getMeta().lastTrackId, '')
})

test('外部起播与暂停：事件驱动状态，不结束会话', () => {
  reset()
  manager = player.setManager(fakeAudio({ src: TRACK.url, paused: true }))
  player.init()
  appState.globalData.audioSession = true
  manager.paused = false
  handlers.play()
  assert.equal(player.snapshot().playing, true)
  assert.equal(storage.getMeta().lastTrackPlaying, true)

  manager.paused = true
  handlers.pause()
  assert.equal(player.snapshot().playing, false)
  assert.equal(storage.getMeta().lastTrackPlaying, false)
  // 会话仍在：迷你条继续以“已暂停”出现
  assert.equal(storage.getMeta().lastTrackActive, true)
})

test('stop()：写 lastTrackActive=false、停播放器、清空当前曲目', () => {
  reset()
  manager = player.setManager(fakeAudio())
  player.init()
  player.play(TRACK, { cached: '' })
  player.stop()
  assert.equal(storage.getMeta().lastTrackActive, false)
  assert.equal(stops, 1)
  assert.equal(player.snapshot().currentId, '')
})

test('曲末单曲循环：ended 后重新赋源并继续播', () => {
  reset()
  manager = player.setManager(fakeAudio())
  player.init()
  player.play(TRACK, { cached: '' })
  const before = plays
  appState.globalData.audioSession = true
  handlers.ended()
  assert.equal(manager.src, TRACK.url)
  assert.equal(plays > before, true, 'ended 后应重新起播')
})

test('缓存回退：坏源被拉黑，源切回远程并继续播', () => {
  reset()
  manager = player.setManager(fakeAudio())
  player.init()
  // 用本地路径起播（模拟命中缓存）
  player.play(TRACK, { cached: '/tmp/cached.mp3' })
  assert.equal(manager.src, '/tmp/cached.mp3')
  const before = plays
  // 让 1.5s 的“迟到错误”窗口过去
  const realNow = Date.now
  const t = realNow()
  Date.now = () => t + player.SRC_SETTLE_MS + 1
  try {
    manager.paused = true
    handlers.error({ errCode: 1 })
  } finally {
    Date.now = realNow
  }
  assert.equal(cache.peek(TRACK.url, 7, TRACK.url), '')
  assert.equal(manager.src, TRACK.url)
  assert.equal(plays > before, true, '回退远程后应继续起播')
})

test('toggle()：暂停与续播互逆，并同步播放意图', () => {
  reset()
  manager = player.setManager(fakeAudio())
  player.init()
  player.play(TRACK, { cached: '' })
  assert.equal(player.toggle(), 'paused')
  assert.equal(player.snapshot().playing, false)
  assert.equal(audioSession.isUserPaused(), true)
  // 220ms 防抖窗口内不响应
  assert.equal(player.toggle(), 'noop')
})
