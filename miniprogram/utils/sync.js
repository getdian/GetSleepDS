const api = require('./api')
const storage = require('./storage')
const { getConfig } = require('./config')
const { wxLogin } = require('./login')

const THROTTLE_MS = 60 * 60 * 1000
const SPAN_DAYS = 60

function collect() {
  const records = storage.getRecords()
  const now = Date.now()
  const list = []
  Object.keys(records).forEach((day) => {
    const r = records[day]
    if (!r || !r.wakeAt) return
    if (now - r.wakeAt > SPAN_DAYS * 24 * 60 * 60 * 1000) return
    list.push({
      day: r.day,
      bedAt: r.bedAt,
      wakeAt: r.wakeAt,
      updatedAt: r.updatedAt || r.wakeAt
    })
  })
  return list
}

/**
 * 把云端记录回填到本地（换机 / 清缓存恢复）。
 * 已撤销的日期由墓碑挡住，避免旧数据复活。
 */
function mergeServerRecords(serverRecords) {
  if (!Array.isArray(serverRecords) || !serverRecords.length) return 0

  const local = storage.getRecords()
  const deleted = storage.getDeleted()
  let changed = 0

  serverRecords.forEach((item) => {
    if (!item || !item.day) return
    if (typeof item.bedAt !== 'number' || typeof item.wakeAt !== 'number') return
    if (item.wakeAt <= item.bedAt) return

    const stamp = item.updatedAt || item.wakeAt
    if (deleted[item.day] && deleted[item.day] >= stamp) return

    const current = local[item.day]
    if (current && (current.updatedAt || 0) >= stamp) return

    storage.saveRecord({
      day: item.day,
      bedAt: item.bedAt,
      wakeAt: item.wakeAt,
      durationMin: item.durationMin || Math.round((item.wakeAt - item.bedAt) / 60000),
      updatedAt: stamp
    })
    changed += 1
  })

  return changed
}

/**
 * 静默云备份：上传本地记录，并接收云端回填。
 * 失败不抛给调用方，也不影响打卡。
 */
function syncNow(force) {
  const config = getConfig()
  if (!config.features || !config.features.sync) {
    return Promise.resolve({ skipped: 'feature_off' })
  }

  const meta = storage.getMeta()
  if (!force && meta.lastSyncAt && Date.now() - meta.lastSyncAt < THROTTLE_MS) {
    return Promise.resolve({ skipped: 'throttled' })
  }

  // 本地为空也要请求一次，否则换机后拿不到云端记录
  const records = collect()

  return wxLogin()
    .then((code) => api.syncRecords(code, records))
    .then((res) => {
      const restored = mergeServerRecords(res && res.records)
      storage.patchMeta({ lastSyncAt: Date.now() })
      return { synced: res ? res.synced : 0, restored }
    })
}

module.exports = { syncNow, collect, mergeServerRecords }
