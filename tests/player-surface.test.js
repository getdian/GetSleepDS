const test = require('node:test')
const assert = require('node:assert/strict')

const { resolvePlayerSurface } = require('../miniprogram/utils/player-surface')

function input(overrides) {
  return Object.assign(
    {
      lastTrackId: 'sleep-10001',
      lastTrackActive: true,
      lastTrackPlaying: true,
      hasSrc: true,
      playingNow: true,
      sessionLive: true
    },
    overrides
  )
}

test('正常播放中：入口可见且 playing', () => {
  const surface = resolvePlayerSurface(input())
  assert.equal(surface.visible, true)
  assert.equal(surface.playing, true)
  assert.equal(surface.cold, false)
})

test('用户显式停止（lastTrackActive=false）才隐藏入口', () => {
  const surface = resolvePlayerSurface(input({ lastTrackActive: false, hasSrc: false, playingNow: false }))
  assert.equal(surface.visible, false)
  assert.equal(surface.reason, 'stopped')
})

test('冷启动（无 src、本进程未播）仍显示为已暂停，不清会话', () => {
  const surface = resolvePlayerSurface(
    input({ hasSrc: false, playingNow: false, sessionLive: false, lastTrackPlaying: true })
  )
  assert.equal(surface.visible, true, '重进小程序必须还能看到播放条')
  assert.equal(surface.playing, false, '冷启动不能假装正在播放')
  assert.equal(surface.cold, true, '调用方据此把 lastTrackPlaying 归零（而不是清会话）')
})

test('微信悬浮 X 停止（有会话但已暂停）：入口保留、显示已暂停', () => {
  const surface = resolvePlayerSurface(
    input({ hasSrc: false, playingNow: false, sessionLive: true, lastTrackPlaying: false })
  )
  assert.equal(surface.visible, true)
  assert.equal(surface.playing, false)
  assert.equal(surface.cold, false)
})

test('外部中断（src 暂空但本进程播过）：保留入口，不判残影', () => {
  const surface = resolvePlayerSurface(input({ hasSrc: false, playingNow: false, sessionLive: true }))
  assert.equal(surface.visible, true)
  assert.equal(surface.cold, false)
})

test('没有 lastTrackId：不渲染任何入口', () => {
  const surface = resolvePlayerSurface(input({ lastTrackId: '', hasSrc: false, playingNow: false, sessionLive: false }))
  assert.equal(surface.visible, false)
  assert.equal(surface.reason, 'no_track')
})

test('有 src 但 pause 事件丢失：用持久化标记兜底为播放中', () => {
  const surface = resolvePlayerSurface(input({ playingNow: false, lastTrackPlaying: true }))
  assert.equal(surface.playing, true)
})
