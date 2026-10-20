const test = require('node:test')
const assert = require('node:assert/strict')

const { createStorageSettings } = require('../src/services/storage-settings')

test('数据库不可用时存储配置返回 503，而不是 500', async () => {
  const settings = createStorageSettings({
    db: {
      async getSetting() {
        throw new Error('connection refused')
      }
    },
    secretBox: { decrypt: () => '' },
    securityReady: true
  })

  await assert.rejects(
    () => settings.getPublic(),
    (error) => error.status === 503 && error.code === 'DB_UNAVAILABLE'
  )
})
