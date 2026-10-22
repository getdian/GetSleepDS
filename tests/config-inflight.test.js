const test = require('node:test')
const assert = require('node:assert/strict')

const memory = {}
global.wx = {
  getStorageSync(key) {
    return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : ''
  },
  setStorageSync(key, value) {
    memory[key] = JSON.parse(JSON.stringify(value))
  },
  removeStorageSync(key) {
    delete memory[key]
  }
}

const storage = require('../miniprogram/utils/storage')
const api = require('../miniprogram/utils/api')
const { loadConfig } = require('../miniprogram/utils/config')

test('冷启动并发 loadConfig 只发一次请求', async () => {
  storage.clearAll()
  let calls = 0
  const original = api.fetchConfig
  api.fetchConfig = () => {
    calls += 1
    return new Promise((resolve) => {
      setTimeout(() => resolve({ audio: [], features: { sync: true } }), 10)
    })
  }
  try {
    await Promise.all([loadConfig(false), loadConfig(false), loadConfig(false)])
    assert.equal(calls, 1)
  } finally {
    api.fetchConfig = original
  }
})

test('force 请求在途时，非 force 不能拿旧缓存短路', async () => {
  // config 模块有 3 秒 force 去重窗口（app.onShow 与页面 onShow 各 force 一次），
  // 这是模块级状态：测试要拿到"冷启动"语义，必须重新加载模块。
  delete require.cache[require.resolve('../miniprogram/utils/config')]
  const freshConfig = require('../miniprogram/utils/config')
  storage.clearAll()
  storage.setConfigCache({ version: 1, backgrounds: [], audio: [] })
  let calls = 0
  const original = api.fetchConfig
  api.fetchConfig = () => {
    calls += 1
    return new Promise((resolve) => {
      setTimeout(() => resolve({ version: 2, backgrounds: [], audio: [] }), 20)
    })
  }
  try {
    const force = freshConfig.loadConfig(true)
    const normal = freshConfig.loadConfig(false)
    assert.equal(calls, 1)
    const [fresh, shared] = await Promise.all([force, normal])
    assert.equal(fresh.version, 2)
    assert.equal(shared.version, 2)
  } finally {
    api.fetchConfig = original
  }
})
