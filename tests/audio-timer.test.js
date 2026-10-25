const test = require('node:test')
const assert = require('node:assert/strict')

const memory = {}
let stopped = 0
let audioSrc = ''

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
    return {
      get src() {
        return audioSrc
      },
      set src(value) {
        audioSrc = value
      },
      stop() {
        stopped += 1
        audioSrc = ''
      }
    }
  }
}

const timer = require('../miniprogram/utils/audio-timer')
const storage = require('../miniprogram/utils/storage')

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

test('定时器持久化 endAt，暂停/恢复保留剩余时间', () => {
  timer.clear()
  timer.start(10)
  const meta = storage.getMeta()
  assert.ok(meta.audioTimerEndAt > Date.now())
  assert.equal(meta.audioTimerMinutes, 10)

  timer.pause()
  const paused = storage.getMeta().audioTimerPausedRemaining
  assert.ok(paused > 0)
  assert.equal(timer.isPaused(), true)

  timer.resume()
  assert.equal(timer.isPaused(), false)
  assert.ok(timer.remaining() > 0)
  timer.clear()
  assert.equal(storage.getMeta().audioTimerEndAt, 0)
})

test('restore 在到点后停止音频并清空计时', () => {
  timer.clear()
  storage.patchMeta({ audioTimerEndAt: Date.now() - 1000, audioTimerMinutes: 30 })
  stopped = 0
  timer.restore()
  assert.ok(stopped >= 1)
  assert.equal(storage.getMeta().audioTimerEndAt, 0)
})

test('到点/停止清除运行态但保留用户定时偏好', () => {
  timer.clear()
  timer.start(30)
  timer.clear(undefined, true)
  assert.equal(storage.getMeta().audioTimerMinutes, 30)
  assert.equal(storage.getMeta().audioTimerEndAt, 0)

  timer.clear()
  assert.equal(storage.getMeta().audioTimerMinutes, 0)
})

test('restore 在有后台音频且未到点时重新挂起', () => {
  timer.clear()
  audioSrc = 'https://img.example.com/a.mp3'
  storage.patchMeta({ audioTimerEndAt: Date.now() + 60000, audioTimerMinutes: 1 })
  assert.ok(timer.restore() > 0)
  assert.ok(timer.remaining() > 0)
  timer.clear()
  audioSrc = ''
})

test('冷启动没有后台音频时不复活上次倒计时，只保留偏好', () => {
  timer.clear()
  audioSrc = ''
  storage.patchMeta({
    audioTimerEndAt: Date.now() + 60 * 60 * 1000,
    audioTimerMinutes: 60,
    audioTimerPausedRemaining: 0
  })
  assert.equal(timer.restore(), 0)
  assert.equal(storage.getMeta().audioTimerEndAt, 0)
  assert.equal(storage.getMeta().audioTimerMinutes, 60)
})

test('冷启动无活音频只清运行态，不把外部中断当成用户停止', () => {
  timer.clear()
  audioSrc = ''
  stopped = 0
  storage.patchMeta({
    lastTrackActive: true,
    lastTrackPlaying: true,
    audioTimerEndAt: Date.now() + 60 * 60 * 1000,
    audioTimerMinutes: 60,
    audioTimerPausedRemaining: 0
  })
  assert.equal(timer.restore(), 0)
  // 之前这里会调用 stopAudio()：audio.stop() + lastTrackActive=false，
  // 导致“系统清空 src”被误判成用户停止，首页/统计页迷你条消失。
  assert.equal(stopped, 0)
  assert.equal(storage.getMeta().lastTrackActive, true)
})

test('定时到点终止会话（这是业务终止，允许清 lastTrackActive）', () => {
  timer.clear()
  audioSrc = ''
  storage.patchMeta({
    lastTrackActive: true,
    lastTrackPlaying: true,
    audioTimerEndAt: Date.now() - 1000,
    audioTimerMinutes: 30
  })
  timer.restore()
  const meta = storage.getMeta()
  assert.equal(meta.audioTimerEndAt, 0)
  assert.equal(meta.lastTrackActive, false)
  assert.equal(meta.lastTrackPlaying, false)
})

test('暂停中的倒计时同样不能跨进程复活', () => {
  timer.clear()
  audioSrc = ''
  storage.patchMeta({
    audioTimerEndAt: 0,
    audioTimerMinutes: 30,
    audioTimerPausedRemaining: 10 * 60 * 1000
  })
  assert.equal(timer.restore(), 0)
  assert.equal(timer.isPaused(), false)
  assert.equal(storage.getMeta().audioTimerPausedRemaining, 0)
  assert.equal(storage.getMeta().audioTimerMinutes, 30)
})

test('内存中已到点（挂起期间过点）restore 必须立即停音频', async () => {
  timer.clear()
  timer.start(0.001) // 60ms
  await sleep(80)
  stopped = 0
  assert.equal(timer.restore(), 0)
  assert.ok(stopped >= 1)
  assert.ok(timer.lastExpiredAt() > 0)
  assert.equal(timer.remaining(), 0)
  assert.equal(storage.getMeta().audioTimerEndAt, 0)
})

test('到点瞬间暂停不能把倒计时静默吞掉', async () => {
  timer.clear()
  timer.start(0.001)
  await sleep(80)
  stopped = 0
  timer.pause()
  assert.ok(stopped >= 1)
  assert.ok(timer.lastExpiredAt() > 0)
  assert.equal(timer.remaining(), 0)
  assert.equal(storage.getMeta().audioTimerEndAt, 0)
})

test('arm 在暂停中续剩余、空闲时按偏好起表、0 偏好不起表', () => {
  timer.clear()
  assert.equal(timer.arm(0), false)
  assert.equal(timer.remaining(), 0)

  assert.equal(timer.arm(15), true)
  assert.ok(timer.remaining() > 14 * 60 * 1000)
  assert.equal(timer.total(), 15)

  timer.pause()
  assert.equal(timer.isPaused(), true)
  assert.equal(timer.arm(60), true)
  assert.equal(timer.isPaused(), false)
  // 续的是剩余时间，不会按新传入的 60 分钟重算
  assert.equal(timer.total(), 15)
  assert.ok(timer.remaining() <= 15 * 60 * 1000)

  timer.clear()
})
