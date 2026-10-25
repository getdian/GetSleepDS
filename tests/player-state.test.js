const test = require('node:test')
const assert = require('node:assert/strict')

const playerState = require('../miniprogram/utils/player-state')

test('回退标记只对同一 URL 生效', () => {
  playerState.markFallback('https://cdn.example.com/a.mp3')
  assert.equal(playerState.isFallbacking('https://cdn.example.com/a.mp3'), true)
  assert.equal(playerState.isFallbacking('https://cdn.example.com/b.mp3'), false)
  assert.equal(playerState.isFallbacking(), true)

  playerState.clearFallback()
  assert.equal(playerState.isFallbacking(), false)
})

test('回退标记不会永久残留', () => {
  const originalNow = Date.now
  let now = 1000
  Date.now = () => now
  try {
    playerState.markFallback('https://cdn.example.com/a.mp3')
    now += 9000
    assert.equal(playerState.isFallbacking('https://cdn.example.com/a.mp3'), false)
  } finally {
    Date.now = originalNow
    playerState.clearFallback()
  }
})

test('claimEnded 同一轮只放行一个组件', () => {
  assert.equal(playerState.claimEnded(), true)
  // audio-dock 与 now-playing 会收到同一个 ended，第二个必须让出处理权
  assert.equal(playerState.claimEnded(), false)
})

test('claimEnded 超过去重窗口后可再次接管', () => {
  const originalNow = Date.now
  let now = originalNow() + 10000
  Date.now = () => now
  try {
    assert.equal(playerState.claimEnded(), true)
    assert.equal(playerState.claimEnded(), false)
    now += 900
    assert.equal(playerState.claimEnded(), true)
  } finally {
    Date.now = originalNow
  }
})

// 注意：文件后面已有 loopAudio(duration)（函数声明会提升并覆盖同名），
// 这里用独立名字，避免 duration 变成 undefined 导致用例恒假。
function budgetAudio() {
  return {
    paused: false,
    duration: 2,
    currentTime: 1.5,
    seeks: 0,
    seek(position) {
      this.seeks += 1
      this.currentTime = position
    },
    play() {
      this.paused = false
    }
  }
}

test('回环预算耗尽时 seamlessLoop 不再 seek（坏源不能靠 seek(0) 绕过熔断）', () => {
  const originalNow = Date.now
  playerState._resetClaims()
  // 用一个远大于真实时钟的基准：前面用例可能留下基于真实时间的 claim 记录，
  // 若基准更小会导致 now - claimAt 为负而误判为“窗口内”。
  let now = 10000000000000
  Date.now = () => now
  let budget = false
  playerState.setLoopGuard(() => budget)
  try {
    const audio = budgetAudio()
    assert.equal(playerState.seamlessLoop(audio, 1.2), false)
    assert.equal(audio.seeks, 0, '预算耗尽时不能 seek，让音频自然 ended 后熔断')

    // 用户重新点播后预算恢复：下一个窗口正常回环
    now += 1500
    budget = true
    audio.currentTime = 1.5
    assert.equal(playerState.seamlessLoop(audio, 1.2), true)
    assert.equal(audio.seeks, 1)
  } finally {
    playerState.setLoopGuard(null)
    // mock 时钟会把 loopClaimAt 写成未来值，恢复真实时钟后必须清掉，
    // 否则后续用例的 claimLoop 永远判为“窗口内”。
    playerState._resetClaims()
    Date.now = originalNow
  }
})

test('未注入预算钩子时 seamlessLoop 保持旧行为', () => {
  const originalNow = Date.now
  playerState._resetClaims()
  let now = 20000000000000
  Date.now = () => now
  try {
    const audio = budgetAudio()
    assert.equal(playerState.seamlessLoop(audio, 1.2), true)
    assert.equal(audio.seeks, 1)
  } finally {
    playerState._resetClaims()
    Date.now = originalNow
  }
})

test('claimExpiryToast 在窗口内只让一个组件弹提示', () => {
  const originalNow = Date.now
  let now = 500000
  Date.now = () => now
  try {
    assert.equal(playerState.claimExpiryToast(2000), true)
    // 定时到点时 dock 与 now-playing 可能同时可见，第二个必须让出提示
    assert.equal(playerState.claimExpiryToast(2000), false)
    now += 2000
    assert.equal(playerState.claimExpiryToast(2000), true)
  } finally {
    Date.now = originalNow
  }
})

test('isCurrentSourceError 只忽略“已经切走”的旧源错误', () => {
  // 正常：事件到达时 src 仍是最后一次赋的值
  assert.equal(playerState.isCurrentSourceError('https://a.mp3', 'https://a.mp3'), true)
  // 切歌后旧源错误迟到：必须忽略，否则会误删新曲缓存、误杀新会话
  assert.equal(playerState.isCurrentSourceError('https://b.mp3', 'https://a.mp3'), false)
  // 基础库清空 src / 本进程未记录：无法判定，按当前源保守处理
  assert.equal(playerState.isCurrentSourceError('', 'https://a.mp3'), true)
  assert.equal(playerState.isCurrentSourceError('https://a.mp3', ''), true)
  assert.equal(playerState.isCurrentSourceError('', ''), true)
})

/** 伪造 BackgroundAudioManager：只需 paused/duration/currentTime/seek/play */
function fakeAudio(overrides) {
  return Object.assign(
    {
      paused: false,
      duration: 180,
      currentTime: 0,
      seeks: 0,
      plays: 0,
      seek() {
        this.seeks += 1
      },
      play() {
        this.plays += 1
        this.paused = false
      }
    },
    overrides || {}
  )
}

