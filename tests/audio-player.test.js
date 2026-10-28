/**
 * audio-player 单测：接入层收口后的四个判断
 * 1) manager 单例（不再四处 wx.getBackgroundAudioManager）
 * 2) surfaceOf 的严格布尔与冷启动残影（假播放那类 bug 的根）
 * 3) attach 的缓存优先与非 https 拒绝
 * 4) errorPlan 的五个分支 + markBadSource 的“删不删文件”判据
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const memory = {}
const appState = { globalData: { audioSession: false } }
let manager = null

function fakeAudio(patch) {
  return Object.assign(
    {
      src: '',
      title: '',
      epname: '',
      singer: '',
      paused: true,
      duration: 180,
      currentTime: 0
    },
    patch || {}
  )
}

global.getApp = () => appState
global.wx = {
  env: { USER_DATA_PATH: '/tmp/sleep-audio-player-test' },
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
  }
}

const storage = require('../miniprogram/utils/storage')
const cache = require('../miniprogram/utils/audio-cache')
const player = require('../miniprogram/utils/audio-player')

const TRACK_URL = 'https://img.qfmaster.com/sleep/sleep-10001.mp3'

function reset(metaPatch) {
  Object.keys(memory).forEach((key) => delete memory[key])
  manager = fakeAudio()
  appState.globalData.audioSession = false
  player._resetForTest()
  cache.clearBad(TRACK_URL)
  storage.patchMeta(
    Object.assign(
      {
        lastTrackId: 'sleep-10001',
        lastTrackTitle: '雨声',
        lastTrackCategory: '自然之声',
        lastTrackActive: true,
        lastTrackPlaying: false
      },
      metaPatch || {}
    )
  )
}

test('manager 是单例：多次取用拿到同一个实例，setManager 可覆盖', () => {
  reset()
  const first = player.audio()
  assert.equal(first, manager)
  assert.equal(player.audio(), first)
  const injected = fakeAudio({ src: 'https://x/y.mp3' })
  assert.equal(player.setManager(injected), injected)
  assert.equal(player.audio(), injected)
})

test('surfaceOf：无 src 时 paused===undefined 不算在播（假播放根因）', () => {
  reset()
  const ghost = fakeAudio({ src: '', paused: undefined })
  player.setManager(ghost)
  const view = player.surfaceOf()
  assert.equal(view.surface.visible, true)
  assert.equal(view.surface.playing, false)

  ghost.src = TRACK_URL
  ghost.paused = false
  assert.equal(player.surfaceOf().surface.playing, true)
})

test('surfaceOf：冷启动残影只给 coldPatch，不隐藏入口', () => {
  reset({ lastTrackPlaying: true })
  player.setManager(fakeAudio({ src: TRACK_URL, paused: true }))
  const view = player.surfaceOf()
  assert.equal(view.surface.visible, true)
  assert.equal(view.surface.cold, true)
  assert.deepEqual(view.coldPatch, { lastTrackPlaying: false })
})

test('surfaceOf：用户显式停止后入口隐藏，且不产生 coldPatch', () => {
  reset({ lastTrackActive: false, lastTrackPlaying: false })
  player.setManager(fakeAudio({ src: TRACK_URL, paused: false }))
  const view = player.surfaceOf()
  assert.equal(view.surface.visible, false)
  assert.equal(view.coldPatch, null)
})

test('attach：优先本地缓存，并记录期望源与 srcAge', () => {
  reset()
  const audio = player.setManager(fakeAudio())
  const attached = player.attach({ id: 'sleep-10001', title: '雨声', url: TRACK_URL }, { cached: '/tmp/c.mp3' })
  assert.deepEqual(attached, { url: '/tmp/c.mp3', fromCache: true })
  assert.equal(audio.src, '/tmp/c.mp3')
  assert.equal(audio.title, '睡点 · 雨声')
  assert.equal(player.expected(), '/tmp/c.mp3')
  // 赋值与断言之间可能过去 1ms，只断言“刚刚赋过”而不是精确 0
  assert.ok(player.srcAge() < 50, 'srcAge 应接近 0，实际 ' + player.srcAge())

  const remote = player.attach({ id: 'sleep-10001', title: '雨声', url: TRACK_URL }, { cached: '' })
  assert.deepEqual(remote, { url: TRACK_URL, fromCache: false })
})

test('attach：缓存命中走 cache.peek，非 https 源直接拒绝', () => {
  reset()
  const audio = player.setManager(fakeAudio())
  const original = cache.peek
  cache.peek = () => '/tmp/from-peek.mp3'
  try {
    assert.deepEqual(player.attach({ id: 'sleep-10001', title: '雨声', url: TRACK_URL }), {
      url: '/tmp/from-peek.mp3',
      fromCache: true
    })
  } finally {
    cache.peek = original
  }
  assert.equal(audio.src, '/tmp/from-peek.mp3')
  assert.equal(player.attach({ id: 'x', title: 'x', url: 'http://insecure/x.mp3' }), null)
  assert.equal(player.playableUrl({ url: 'http://insecure/x.mp3' }), '')
})

test('errorPlan：五个分支', () => {
  const now = 1000000
  const audio = fakeAudio({ src: TRACK_URL, paused: false })
  // 1. 本进程没起过播 → 不处理
  player._resetForTest()
  assert.equal(player.errorPlan({ audio, now }).action, 'ignore')
  // 2. 旧源迟到 → 不处理
  player.setExpectedSrc('/tmp/other.mp3')
  assert.equal(player.errorPlan({ audio, now }).action, 'ignore')
  // 3. 仍在出声 → playing
  player.setExpectedSrc(TRACK_URL)
  assert.equal(player.errorPlan({ audio, now }).action, 'playing')
  // 4. 刚赋值 src（1.5s 内）→ too_soon
  audio.paused = true
  const fresh = player.srcAge(Date.now())
  assert.ok(fresh < player.SRC_SETTLE_MS)
  assert.equal(player.errorPlan({ audio }).action, 'too_soon')
  // 5. 播缓存失败 → fallback，并带回坏源 url
  const track = { id: 'sleep-10001', title: '雨声', url: TRACK_URL }
  const plan = player.errorPlan({
    audio,
    track,
    fromCache: true,
    expected: TRACK_URL,
    now: Date.now() + player.SRC_SETTLE_MS + 1
  })
  assert.equal(plan.action, 'fallback')
  assert.equal(plan.badUrl, TRACK_URL)
  // 6. 远程也失败 → terminal
  const terminal = player.errorPlan({
    audio,
    track,
    fromCache: false,
    expected: TRACK_URL,
    now: Date.now() + player.SRC_SETTLE_MS + 1
  })
  assert.equal(terminal.action, 'terminal')
})

test('markBadSource：文件不可用才删，可用文件只拉黑', () => {
  reset()
  assert.equal(player.markBadSource(''), false)
  // isUsable 默认 false（accessSync 抛错）→ 记录删除动作后拉黑
  let removed = null
  const originalRemove = cache.remove
  const originalUsable = cache.isUsable
  cache.isUsable = () => false
  cache.remove = (url) => {
    removed = url
  }
  try {
    assert.equal(player.markBadSource(TRACK_URL), true)
    assert.equal(removed, TRACK_URL)
  } finally {
    cache.remove = originalRemove
    cache.isUsable = originalUsable
  }
  // 文件健康时不得删
  removed = null
  cache.isUsable = () => true
  cache.remove = (url) => {
    removed = url
  }
  try {
    assert.equal(player.markBadSource(TRACK_URL), true)
    assert.equal(removed, null)
  } finally {
    cache.remove = originalRemove
    cache.isUsable = originalUsable
  }
})

test('trackOf / rebuild：按 id 从配置取曲，缺 id 或非 https 返回 null', () => {
  reset()
  player.setManager(fakeAudio())
  const track = player.trackOf('sleep-10001')
  assert.equal(track.id, 'sleep-10001')
  assert.equal(player.trackOf(''), null)
  const rebuilt = player.rebuild()
  assert.equal(rebuilt.url, TRACK_URL)
  reset({ lastTrackId: 'missing-id' })
  assert.equal(player.rebuild(), null)
})
