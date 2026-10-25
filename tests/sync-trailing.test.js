const test = require('node:test')
const assert = require('node:assert/strict')

const memory = {}
global.wx = {
  getStorageSync(key) {
    return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : ''
  },
  setStorageSync(key, value) {
    memory[key] = value
  },
  removeStorageSync(key) {
    delete memory[key]
  },
  login(options) {
    options.success({ code: 'test-code' })
  },
  showToast() {}
}

const storage = require('../miniprogram/utils/storage')
const api = require('../miniprogram/utils/api')
const T = require('../miniprogram/utils/time')
const sync = require('../miniprogram/utils/sync')

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve))
}

async function waitFor(predicate, rounds) {
  for (let i = 0; i < (rounds || 50); i += 1) {
    if (predicate()) return true
    await tick()
  }
  return predicate()
}

function setup() {
  storage.clearAll()
  storage.setSyncEnabled(true)
  storage.patchMeta({ lastSyncAt: 0, syncEpoch: 0, cloudPendingErase: false })
}

function localRecord(day, updatedAt) {
  // collect 只收 400 天窗口内的记录，时间戳必须落在当前时刻附近
  const wakeAt = Date.now()
  return { day, bedAt: wakeAt - 8 * 3600 * 1000, wakeAt, durationMin: 480, updatedAt }
}

test('在途同步期间的新修改会触发 trailing 轮，第二个调用方等到 trailing 完成', async () => {
  setup()
  const day = T.dateKey(Date.now())
  storage.saveRecord(localRecord(day, 100))

  const first = deferred()
  const second = deferred()
  const calls = []
  api.syncRecords = (code, records) => {
    calls.push(records)
    if (calls.length === 1) return first.promise
    if (calls.length === 2) return second.promise
    return Promise.resolve({ synced: 0, records: [] })
  }

  let secondSettled = false
  const p1 = sync.syncNow(true)
  assert.equal(await waitFor(() => calls.length === 1), true, '首轮应发出请求')

  // 首轮在途：新增一段并再次请求同步（快照里没有这条）
  const extraDay = T.dateKey(Date.now() - 24 * 3600 * 1000)
  storage.saveRecord(localRecord(extraDay, 200))
  const p2 = sync.syncNow(true).then((res) => {
    secondSettled = true
    return res
  })

  first.resolve({ synced: 1, records: [] })
  assert.equal(await waitFor(() => calls.length === 2), true, '必须补跑 trailing 轮')
  assert.equal(secondSettled, false, 'trailing 未完成前第二个调用方不能返回成功')
  assert.equal(
    calls[1].some((item) => item.day === extraDay),
    true,
    'trailing 轮必须包含在途期间的新记录'
  )

  second.resolve({ synced: 2, records: [] })
  const [r1, r2] = await Promise.all([p1, p2])
  assert.equal(r2.rounds, 2)
  assert.equal(r1.rounds, 2)
  assert.ok(storage.getMeta().lastSyncAt > 0, '全部轮次完成后才写 lastSyncAt')
})

test('无在途修改时只跑一轮', async () => {
  setup()
  const day = T.dateKey(Date.now())
  storage.saveRecord(localRecord(day, 100))
  const calls = []
  api.syncRecords = (code, records) => {
    calls.push(records)
    return Promise.resolve({ synced: records.length, records: [] })
  }
  const result = await sync.syncNow(true)
  assert.equal(calls.length, 1)
  assert.equal(result.completed, true)
  assert.equal(result.rounds, undefined)
  assert.ok(storage.getMeta().lastSyncAt > 0)
})

test('whenIdle 会等待 trailing 轮结束', async () => {
  setup()
  const day = T.dateKey(Date.now())
  storage.saveRecord(localRecord(day, 100))
  const first = deferred()
  const second = deferred()
  const calls = []
  api.syncRecords = () => {
    calls.push(1)
    if (calls.length === 1) return first.promise
    return second.promise
  }
  const p1 = sync.syncNow(true)
  await waitFor(() => calls.length === 1)
  const p2 = sync.syncNow(true)
  let idleDone = false
  const idle = sync.whenIdle().then(() => {
    idleDone = true
  })
  first.resolve({ synced: 1, records: [] })
  await waitFor(() => calls.length === 2)
  await tick()
  assert.equal(idleDone, false, 'trailing 在途时 whenIdle 不能放行')
  second.resolve({ synced: 1, records: [] })
  await Promise.all([p1, p2, idle])
  assert.equal(idleDone, true)
})
