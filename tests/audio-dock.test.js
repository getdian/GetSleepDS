/**
 * audio-dock 组件冒烟：只覆盖两处“静默失败”的收口路径。
 *
 * 背景（2026-10-31 审查）：这两个方法曾引用未 require 的模块——
 * `onTimerTick` 用 `playerState.claimExpiryToast()`、`syncFromAudio` 用
 * `audioSession.markStopped()`。ReferenceError 分别被 `audioTimer.emit` 的
 * try/catch 和 Promise 链吞掉，表现为「定时到点后入睡页仍显示上一首 + 30 分」
 * 与「运营下架的曲目停不下来、入睡页初始化被整段打断」。
 * 这里直接调用方法体，确保缺 require 时测试立刻红。
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const memory = {}
const appState = { globalData: { audioSession: true, audioUnlockedSession: true } }
const toasts = []

global.getApp = () => appState
global.wx = {
  env: { USER_DATA_PATH: '/tmp/sleep-audio-dock-test' },
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
    return null
  },
  getFileSystemManager() {
    return {
      accessSync() {
        throw new Error('missing')
      }
    }
  },
  showToast(options) {
    toasts.push(options && options.title)
  },
  request() {}
}

const storage = require('../miniprogram/utils/storage')
const audioTimer = require('../miniprogram/utils/audio-timer')

let dock = null
global.Component = (config) => {
  dock = config
}
require('../miniprogram/components/audio-dock/audio-dock')

/** 只实现被测方法用到的成员：真实组件里这些由 data/lifetimes 提供 */
function instance(overrides) {
  return Object.assign(
    {
      _alive: true,
      _pageVisible: true,
      _audio: null,
      data: { tracks: [], currentId: '' },
      setData(patch) {
        Object.assign(this.data, patch)
      },
      findTrack: () => null,
      clearPlayerSurface() {
        this.cleared = true
      },
      syncPlayerText() {
        this.synced = true
      }
    },
    overrides || {}
  )
}

test('组件加载成功，且两个收口方法存在', () => {
  assert.ok(dock && dock.methods)
  assert.equal(typeof dock.methods.syncFromAudio, 'function')
  assert.equal(typeof dock.methods.onTimerTick, 'function')
})

test('定时到点：播放条与分钟胶囊复位，并提示一次', () => {
  storage.patchMeta({ lastTrackId: 'sleep-10001', lastTrackActive: false, lastTrackPlaying: false })
  const original = audioTimer.lastExpiredAt
  audioTimer.lastExpiredAt = () => Date.now()
  toasts.length = 0
  const inst = instance({
    data: { tracks: [], currentId: 'sleep-10001', currentTitle: '雨声', playing: true, timerMinutes: 30 }
  })
  try {
    dock.methods.onTimerTick.call(inst, 0)
  } finally {
    audioTimer.lastExpiredAt = original
  }
  assert.equal(inst.data.currentId, '')
  assert.equal(inst.data.playing, false)
  assert.equal(inst.data.timerMinutes, 0, '到点即结束会话，胶囊必须回到“关”')
  assert.equal(inst.synced, true)
  assert.deepEqual(toasts, ['定时结束，已停止播放'])
})

test('当前曲目已下架：结束会话并清掉播放面，不抛 ReferenceError', () => {
  storage.patchMeta({
    lastTrackId: 'sleep-gone',
    lastTrackTitle: '已下架',
    lastTrackActive: true,
    lastTrackPlaying: true
  })
  const inst = instance({
    _audio: { src: 'https://img.qfmaster.com/sleep/gone.mp3', paused: false, duration: 180, currentTime: 10 },
    data: { tracks: [], currentId: 'sleep-gone' }
  })
  dock.methods.syncFromAudio.call(inst)
  assert.equal(inst.cleared, true)
  // 曲目下架属于业务终止，允许收会话（与“外部中断不算停止”同一口径）
  assert.equal(storage.getMeta().lastTrackActive, false)
})
