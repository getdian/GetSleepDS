const api = require('./api')
const storage = require('./storage')
const { getConfig } = require('./config')
const { withLogin } = require('./login')

const THROTTLE_MS = 60 * 60 * 1000
const SPAN_DAYS = 60
const MAX_SLEEP_MS = 20 * 60 * 60 * 1000

function collect() {
  const records = storage.getRecords()
  const now = Date.now()
  const list = []
  Object.keys(records).forEach((day) => {
    const r = records[day]
    if (!r || !r.wakeAt || !r.bedAt) return
    if (r.wakeAt <= r.bedAt || r.wakeAt - r.bedAt > MAX_SLEEP_MS) return
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

function removeLocal(day, stamp) {
  storage.removeRecord(day)
  storage.markDeleted(day, stamp)
  return stamp
}

/**
 * 把云端记录回填到本地（换机 / 清缓存恢复）。
 * 服务端下发的单日墓碑和全量清除水位优先于旧记录，避免删除被复活。
 */
function mergeServerRecords(serverRecords, options) {
  const opts = options || {}
  const local = storage.getRecords()
  const deleted = storage.getDeleted()
  const erasedAt = Number(opts.erasedAt) || 0
  let changed = 0

  if (erasedAt) {
    Object.keys(local).forEach((day) => {
      const stamp = local[day].updatedAt || 0
      if (stamp <= erasedAt) {
        removeLocal(day, erasedAt)
        deleted[day] = erasedAt
        delete local[day]
        changed += 1
      }
    })
  }

  ;(opts.deletedDays || []).forEach((item) => {
    if (!item || !item.day || typeof item.deletedAt !== 'number') return
    const current = local[item.day]
    if (!current || (current.updatedAt || 0) <= item.deletedAt) {
      removeLocal(item.day, item.deletedAt)
      deleted[item.day] = item.deletedAt
      delete local[item.day]
      if (current) changed += 1
    }
  })

  if (!Array.isArray(serverRecords) || !serverRecords.length) return changed

  serverRecords.forEach((item) => {
    if (!item || !item.day) return
    if (typeof item.bedAt !== 'number' || typeof item.wakeAt !== 'number') return
    if (item.wakeAt <= item.bedAt || item.wakeAt - item.bedAt > MAX_SLEEP_MS) return

    const stamp = item.updatedAt || item.wakeAt
    if (deleted[item.day] && deleted[item.day] >= stamp) return

    const current = local[item.day]
    if (current && (current.updatedAt || 0) >= stamp) return

    const saved = storage.saveRecord({
      day: item.day,
      bedAt: item.bedAt,
      wakeAt: item.wakeAt,
      durationMin: item.durationMin || Math.round((item.wakeAt - item.bedAt) / 60000),
      updatedAt: stamp
    })
    if (saved) {
      local[item.day] = { day: item.day, bedAt: item.bedAt, wakeAt: item.wakeAt, updatedAt: stamp }
      changed += 1
    }
  })

  return changed
}

/**
 * 静默云备份：上传本地记录与删除墓碑，并接收云端回填。
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

  // 本地为空也要请求一次，否则换机后拿不到云端记录 / 删除水位
  const records = collect()
  const deletedDays = storage.getDeletedList()
  const epoch = meta.syncEpoch || 0

  return withLogin((code) => api.syncRecords(code, records, deletedDays))
    .then((res) => {
      // 清除数据/后台删除可能发生在请求期间，旧响应必须丢弃
      if ((storage.getMeta().syncEpoch || 0) !== epoch) {
        return { skipped: 'stale' }
      }
      const restored = mergeServerRecords(res && res.records, {
        deletedDays: res && res.deletedDays,
        erasedAt: res && res.erasedAt
      })
      storage.patchMeta({ lastSyncAt: Date.now() })
      return {
        synced: res ? res.synced : 0,
        dropped: res ? res.dropped : 0,
        restored
      }
    })
}

module.exports = { syncNow, collect, mergeServerRecords }
