const test = require('node:test')
const assert = require('node:assert/strict')

const memory = {}
const appState = { globalData: { audioSession: false, audioUnlockedSession: true } }
let manager = null
const interruption = {}

function fakeAudio() {
  return {
    src: '',
    title: '',
    epname: '',
    singer: '',
    paused: true,
    duration: 180,
    currentTime: 0,
    plays: 0,
    seeks: 0,
    play() {
      this.plays += 1
      this.paused = false
    },
    pause() {
      this.paused = true
    },
    seek(position) {
      this.seeks += 1
      this.currentTime = position
    },
    stop() {
      this.paused = true
      this.src = ''
    }
  }
}

global.getApp = () => appState
global.wx = {
  env: { USER_DATA_PATH: '/tmp/sleep-audio-test' },
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
  onAudioInterruptionBegin(listener) {
    interruption.begin = listener
  },
  onAudioInterruptionEnd(listener) {
    interruption.end = listener
  }
}

const storage = require('../miniprogram/utils/storage')
const audioSession = require('../miniprogram/utils/audio-session')

const TRACK_URL = 'https://img.qfmaster.com/sleep/sleep-10001.mp3'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function reset(metaPatch) {
  Object.keys(memory).forEach((key) => delete memory[key])
  manager = fakeAudio()
  appState.globalData.audioSession = false
  appState.globalData.audioUnlockedSession = true
  audioSession._resetForTest()
  storage.patchMeta(
    Object.assign(
      {
        lastTrackId: 'sleep-10001',
        lastTrackTitle: '雨声',
        lastTrackCategory: '自然之声',
        lastTrackActive: true,
        lastTrackPlaying: true
      },
      metaPatch || {}
    )
  )
}

function playingManager() {
  manager.src = TRACK_URL
  manager.paused = false
  manager.currentTime = 30
}

test('中断结束自动续播，且会话保持存活', async () => {
  reset()
  playingManager()
  audioSession.init()
  audioSession.markUserPlay()

  assert.equal(typeof interruption.begin, 'function')
  assert.equal(typeof interruption.end, 'function')

  interruption.begin()
  // 系统在中断开始后把音频暂停
  manager.paused = true
  interruption.end()
  await sleep(120)

  assert.equal(manager.plays, 1)
  assert.equal(manager.paused, false)
  const meta = storage.getMeta()
  assert.equal(meta.lastTrackActive, true)
  assert.equal(meta.lastTrackPlaying, true)
  assert.equal(appState.globalData.audioSession, true)
})

test('中断上报 begin/end|秒|resume；用户暂停则 skip', () => {
  reset()
  const calls = []
  audioSession.setReporter((type, target) => calls.push([type, target]))
  playingManager()
  audioSession.markUserPlay()

  audioSession.onInterruptionBegin()
  manager.paused = true
  audioSession.onInterruptionEnd()
  assert.equal(calls.length, 2)
  assert.equal(calls[0][0], 'audio_interrupt')
  assert.ok(calls[0][1].indexOf('begin|sleep-10001') === 0)
  assert.match(calls[1][1], /^end\|\d+s\|resume$/)

  // 用户在小程序内暂停后中断结束：恢复被跳过，后台据此算恢复成功率
  calls.length = 0
  audioSession.onInterruptionBegin()
  audioSession.markUserPause()
  manager.paused = true
  audioSession.onInterruptionEnd()
  assert.equal(calls.length, 2)
  assert.match(calls[1][1], /^end\|\d+s\|skip$/)
  audioSession._resetForTest()
})

test('用户在小程序内暂停后，中断结束不自动续播', async () => {
  reset()
  playingManager()
  audioSession.init()
  audioSession.markUserPlay()

  audioSession.onInterruptionBegin()
  audioSession.markUserPause()
  manager.paused = true
  audioSession.onInterruptionEnd()
  await sleep(120)

  assert.equal(manager.plays, 0)
  assert.equal(manager.paused, true)
  assert.equal(storage.getMeta().lastTrackActive, true)
})

test('系统 stop 只取消自动续播，不结束会话（迷你条保留）', async () => {
  reset()
  playingManager()
  audioSession.init()
  audioSession.markUserPlay()

  audioSession.onStop()
  manager.stop()
  audioSession.onInterruptionEnd()
  await sleep(120)

  assert.equal(manager.plays, 0)
  assert.notEqual(storage.getMeta().lastTrackActive, false)
  assert.equal(storage.getMeta().lastTrackId, 'sleep-10001')
})

test('后台期间系统 stop（浮窗 X / 锁屏停止）后回前台不自动续播', async () => {
  reset()
  playingManager()
  audioSession.init()
  audioSession.markUserPlay()

  audioSession.onAppHide() // 离开时在播 -> 记下 playingAtHide
  manager.stop() // 后台被系统停止：src 被清空、paused=true
  audioSession.onStop()
  audioSession.onAppShow()
  await sleep(120)

  assert.equal(manager.plays, 0, '系统 stop 是显式停止，不得被回前台拉起')
  assert.equal(audioSession.wantsPlayback(), false)
  // 会话仍保留：迷你条以“已暂停”显示，用户点按才续播
  assert.notEqual(storage.getMeta().lastTrackActive, false)
  assert.equal(storage.getMeta().lastTrackId, 'sleep-10001')
})

