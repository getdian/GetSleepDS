/**
 * 订阅消息热启动：App.onShow 收到意图后，入睡页 onShow 必须还能消费。
 * 这里锁定纯状态机，页面接线由 sleep-page 用例覆盖。
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const launchIntent = require('../miniprogram/utils/launch-intent')

test('冷启动 end=1 意图只消费一次', () => {
  launchIntent.reset()
  const captured = launchIntent.capture({ query: { end: '1' } }, 1000)
  assert.equal(captured.end, true)
  const taken = launchIntent.take(2000)
  assert.equal(taken.end, true)
  assert.equal(taken.remind, '')
  assert.equal(launchIntent.take(3000), null, '同一条意图不能重复开结束面板')
})

test('热启动 remind=sleep/wake 都能归一化', () => {
  launchIntent.reset()
  launchIntent.capture({ query: { remind: 'sleep' } }, 1000)
  const sleep = launchIntent.take(1100)
  assert.equal(sleep.end, false)
  assert.equal(sleep.remind, 'sleep')
  assert.equal(launchIntent.take(1200), null, '同一条意图不能重复消费')

  launchIntent.reset()
  launchIntent.capture({ query: { remind: 'wake' } }, 1000)
  const wake = launchIntent.take(1100)
  assert.equal(wake.end, false)
  assert.equal(wake.remind, 'wake')
})

test('普通回前台没有 query 时不产生意图', () => {
  launchIntent.reset()
  assert.equal(launchIntent.capture({ query: {} }, 1000), null)
  assert.equal(launchIntent.capture(null, 1000), null)
  assert.equal(launchIntent.take(1000), null)
  assert.equal(launchIntent.hasPending(), false)
})

test('onLaunch 已捕获时 onShow 不再覆盖同一条意图', () => {
  launchIntent.reset()
  launchIntent.capture({ query: { end: '1' } }, 1000)
  assert.equal(launchIntent.hasPending(), true)
  // 模拟 App.onShow 首次回调：已有 pending 就不再 capture
  if (!launchIntent.hasPending()) launchIntent.capture({ query: { remind: 'wake' } }, 1100)
  const intent = launchIntent.take(1200)
  assert.equal(intent.end, true)
  assert.equal(intent.remind, '')
})

test('超过 TTL 的旧意图丢弃，避免普通前台被旧提醒触发', () => {
  launchIntent.reset()
  launchIntent.capture({ query: { end: '1' } }, 1000)
  assert.equal(launchIntent.take(1000 + launchIntent.MAX_AGE_MS + 1), null)
})
