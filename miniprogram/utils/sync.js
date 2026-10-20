const api = require('./api')
const storage = require('./storage')
const T = require('./time')
const { getConfig } = require('./config')
const { withLogin } = require('./login')

const THROTTLE_MS = 60 * 60 * 1000
// 云备份要能覆盖热力图的完整历史；服务端单次最多 62 条，客户端按 60 条分片。
const SPAN_DAYS = 400
const CHUNK_SIZE = 60
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_SLEEP_MS = 20 * 60 * 60 * 1000
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

let inflight = null

function isValidDay(day) {
  const match = DAY_PATTERN.exec(String(day || ''))
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const date = Number(match[3])
  const parsed = new Date(Date.UTC(year, month - 1, date))
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === date
  )
}

function collect(now, spanDays) {
  const records = storage.getRecords()
  const current = now || Date.now()
  const span = (spanDays || SPAN_DAYS) * DAY_MS
  const list = []
  Object.keys(records).forEach((day) => {
    const r = records[day]
    if (!r || !r.wakeAt || !r.bedAt) return
    if (r.wakeAt <= r.bedAt || r.wakeAt - r.bedAt > MAX_SLEEP_MS) return
    if (current - r.wakeAt > span) return
    list.push({
      day: r.day,
      bedAt: r.bedAt,
      wakeAt: r.wakeAt,
      updatedAt: r.updatedAt || r.wakeAt
    })
  })
  // 按睡眠日升序，便于分片与排障
  return list.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
}

function chunk(list, size) {
  const source = Array.isArray(list) ? list : []
  const step = Number(size) || CHUNK_SIZE
  const out = []
  for (let i = 0; i < source.length; i += step) {
    out.push(source.slice(i, i + step))
  }
  return out
}

/** 只改内存：删除记录并留下墓碑，最终一次性落盘。 */
function dropLocal(local, deleted, day, stamp) {
  delete local[day]
  deleted[day] = Math.max(Number(deleted[day]) || 0, Number(stamp) || 0)
}

/**
 * 把云端记录回填到本地（换机 / 清缓存恢复）。
 * 服务端下发的单日墓碑和全量清除水位优先于旧记录，避免删除被复活。
 *
 * 注意：这是同步合并的热路径，不能逐条调用 storage.saveRecord/removeRecord；
 * 那样每条记录都会“全表读 + 全表写”，400 条回填会产生近千次同步 Storage IO。
 * 这里统一在内存里合并，最后各写一次 records/deleted。
 */
function mergeServerRecords(serverRecords, options) {
  const opts = options || {}
  const local = storage.getRecords()
  const deleted = storage.getDeleted()
  const erasedAt = Number(opts.erasedAt) || 0
  let changed = 0
  let dirty = false

  if (erasedAt) {
    Object.keys(local).forEach((day) => {
      const stamp = local[day].updatedAt || 0
      if (stamp <= erasedAt) {
        dropLocal(local, deleted, day, erasedAt)
        changed += 1
        dirty = true
      }
    })
  }

  ;(opts.deletedDays || []).forEach((item) => {
    if (!item || !item.day || typeof item.deletedAt !== 'number') return
    if (!isValidDay(item.day)) return
    const current = local[item.day]
    if (!current || (current.updatedAt || 0) <= item.deletedAt) {
      dropLocal(local, deleted, item.day, item.deletedAt)
      if (current) changed += 1
      // 即使本机没有这条记录，也要把墓碑落盘，否则换机后旧数据会被云端回填。
      dirty = true
    }
  })

  const records = Array.isArray(serverRecords) ? serverRecords : []
  records.forEach((item) => {
    if (!item || !item.day) return
    if (!isValidDay(item.day)) return
    if (typeof item.bedAt !== 'number' || typeof item.wakeAt !== 'number') return
    if (item.wakeAt <= item.bedAt || item.wakeAt - item.bedAt > MAX_SLEEP_MS) return

    const stamp = item.updatedAt || item.wakeAt
    if (deleted[item.day] && deleted[item.day] >= stamp) return

    // 设备时区与服务端固定 +8 不一致时，服务端 day 为准：
    // 删除本地按设备时区算出的另一个 key，避免同一夜出现两条记录。
    const localDay = T.sleepDayOf(item.bedAt)
    if (localDay && localDay !== item.day && local[localDay]) {
      dropLocal(local, deleted, localDay, stamp)
      changed += 1
      dirty = true
    }

    const current = local[item.day]
    if (current && (current.updatedAt || 0) >= stamp) return

    local[item.day] = {
      day: item.day,
      bedAt: item.bedAt,
      wakeAt: item.wakeAt,
      durationMin: item.durationMin || Math.round((item.wakeAt - item.bedAt) / 60000),
      updatedAt: stamp
    }
    // 与 storage.saveRecord 的语义保持一致：新记录会清掉同一天的旧墓碑。
    delete deleted[item.day]
    changed += 1
    dirty = true
  })

  if (dirty) {
    storage.replaceRecords(local)
    storage.replaceDeleted(deleted)
  }

  return changed
}

/**
 * 静默云备份：上传本地记录与删除墓碑，并接收云端回填。
 * 失败不抛给调用方，也不影响打卡。
 */
function doSync(force) {
  const meta = storage.getMeta()
  if (meta.cloudPendingErase) {
    return Promise.resolve({ skipped: 'cloud_pending' })
  }
  if (!force && meta.lastSyncAt && Date.now() - meta.lastSyncAt < THROTTLE_MS) {
    return Promise.resolve({ skipped: 'throttled' })
  }

  const records = collect(Date.now(), SPAN_DAYS)
  const deletedDays = storage.getDeletedList()
  const epoch = meta.syncEpoch || 0
  const batches = chunk(records, CHUNK_SIZE)
  // 本地为空也要请求一次，否则换机后拿不到云端记录 / 删除水位
  if (!batches.length) batches.push([])

  const run = async () => {
    let synced = 0
    let dropped = 0
    let restored = 0

    for (let i = 0; i < batches.length; i += 1) {
      // 每个请求都使用一次新的 wx.login code；不能复用同一个 code 调多次接口。
      const res = await withLogin((code) =>
        api.syncRecords(code, batches[i], i === 0 ? deletedDays : [])
      )
      if ((storage.getMeta().syncEpoch || 0) !== epoch) {
        return { skipped: 'stale' }
      }
      const body = res || {}
      restored += mergeServerRecords(body.records, {
        deletedDays: body.deletedDays,
        erasedAt: body.erasedAt
      })
      synced += body.synced || 0
      dropped += body.dropped || 0
    }

    storage.patchMeta({ lastSyncAt: Date.now() })
    return { synced, dropped, restored, chunks: batches.length }
  }

  return run().catch((error) => {
    if (error && error.code === 'FEATURE_OFF') {
      return { skipped: 'feature_off' }
    }
    throw error
  })
}

function syncNow(force) {
  // 数据默认只存本机；用户未在统计页显式开启云备份时，一次请求都不发
  if (!storage.getSyncEnabled()) {
    return Promise.resolve({ skipped: 'sync_off' })
  }

  const config = getConfig()
  if (!config.features || !config.features.sync) {
    return Promise.resolve({ skipped: 'feature_off' })
  }

  if (inflight) return inflight
  inflight = doSync(force).finally(() => {
    inflight = null
  })
  return inflight
}

/** 等待在途同步结束（删除云端副本/清除数据前使用） */
function whenIdle() {
  if (!inflight) return Promise.resolve()
  return inflight.then(
    () => undefined,
    () => undefined
  )
}

module.exports = { syncNow, whenIdle, collect, chunk, mergeServerRecords }