test('切到其他 App 后回前台自动续播', async () => {
  reset()
  playingManager()
  audioSession.init()
  audioSession.markUserPlay()

  audioSession.onAppHide()
  // 其他 App 抢占音频焦点：没有 interruption 事件，只有底层暂停
  manager.paused = true
  audioSession.onAppShow()
  await sleep(120)

  assert.equal(manager.plays, 1)
  assert.equal(manager.paused, false)
})

test('用户主动停止后回前台不会复活', async () => {
  reset()
  playingManager()
  audioSession.init()
  audioSession.markUserPlay()

  audioSession.markStopped()
  manager.paused = true
  audioSession.onAppHide()
  audioSession.onAppShow()
  await sleep(120)

  assert.equal(manager.plays, 0)
  assert.equal(storage.getMeta().lastTrackActive, false)
})

test('src 被系统清空时按 lastTrackId 重建音源再续播', async () => {
  reset()
  manager.src = ''
  manager.paused = true
  audioSession.init()
  audioSession.markUserPlay()

  audioSession.resumeIfPossible('rebuild')
  await sleep(120)

  assert.equal(manager.src, TRACK_URL)
  assert.equal(manager.plays, 1)
  assert.equal(storage.getMeta().lastTrackPlaying, true)
})

test('中断期间已播完的曲目续播时先回到开头', async () => {
  reset()
  manager.src = TRACK_URL
  manager.paused = true
  manager.duration = 180
  manager.currentTime = 180
  audioSession.init()
  audioSession.markUserPlay()

  audioSession.resumeIfPossible('ended-while-interrupted')
  await sleep(120)

  assert.equal(manager.seeks, 1)
  assert.equal(manager.currentTime, 0)
  assert.equal(manager.plays, 1)
})

test('停止宽限期内的迟到 play 事件不会复活会话', () => {
  reset()
  audioSession.markStopped()
  audioSession.onPlay()
  assert.equal(storage.getMeta().lastTrackActive, false)
  // 连播放意图也不能被改回来，否则下一次回前台会自动续播
  assert.equal(audioSession.wantsPlayback(), false)
})

test('停止后紧跟的 stop 事件不会解除宽限（真实调用顺序）', () => {
  reset()
  playingManager()
  audioSession.markUserPlay()
  // stopPlayback 的调用顺序：markStopped() → audio.stop() → onStop
  audioSession.markStopped()
  manager.stop()
  audioSession.onStop()
  audioSession.onPlay()
  assert.equal(storage.getMeta().lastTrackActive, false)
  assert.equal(audioSession.wantsPlayback(), false)
})

test('用户在小程序内暂停后，迟到的 play 不抹掉暂停意图', () => {
  reset()
  manager.src = TRACK_URL
  manager.paused = true
  audioSession.markUserPlay()
  audioSession.markUserPause()
  // 底层补发一条 play（safePlay 生效/系统通知栏）
  audioSession.onPlay()
  assert.equal(audioSession.isUserPaused(), true)
  assert.equal(audioSession.wantsPlayback(), false)
})

test('自动重播有上限，用户重新点播后重新计时', () => {
  reset()
  for (let i = 0; i < 8; i += 1) assert.equal(audioSession.allowReplay(), true)
  assert.equal(audioSession.allowReplay(), false)
  audioSession.markUserPlay()
  assert.equal(audioSession.allowReplay(), true)
})

test('自动回环续播不得清零预算（否则 8 次上限永远打不满）', () => {
  reset()
  for (let i = 0; i < 8; i += 1) assert.equal(audioSession.allowReplay(), true)
  // 回环路径：ended → markAutoReplay → 再次 allowReplay
  audioSession.markAutoReplay()
  assert.equal(audioSession.allowReplay(), false, '自动续播后预算必须仍然耗尽')
  // 连续坏源：每一轮都走自动续播，第 9 轮起必然熔断
  for (let i = 0; i < 5; i += 1) {
    audioSession.markAutoReplay()
    assert.equal(audioSession.allowReplay(), false)
  }
  // 只有用户手动重新点播才恢复预算
  audioSession.markUserPlay()
  assert.equal(audioSession.allowReplay(), true)
})

test('isSessionLive 只认本进程真正播放过的会话', () => {
  reset()
  // meta 说 active（上个进程残留），但本进程没起过播
  assert.equal(audioSession.isSessionLive(), false)
  appState.globalData.audioSession = true
  assert.equal(audioSession.isSessionLive(), true)
  storage.patchMeta({ lastTrackActive: false })
  assert.equal(audioSession.isSessionLive(), false)
})

test('外部误清会话后，play 事件会把会话恢复回来', () => {
  reset({ lastTrackActive: false })
  audioSession.onPlay()
  const meta = storage.getMeta()
  assert.equal(meta.lastTrackActive, true)
  assert.equal(meta.lastTrackPlaying, true)
})
