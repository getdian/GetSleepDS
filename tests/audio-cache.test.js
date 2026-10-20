const test = require('node:test')
const assert = require('node:assert/strict')

let downloads = 0
let savedPath = ''
const storage = {}

global.wx = {
  env: { USER_DATA_PATH: '/tmp/getsleep-audio-test' },
  getStorageSync(key) {
    return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : ''
  },
  setStorageSync(key, value) {
    storage[key] = value
  },
  getFileSystemManager() {
    return {
      access(options) {
        if (options && options.success) options.success()
      },
      mkdir(options) {
        if (options && options.success) options.success()
      },
      saveFile(options) {
        savedPath = options.filePath
        if (options && options.success) options.success()
      },
      renameSync() {},
      unlinkSync() {},
      accessSync() {},
      statSync() {
        return { size: 1024 }
      }
    }
  },
  downloadFile(options) {
    downloads += 1
    setTimeout(() => {
      if (options && options.success) {
        options.success({ statusCode: 200, tempFilePath: '/tmp/download-temp.mp3', dataLength: 1024 })
      }
    }, 0)
    return {
      onProgressUpdate() {},
      abort() {}
    }
  }
}

const cache = require('../miniprogram/utils/audio-cache')

test('同一 URL 并发 ensure 只发起一次下载', async () => {
  downloads = 0
  savedPath = ''
  const url = 'https://cdn.example.com/sleep/rain.mp3'
  const first = cache.ensure(url, null, 7)
  const second = cache.ensure(url, null, 7)
  const [a, b] = await Promise.all([first, second])
  assert.equal(a, b)
  assert.ok(a.endsWith('.mp3'))
  assert.ok(savedPath.startsWith(a + '.part-'))
  assert.equal(downloads, 1)
})