test('seamlessLoop 只在结尾前窗口内回环（保住微信悬浮音符）', () => {
  const originalNow = Date.now
  let now = 1000000
  Date.now = () => now
  try {
    const audio = fakeAudio({ currentTime: 170 })
    // 距结尾还有 10 秒：不能提前跳走
    assert.equal(playerState.seamlessLoop(audio), false)
    assert.equal(audio.seeks, 0)

    audio.currentTime = 179
    assert.equal(playerState.seamlessLoop(audio), true)
    assert.equal(audio.seeks, 1)

    now += 1300
    // 可自定义更宽的窗口
    const wide = fakeAudio({ currentTime: 176 })
    assert.equal(playerState.seamlessLoop(wide, 5), true)
    assert.equal(wide.seeks, 1)
  } finally {
    Date.now = originalNow
  }
})

test('seamlessLoop 同一轮回环只由一个组件执行', () => {
  const originalNow = Date.now
  let now = 2000000
  Date.now = () => now
  try {
    // audio-dock 与 now-playing 都监听同一个播放器的 onTimeUpdate
    const dock = fakeAudio({ currentTime: 179 })
    const np = fakeAudio({ currentTime: 179 })
    assert.equal(playerState.seamlessLoop(dock), true)
    assert.equal(playerState.seamlessLoop(np), false)
    assert.equal(dock.seeks, 1)
    assert.equal(np.seeks, 0)

    // 窗口过后回到开头再播到结尾，仍能再次回环
    now += 1300
    assert.equal(playerState.seamlessLoop(np), true)
    assert.equal(np.seeks, 1)
  } finally {
    Date.now = originalNow
  }
})

test('seamlessLoop 在 seek 顺带暂停时补一次播放', () => {
  const originalNow = Date.now
  let now = 2500000
  Date.now = () => now
  try {
    const audio = fakeAudio({ currentTime: 179 })
    // 个别基础库 seek(0) 会把播放器置为暂停，回环后必须续播
    audio.seek = function () {
      this.seeks += 1
      this.paused = true
    }
    assert.equal(playerState.seamlessLoop(audio), true)
    assert.equal(audio.seeks, 1)
    assert.equal(audio.plays, 1)
    assert.equal(audio.paused, false)
  } finally {
    Date.now = originalNow
  }
})

test('seamlessLoop 暂停或时长未知时不动', () => {
  const originalNow = Date.now
  let now = 3000000
  Date.now = () => now
  try {
    const paused = fakeAudio({ currentTime: 179, paused: true })
    assert.equal(playerState.seamlessLoop(paused), false)
    assert.equal(paused.seeks, 0)

    const unknown = fakeAudio({ currentTime: 10, duration: NaN })
    assert.equal(playerState.seamlessLoop(unknown), false)
    assert.equal(unknown.seeks, 0)

    const zero = fakeAudio({ currentTime: 10, duration: 0 })
    assert.equal(playerState.seamlessLoop(zero), false)
    assert.equal(zero.seeks, 0)
  } finally {
    Date.now = originalNow
  }
})

/** 回环定时器需要能自己推进 currentTime 的播放器：seamlessLoop 读的是真实进度。 */
function loopAudio(duration) {
  return {
    paused: false,
    duration,
    currentTime: 0,
    seeks: 0,
    seek(position) {
      this.seeks += 1
      this.currentTime = position
    },
    play() {
      this.paused = false
    }
  }
}

test('armLoop 在没有 timeupdate 的后台也能按时回环', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  playerState.clearLoopTimer()
  // 绕过 claimLoop 的 1.2s 去重窗口：同一进程里前一个用例可能刚回环过
  const originalNow = Date.now
  Date.now = () => originalNow() + 5000
  try {
    const audio = loopAudio(100)
    audio.currentTime = 10
    assert.equal(playerState.armLoop(audio), true)

    // 还没到回环点：不能提前 seek
    t.mock.timers.tick(80000)
    assert.equal(audio.seeks, 0)

    audio.currentTime = 99
    t.mock.timers.tick(8800)
    assert.equal(audio.seeks, 1)
    assert.equal(audio.currentTime, 0)
  } finally {
    Date.now = originalNow
    playerState.clearLoopTimer()
  }
})

test('armLoop 被提前唤醒时按最新位置重排', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  playerState.clearLoopTimer()
  const originalNow = Date.now
  Date.now = () => originalNow() + 10000
  try {
    const audio = loopAudio(100)
    audio.currentTime = 10
    playerState.armLoop(audio)

    // 定时器被系统节流提前唤醒：位置没到结尾，只重排不 seek
    t.mock.timers.tick(88800)
    assert.equal(audio.seeks, 0)

    audio.currentTime = 99
    t.mock.timers.tick(88800)
    assert.equal(audio.seeks, 1)
  } finally {
    Date.now = originalNow
    playerState.clearLoopTimer()
  }
})

test('armLoop 暂停或时长未知时不排定时器', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  playerState.clearLoopTimer()
  const paused = loopAudio(100)
  paused.paused = true
  assert.equal(playerState.armLoop(paused), false)
  assert.equal(playerState.armLoop(loopAudio(0)), false)
  assert.equal(playerState.armLoop(null), false)
})
