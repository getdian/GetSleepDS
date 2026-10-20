const test = require('node:test')
const assert = require('node:assert/strict')

const memory = {}
let stopped = 0

global.wx = {
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
      stop() {
        stopped += 1
      }
    }
  }
}

const timer = require('../miniprogram/utils/audio-timer')
const storage = require('../miniprogram/utils/storage')

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

test('restore 在未到点时重新挂起', () => {
  timer.clear()
  storage.patchMeta({ audioTimerEndAt: Date.now() + 60000, audioTimerMinutes: 1 })
  assert.ok(timer.restore() > 0)
  assert.ok(timer.remaining() > 0)
  timer.clear()
})
