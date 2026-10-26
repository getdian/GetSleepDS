const test = require('node:test')
const assert = require('node:assert/strict')

const { resolvePlayerSurface, isReallyPlaying } = require('../miniprogram/utils/player-surface')

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

test('有 src 但实际暂停（冷启动残留 src）：必须显示已暂停，不能假装播放中', () => {
  // 体验版真机复现：BAM 冷启动保留上次 src、paused=true，
  // 旧逻辑用 lastTrackPlaying 兜底 → 条子显示“正在播放”却没有声音。
  const surface = resolvePlayerSurface(
    input({ hasSrc: true, playingNow: false, sessionLive: false, lastTrackPlaying: true })
  )
  assert.equal(surface.visible, true, '入口仍要在，用户能点继续')
  assert.equal(surface.playing, false, '没在出声就不能显示正在播放')
  assert.equal(surface.cold, true, '调用方据此把 lastTrackPlaying 归零')
})

test('没有音源时即使调用方传 playingNow=true 也必须判为暂停（BAM paused=undefined 陷阱）', () => {
  // 体验版真机：无 src 时 audio.paused 是 undefined，调用方 !paused 恒为 true
  const surface = resolvePlayerSurface(input({ hasSrc: false, playingNow: true, sessionLive: false }))
  assert.equal(surface.playing, false, '没有音源不可能在播放')
  assert.equal(surface.visible, true, '入口保留，用户点继续时会重建音源')
})

test('本次进程内用户主动暂停：显示已暂停，但不判冷启动', () => {
  const surface = resolvePlayerSurface(input({ hasSrc: true, playingNow: false, sessionLive: true }))
  assert.equal(surface.playing, false)
  assert.equal(surface.cold, false, '不能把用户暂停当残影重复归零')
})

test('isReallyPlaying：没有音源时 paused=undefined 不算在播', () => {
  // 迷你条内部所有“是否在出声”的判断都走这个函数，避免各处再写 !paused
  assert.equal(isReallyPlaying(null), false)
  assert.equal(isReallyPlaying({ paused: undefined }), false)
  assert.equal(isReallyPlaying({ src: '', paused: false }), false)
})

test('isReallyPlaying：有音源且 paused 严格为 false 才算在播', () => {
  assert.equal(isReallyPlaying({ src: 'https://img.example/a.mp3', paused: false }), true)
  assert.equal(isReallyPlaying({ src: 'https://img.example/a.mp3', paused: true }), false)
  assert.equal(isReallyPlaying({ src: 'https://img.example/a.mp3' }), false)
})
