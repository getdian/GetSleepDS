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

/** 与 PG 实现同口径的假库：revision 单调递增，CAS 不匹配返回 null。 */
function createFakeDb() {
  let row = null
  return {
    async getAppConfig() {
      if (!row) return null
      return { value: JSON.parse(JSON.stringify(row.value)), updatedAt: row.updatedAt, revision: row.revision }
    },
    async saveAppConfig(value, options) {
      const expected =
        options && options.expectedRevision !== undefined && options.expectedRevision !== null
          ? Number(options.expectedRevision)
          : null
      const current = row ? Number(row.revision) : 0
      if (expected !== null && current !== expected) return null
      const revision = current + 1
      const updatedAt = Date.now()
      row = { value: JSON.parse(JSON.stringify(value)), updatedAt, revision }
      return { updatedAt, revision }
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

test('revision 单调递增，可作为并发基线', async () => {
  const store = createConfigStore({ db: createFakeDb(), fileConfig: {} })
  const first = await store.get()
  assert.equal(first.revision, 0, '文件配置没有发布版本')

  const saved = await store.save({ audio: AUDIO }, { expectedRevision: first.revision })
  assert.equal(saved.revision, 1)
})

test('revision 不匹配返回 409：并发保存只有一个能成功', async () => {
  const store = createConfigStore({ db: createFakeDb(), fileConfig: {} })
  const base = await store.get()

  const first = await store.save({ audio: AUDIO }, { expectedRevision: base.revision })
  assert.equal(first.revision, 1)

  // 第二个保存者仍带着同一基线 → 必须被拒，不能静默覆盖
  await assert.rejects(
    () => store.save({ audio: AUDIO }, { expectedRevision: base.revision }),
    (error) => {
      assert.equal(error.code, 'CONFIG_CONFLICT')
      assert.equal(error.status, 409)
      return true
    }
  )
})

test('冲突后缓存失效：重新读取拿到的是最新版本而不是旧缓存', async () => {
  const db = createFakeDb()
  const store = createConfigStore({ db, fileConfig: {} })
  const base = await store.get()

  await store.save({ audio: AUDIO }, { expectedRevision: base.revision })
  await assert.rejects(() => store.save({ audio: AUDIO }, { expectedRevision: base.revision }))

  const fresh = await store.get()
  assert.equal(fresh.revision, 1)
})
