const test = require('node:test')
const assert = require('node:assert/strict')

let downloads = 0
let savedPath = ''
let accessShouldFail = false
let failFirstRename = false
const renameCalls = []
const unlinkCalls = []
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
      renameSync(from, to) {
        renameCalls.push([from, to])
        if (failFirstRename && renameCalls.length === 1) throw new Error('rename denied')
      },
      unlinkSync(path) {
        unlinkCalls.push(path)
      },
      accessSync() {
        if (accessShouldFail) throw new Error('file gone')
      },
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

test('isUsable 只反映磁盘事实：不判 TTL、不删记录、不通知', () => {
  const url = 'https://cdn.example.com/sleep/wind.mp3'
  // 没有缓存记录
  assert.equal(cache.isUsable(url), false)
  // 有记录且文件可访问
  storage['sleep:audio-cache:v1'] = {
    [url]: { path: '/tmp/getsleep-audio-test/wind.mp3', savedAt: Date.now() }
  }
  assert.equal(cache.isUsable(url), true)
  // 文件丢失（播放报错的真实原因之一）
  accessShouldFail = true
  try {
    assert.equal(cache.isUsable(url), false)
  } finally {
    accessShouldFail = false
  }
  // 只读：记录仍在（删除与否由调用方决定）
  assert.ok(storage['sleep:audio-cache:v1'][url])
})

test('sizeOf 只返回该曲目的缓存大小，删除后归零', async () => {
  const url = 'https://cdn.example.com/size-only.mp3'
  assert.equal(cache.sizeOf(url), 0, '未缓存时为 0')
  const path = await cache.ensure(url, null, 7)
  assert.ok(path)
  assert.equal(cache.sizeOf(url), 1024)
  cache.remove(url)
  assert.equal(cache.sizeOf(url), 0)
})

test('缓存替换不 unlink 正在播放的 dest：先备份再换入', async () => {
  renameCalls.length = 0
  unlinkCalls.length = 0
  failFirstRename = true
  const url = 'https://cdn.example.com/sleep/stream.mp3'
  try {
    const path = await cache.ensure(url, null, 7)
    assert.ok(path, '下载应成功')
    // 第一次覆盖失败后：dest 改名备份，再换入新文件
    assert.equal(renameCalls[0][1], path, '第一次尝试直接覆盖')
    assert.equal(renameCalls[1][0], path, '第二次先把 dest 改名备份')
    assert.ok(renameCalls[1][1].indexOf('.old-') > 0)
    assert.ok(renameCalls[2][1] === path, '第三次把临时文件换入 dest')
    assert.equal(
      unlinkCalls.indexOf(path),
      -1,
      '绝不能 unlink 正在播放的 dest（会让 seek/循环重开失败）'
    )
    assert.equal(unlinkCalls.length, 1, '只清理备份文件')
  } finally {
    failFirstRename = false
  }
})

test('播放后自动缓存：Wi-Fi 立即，移动网络延迟 15 秒', () => {
  assert.equal(cache.autoCacheDelay('wifi'), 0)
  assert.equal(cache.autoCacheDelay('4g'), 15000)
  assert.equal(cache.autoCacheDelay('5g'), 15000)
  assert.equal(cache.autoCacheDelay(''), 15000)
})

test('自动缓存容量闸：占用达到 maxMB 后不再自动下载', () => {
  const saved = storage['sleep:audio-cache:v1']
  const MB = 1024 * 1024
  try {
    storage['sleep:audio-cache:v1'] = { a: { path: '/x/a.mp3', size: 30 * MB, savedAt: Date.now() } }
    assert.equal(cache.canAutoCache({ maxMB: 80 }), true)
    storage['sleep:audio-cache:v1'] = {
      a: { path: '/x/a.mp3', size: 50 * MB, savedAt: Date.now() },
      b: { path: '/x/b.mp3', size: 30 * MB, savedAt: Date.now() }
    }
    assert.equal(cache.canAutoCache({ maxMB: 80 }), false, '恰好到上限也不再自动下载')
    assert.equal(cache.canAutoCache(null), false, '缺省上限 80MB')
    assert.equal(cache.canAutoCache({ maxMB: 200 }), true)
  } finally {
    storage['sleep:audio-cache:v1'] = saved
  }
})

test('坏源黑名单：标记后不命中缓存，重下成功自动解禁', async () => {
  const url = 'https://cdn.example.com/sleep/broken-loop.mp3'
  storage['sleep:audio-cache:v1'] = {
    ...(storage['sleep:audio-cache:v1'] || {}),
    [url]: { path: '/tmp/getsleep-audio-test/broken-loop.mp3', savedAt: Date.now() }
  }
  assert.ok(cache.peek(url, 7, url), '正常文件应命中')

  cache.markBad(url)
  assert.equal(cache.isBad(url), true)
  // 组件与 audio-session 都走 peek：坏源必须回退远程，避免每轮循环重演“报错→回退”
  assert.equal(cache.peek(url, 7, url), '')
  assert.equal(cache.cachedCount([{ url: url }], 7, url), 0, '坏源不计入“已缓存”数量')

  // ensure 会重新下载（文件仍在但播放失败），成功后自动解禁
  const path = await cache.ensure(url, null, 7)
  assert.ok(path)
  assert.equal(cache.isBad(url), false)
  assert.ok(cache.peek(url, 7, url))

  // 删除缓存记录同样解除标记
  cache.markBad(url)
  cache.remove(url)
  assert.equal(cache.isBad(url), false)
})

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
