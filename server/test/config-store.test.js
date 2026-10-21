const { test } = require('node:test')
const assert = require('node:assert/strict')

const { createConfigStore } = require('../src/services/config-store')

const AUDIO = [
  {
    id: 'sleep-10001',
    title: '雨声',
    subtitle: '循环播放 · 支持锁屏',
    category: '雨声',
    url: 'https://example.com/a.mp3',
    icon: 'rain'
  }
]

function createFakeDb() {
  let row = null
  return {
    async getAppConfig() {
      return row
    },
    async saveAppConfig(value) {
      const updatedAt = Date.now()
      row = { value: JSON.parse(JSON.stringify(value)), updatedAt }
      return updatedAt
    }
  }
}

test('保存时携带的 baseUpdatedAt 不一致会返回 409，避免并发覆盖', async () => {
  const store = createConfigStore({ db: createFakeDb(), fileConfig: {} })
  const first = await store.get()

  const saved = await store.save({ audio: AUDIO }, { expectedUpdatedAt: first.updatedAt })
  assert.equal(typeof saved.updatedAt, 'number')
  assert.equal(saved.config.version, (first.config.version || 1) + 1)

  await assert.rejects(
    () => store.save({ audio: AUDIO }, { expectedUpdatedAt: first.updatedAt }),
    (error) => {
      assert.equal(error.code, 'CONFIG_CONFLICT')
      assert.equal(error.status, 409)
      assert.match(error.message, /已被其他管理员更新/)
      return true
    }
  )
})

test('不传 baseUpdatedAt（脚本/内部调用）保持原行为', async () => {
  const store = createConfigStore({ db: createFakeDb(), fileConfig: {} })
  const saved = await store.save({ audio: AUDIO })
  assert.equal(typeof saved.updatedAt, 'number')
})
