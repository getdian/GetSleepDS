const api = require('./api')
const storage = require('./storage')
const T = require('./time')
const X = require('./sessions')
const { getConfig } = require('./config')
const { withLogin } = require('./login')

const THROTTLE_MS = 60 * 60 * 1000
// 云备份要能覆盖热力图的完整历史；服务端单次最多 62 条，客户端按 60 条分片。
const SPAN_DAYS = 400
const CHUNK_SIZE = 60
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_SLEEP_MS = 24 * 60 * 60 * 1000
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

let inflight = null
// 未来墓碑只可能是设备时钟错误；同一会话只提示一次，避免每次同步都弹
let warnedFutureTombstone = false

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

/**
 * 墓碑只可能指向过去/今天。设备时钟错乱会造出未来日期，
 * 服务端会拒绝（+1 天时区容差），这里先过滤并明确告知，避免"删了但云端没删"的错觉。
 */
function validTombstones(list, now) {
  const maxDay = T.dateKey(T.addDays(now, 1))
  const kept = []
  let skipped = 0
  ;(list || []).forEach(function (item) {
    if (!item || !isValidDay(item.day)) return
    if (item.day > maxDay) {
      skipped += 1
      return
    }
    kept.push(item)
  })
  if (skipped && !warnedFutureTombstone) {
    warnedFutureTombstone = true
    if (typeof wx !== 'undefined' && wx.showToast) {
      wx.showToast({ title: '删除日期异常（请检查手机时间），已跳过', icon: 'none' })
    }
  }
  return kept
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
    // 与服务端 validate.inWindow(bedAt) 同边界：只看 wakeAt 会把“wakeAt 在窗口内、
    // bedAt 已越界”的记录反复上传并被服务端丢弃，形成永久 dropped。
    if (current - r.bedAt > span) return
    list.push({
      day: r.day,
      dayRule: r.dayRule || 'bed-v1',
      schemaVersion: r.schemaVersion || 1,
      bedAt: r.bedAt,
      wakeAt: r.wakeAt,
      durationMin: r.durationMin,
      nightDurationMin: r.nightDurationMin || r.durationMin,
      totalDurationMin: r.totalDurationMin || r.durationMin,
      // 旧记录也合成一段，服务端可统一按 v2 存储；dayRule 仍标记旧口径
      sessions: X.sessionsOf(r),
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

// 服务端 body 上限 256KB，但反向代理/网关常按更小值截断；客户端自留 40KB 预算。
// 墓碑只随首片发送（最多 400 条，约 24KB），首片必须先把这部分从预算里扣掉，
// 否则“60 条 + 多段 + 400 墓碑”会稳定超过 64KB 并永久 413。
const CHUNK_BYTES = 40 * 1024

function recordBytes(record) {
  try {
    return JSON.stringify(record).length + 1
  } catch (e) {
    return 1024
  }
}

/**
 * 按「条数 + 序列化字节」双重上限分片。
 * 单条记录最多 8 段，长度可控；逐条累加比整批 JSON.stringify 一次更省内存。
 */
function chunkRecords(list, deletedDays) {
  const source = Array.isArray(list) ? list : []
  const tombstones = Array.isArray(deletedDays) ? deletedDays : []
  let deletedBytes = 0
  try {
    deletedBytes = JSON.stringify(tombstones).length
  } catch (e) {
    deletedBytes = 16 * 1024
  }
  let budget = Math.max(8 * 1024, CHUNK_BYTES - deletedBytes)
  const out = []
  let current = []
  let bytes = 0
  source.forEach((record) => {
    const size = recordBytes(record)
    if (current.length && (current.length >= CHUNK_SIZE || bytes + size > budget)) {
      out.push(current)
      current = []
      bytes = 0
      budget = CHUNK_BYTES
    }
    current.push(record)
    bytes += size
  })
  if (current.length) out.push(current)
  // 本地为空也要发一次：换机后要靠它拿云端记录/删除水位。
  if (!out.length) out.push([])
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
  // 用原始表做合并：getRecords() 会过滤掉缺 day 的旧条目，直接用它整体回写会静默丢历史
  const local = storage.getRawRecords()
  const deleted = storage.getDeleted()
  const erasedAt = Number(opts.erasedAt) || 0
  let changed = 0
  let dirty = false

  if (erasedAt) {
    Object.keys(local).forEach((day) => {
      const item = local[day]
      // 原始表可能混入 null/字符串（历史脏数据、外部工具写入）：
      // 直接取 .updatedAt 会抛 TypeError，让整次同步永久失败。
      const stamp = (item && typeof item === 'object' && Number(item.updatedAt)) || 0
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
    // 删除本地按旧口径算出的另一个 key，避免同一夜出现两条记录。
    const isWakeRule = item.dayRule === 'wake-v1'
    // 与服务端同口径（固定 +8）：本地 dateKey 会随设备时区分叉，导致误判“同一天两条”
    const localDay = isWakeRule ? T.calendarDayKey(item.wakeAt) : T.sleepDayOf(item.bedAt)
    if (localDay && localDay !== item.day && local[localDay]) {
      dropLocal(local, deleted, localDay, stamp)
      changed += 1
      dirty = true
    }

    const current = local[item.day]
    if (current && (current.updatedAt || 0) >= stamp) return

    const sessions = X.sessionsOf(item)
    local[item.day] = {
      day: item.day,
      dayRule: item.dayRule || 'bed-v1',
      schemaVersion: item.schemaVersion || 1,
      bedAt: item.bedAt,
      wakeAt: item.wakeAt,
      durationMin: item.durationMin || Math.round((item.wakeAt - item.bedAt) / 60000),
      nightDurationMin:
        item.nightDurationMin || item.durationMin || Math.round((item.wakeAt - item.bedAt) / 60000),
      totalDurationMin:
        item.totalDurationMin ||
        item.durationMin ||
        Math.round((item.wakeAt - item.bedAt) / 60000),
      sessions,
      updatedAt: stamp
    }
    // 与 storage.saveRecord 的语义保持一致：新记录会清掉同一天的旧墓碑。
    delete deleted[item.day]
    changed += 1
    dirty = true
  })

  if (dirty) {
    // 先落墓碑再落记录：中途失败时墓碑优先，下一轮同步能挡住云端回填。
    const deletedOk = storage.replaceDeleted(deleted)
    const recordsOk = storage.replaceRecords(local)
    if (!deletedOk || !recordsOk) opts.failed = true
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

  const now = Date.now()
  const records = collect(now, SPAN_DAYS)
  const deletedDays = validTombstones(storage.getDeletedList(), now)
  const epoch = meta.syncEpoch || 0
  const batches = chunkRecords(records, deletedDays)
  // 本地为空也要请求一次，否则换机后拿不到云端记录 / 删除水位
  if (!batches.length) batches.push([])

  const run = async () => {
    let synced = 0
    let dropped = 0
    let restored = 0
    let writeFailed = false

    for (let i = 0; i < batches.length; i += 1) {
      // 用户在同步途中关掉云备份：立刻停止后续分片，不再继续上传本机记录/回填云端
      if (!storage.getSyncEnabled()) return { skipped: 'sync_off' }
      // 每个请求都使用一次新的 wx.login code；不能复用同一个 code 调多次接口。
      // 只有首片需要云端全量回填，后续分片让服务端省略 records，避免 N 倍全量下载。
      const res = await withLogin((code) =>
        api.syncRecords(code, batches[i], i === 0 ? deletedDays : [], i === 0)
      )
      if ((storage.getMeta().syncEpoch || 0) !== epoch) {
        return { skipped: 'stale' }
      }
      const body = res || {}
      const mergeOptions = {
        deletedDays: body.deletedDays,
        erasedAt: body.erasedAt
      }
      try {
        restored += mergeServerRecords(body.records, mergeOptions)
      } catch (e) {
        // 单条脏数据不能把整次同步打成永久失败：标记 partial，下一轮还会重试
        mergeOptions.failed = true
      }
      if (mergeOptions.failed) writeFailed = true
      synced += body.synced || 0
      dropped += body.dropped || 0
    }

    storage.patchMeta({
      lastSyncAt: Date.now(),
      // 有记录被服务端丢弃，或本机合并结果没写进去：都不能算“完整同步”
      lastSyncPartial: dropped > 0 || writeFailed,
      lastSyncDropped: dropped,
      lastSyncWriteFailed: writeFailed
    })
    return { synced, dropped, restored, chunks: batches.length, writeFailed }
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

module.exports = {
  syncNow,
  whenIdle,
  collect,
  chunk,
  chunkRecords,
  mergeServerRecords,
  SPAN_DAYS
}
