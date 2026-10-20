const test = require('node:test')
const assert = require('node:assert/strict')

const memory = {}
const files = {}

global.wx = {
  getStorageSync(key) {
    return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : ''
  },
  setStorageSync(key, value) {
    memory[key] = JSON.parse(JSON.stringify(value))
  },
  removeStorageSync(key) {
    delete memory[key]
  },
  getFileSystemManager() {
    return {
      accessSync(path) {
        if (!files[path]) throw new Error('no file')
      },
      unlinkSync(path) {
        delete files[path]
      }
    }
  }
}

const storage = require('../miniprogram/utils/storage')
const backgrounds = require('../miniprogram/utils/backgrounds')

test('背景缓存失效路径会自愈，不会每次先失败再回退远程', () => {
  storage.clearAll()
  files['/u/bg-a.img'] = true
  storage.setBackgroundCache('https://x/a.jpg', '/u/bg-a.img')
  assert.equal(backgrounds.localPathOf('https://x/a.jpg'), '/u/bg-a.img')

  delete files['/u/bg-a.img']
  assert.equal(backgrounds.localPathOf('https://x/a.jpg'), '')
  assert.equal(storage.getBackgroundCache()['https://x/a.jpg'], undefined)
})

test('背景缓存淘汰与清空会删除本地文件', () => {
  storage.clearAll()
  for (let i = 0; i < 8; i += 1) {
    const path = '/u/bg-' + i + '.img'
    files[path] = true
    storage.setBackgroundCache('https://x/' + i + '.jpg', path)
  }
  const cache = storage.getBackgroundCache()
  assert.equal(Object.keys(cache).length, 6)
  const kept = Object.keys(cache).map((url) => cache[url].path)
  const leaked = Object.keys(files).filter((path) => kept.indexOf(path) < 0)
  assert.equal(leaked.length, 0)

  backgrounds.cleanCache()
  assert.deepEqual(files, {})
  assert.deepEqual(storage.getBackgroundCache(), {})
})
