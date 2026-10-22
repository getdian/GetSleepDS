/**
 * 本地存储封装。所有 key 集中在这里，避免散落在页面里。
 * 任何存储异常都不应该让页面白屏。
 */

const X = require('./sessions')

const KEYS = {
  records: 'sleep:records:v1',
  pending: 'sleep:pending:v1',
  config: 'sleep:config:v1',
  meta: 'sleep:meta:v1',
  unlock: 'audio_unlock_expire',
  deleted: 'sleep:deleted:v1',
  events: 'sleep:events:v1',
  background: 'sleep:background:v1',
  backgroundCache: 'sleep:background-cache:v1'
}

function safeGet(key, fallback) {
  try {
    const value = wx.getStorageSync(key)
    if (value === '' || value === null || value === undefined) return fallback
    return value
  } catch (e) {
    return fallback
  }
}

function safeSet(key, value) {
  try {
    wx.setStorageSync(key, value)
    return true
  } catch (e) {
    // 存储满或系统限制时由调用方决定是否提示；关键写入不能再假装成功
    return false
  }
}

function safeRemove(key) {
  try {
    wx.removeStorageSync(key)
    return true
  } catch (e) {
    return false
  }
}

function isRecord(value) {
  return !!value && typeof value.bedAt === 'number' && typeof value.wakeAt === 'number'
}

function getRecords() {
  const raw = safeGet(KEYS.records, {})
  if (!raw || typeof raw !== 'object') return {}
  const out = {}
  Object.keys(raw).forEach((key) => {
    const item = raw[key]
    if (isRecord(item) && item.day) out[item.day] = item
  })
  return out
}

/**
 * 原始记录表：保留未识别 / 旧结构的条目。
 * 写回时必须基于它做浅合并，否则「读过滤后子集 → 整体覆盖写」会把
 * 缺 day 字段的旧记录、被其他端写坏的条目一次性删掉，且没有任何提示。
 */
function getRawRecords() {
  const raw = safeGet(KEYS.records, {})
  return raw && typeof raw === 'object' ? raw : {}
}

function saveRecord(record) {
  const all = getRawRecords()
  all[record.day] = record
  const ok = safeSet(KEYS.records, all)
  if (!ok) return false
  // 清墓碑失败会让“记录的 updatedAt < 旧墓碑时间”，服务端将永久拒收这一天。
  // 返回失败让调用方提示重试（同一天重写是幂等的）。
  return clearDeleted(record.day)
}

/**
 * v1 记录按“入睡日”存放；若它被放在 day 但实际醒来日不是 day，
 * 直接把它并进 day 会得到“一条记录跨两个醒来日”，服务端 validateRecords
 * 会整条丢弃（云备份静默丢这一天）。
 * 返回需要迁移到真实醒来日的记录信息；不是错位 v1 时返回 null。
 */
function misplacedV1Of(all, day) {
  const record = all[day]
  if (!record || record.dayRule === 'wake-v1') return null
  const sessions = X.sessionsOf(record)
  if (!sessions.length) return null
  const wakeDay = X.sessionDay(sessions[sessions.length - 1])
  if (!wakeDay || wakeDay === day) return null
  return { sessions, wakeDay }
}

/**
 * 追加/更新一段睡眠，按醒来日归档。
 * 同一天已有的旧 v1 记录会先合成一段，再与新段一起聚合。
 */
function saveSession(session) {
  const normalized = X.normalizeSession(session)
  if (!normalized) return false
  const day = X.sessionDay(normalized)
  if (!day) return false
  const all = getRawRecords()
  // 先按时间区间查全表：只看目标日会漏掉“前一天已有一段”的跨天重叠。
  // 同 id 的旧副本会被 upsert 替换，不算冲突。
  if (X.findOverlap(all, normalized.startAt, normalized.endAt, { id: normalized.id })) return false
  // 目标日若挂着一条“实际属于次日”的 v1 夜间记录，先把它迁到真实醒来日，
  // 再拼当天记录；否则会产出跨两个醒来日的记录（服务端会拒收）。
  const misplaced = misplacedV1Of(all, day)
  let baseSessions = []
  if (misplaced) {
    let movedList = X.sessionsOf(all[misplaced.wakeDay])
    misplaced.sessions.forEach((item) => {
      movedList = X.upsert({ sessions: movedList }, item)
    })
    if (!movedList || movedList.length > 8 || X.hasOverlap(movedList)) return false
    if (X.totalDurationOf(movedList) > 24 * 60) return false
    const movedRecord = X.aggregate(misplaced.wakeDay, movedList, Date.now())
    if (!movedRecord) return false
    all[misplaced.wakeDay] = movedRecord
    // 旧 day 即将被新记录覆盖，不写墓碑；云端旧行由新 day 的 updatedAt 覆盖。
    delete all[day]
  } else {
    baseSessions = X.sessionsOf(all[day])
  }
  // 旧 v1 记录按入睡日存放；当它的醒来日正好是本次归档日时，顺带并到新记录，
  // 避免“昨晚记录挂在昨天、今天午休另起一条”的过渡期割裂。
  const legacyKeys = []
  Object.keys(all).forEach((key) => {
    if (key === day || !all[key] || all[key].dayRule === 'wake-v1') return
    const sessions = X.sessionsOf(all[key])
    const last = sessions[sessions.length - 1]
    if (!last || X.sessionDay(last) !== day) return
    legacyKeys.push(key)
    baseSessions = baseSessions.concat(sessions)
  })
  const list = X.upsert({ sessions: baseSessions }, normalized)
  if (!list || list.length > 8 || X.hasOverlap(list)) return false
  if (X.totalDurationOf(list) > 24 * 60) return false
  const record = X.aggregate(day, list, Date.now())
  if (!record) return false
  all[day] = record
  // 被合并的 v1 记录也要写墓碑；时间必须晚于它自己的 updatedAt，
  // 否则云端“updated_at <= deleted_at”条件不成立，旧记录会被回填。
  const legacyTimes = {}
  legacyKeys.forEach((key) => {
    legacyTimes[key] = tombstoneTime(all[key], Date.now())
    delete all[key]
  })
  if (!safeSet(KEYS.records, all)) return false
  legacyKeys.forEach((key) => markDeleted(key, legacyTimes[key]))
  return clearDeleted(day) ? record : false
}

/** 编辑同一天的某一段；不允许通过编辑把记录移到另一天（避免墓碑拆天） */
function updateSession(day, sessionId, startAt, endAt) {
  const all = getRawRecords()
  const record = all[day]
  if (!record) return false
  const source = X.sessionsOf(record)
  if (!source.some((item) => item.id === sessionId)) return false
  const list = source
    .map((item) =>
      item.id === sessionId
        ? X.normalizeSession(Object.assign({}, item, { startAt, endAt, editedAt: Date.now() }))
        : item
    )
    .filter(Boolean)
  const target = list.filter((item) => item.id === sessionId)[0]
  if (!target || X.hasOverlap(list)) return false
  if (X.totalDurationOf(list) > 24 * 60) return false
  const nextDay = X.sessionDay(target)
  if (!nextDay) return false
  // 跨天查重（排除被编辑的这一段本身）
  if (X.findOverlap(all, target.startAt, target.endAt, { id: sessionId })) return false
  // 旧 v1 记录按入睡日归档；首次编辑时迁到醒来日（仅单段可迁，避免拆天）
  if (nextDay !== day) {
    if (source.length > 1) return false
    // 目标日可能已有新记录：合并而不是整体覆盖，否则那天的段会凭空消失
    const merged = X.upsert({ sessions: X.sessionsOf(all[nextDay]) }, target)
    if (!merged || merged.length > 8 || X.hasOverlap(merged)) return false
    if (X.totalDurationOf(merged) > 24 * 60) return false
    const next = X.aggregate(nextDay, merged, Date.now())
    if (!next) return false
    // 迁移后旧 day 的墓碑必须晚于原记录，否则云端旧行删不掉、下次同步又迁回来
    const tombAt = tombstoneTime(record, Date.now())
    all[nextDay] = next
    delete all[day]
    if (!safeSet(KEYS.records, all)) return false
    markDeleted(day, tombAt)
    return clearDeleted(nextDay) ? next : false
  }
  const next = X.aggregate(day, list, Date.now())
  if (!next) return false
  all[day] = next
  if (!safeSet(KEYS.records, all)) return false
  return clearDeleted(day) ? next : false
}

/**
 * 删除某一天的某一段睡眠。
 * 删到当天无剩余段时整条移除（写墓碑，防云端旧记录回填）；
 * 仍有剩余段时重算聚合（总时长/主睡眠随之变化），当天记录保留。
 */
function removeSession(day, sessionId) {
  const all = getRawRecords()
  const record = all[day]
  if (!record) return false
  const source = X.sessionsOf(record)
  if (!source.some((item) => item.id === sessionId)) return false
  const list = source.filter((item) => item.id !== sessionId)
  if (!list.length) return removeRecord(day, Date.now())
  const next = X.aggregate(day, list, Date.now())
  if (!next) return false
  all[day] = next
  if (!safeSet(KEYS.records, all)) return false
  return clearDeleted(day) ? next : false
}

/** 开发工具用：整体替换记录表（调用方负责墓碑等一致性） */
function replaceRecords(map) {
  return safeSet(KEYS.records, map && typeof map === 'object' ? map : {})
}

/**
 * 墓碑时间：必须晚于被删记录自身的 updatedAt。
 * 云端删除条件是 `updated_at <= deleted_at`，跨设备删除或设备时钟偏慢时
 * 直接用本机 Date.now() 可能删不掉，下次同步会把“已删除”的记录回填。
 */
function tombstoneTime(record, nowTs) {
  const updatedAt = Number(record && record.updatedAt) || 0
  return Math.max(Number(nowTs) || Date.now(), Date.now(), updatedAt + 1)
}

function removeRecord(day, deletedAt) {
  const all = getRawRecords()
  const current = all[day]
  const tombAt = tombstoneTime(current, deletedAt)
  delete all[day]
  const saved = safeSet(KEYS.records, all)
  // 墓碑：阻止云端旧记录在下次同步时被回填；写入失败必须让调用方知道。
  // 同步合并时使用服务端墓碑时间，避免把“现在”写成更新的墓碑而挡住清除后新记录。
  // 墓碑写失败时立即重试一次：记录已经从本机删掉，漏墓碑会让云端旧记录在下次同步复活。
  let tomb = saved ? markDeleted(day, tombAt) : false
  if (saved && !tomb) tomb = markDeleted(day, tombAt)
  return saved && tomb
}

/** 已删除的睡眠日 -> 删除时间，用于同步时挡住旧数据 */
function getDeleted() {
  const raw = safeGet(KEYS.deleted, {})
  return raw && typeof raw === 'object' ? raw : {}
}

function markDeleted(day, timestamp) {
  if (!day) return false
  const all = getDeleted()
  const next = Math.max(Number(all[day]) || 0, Number(timestamp) || Date.now())
  all[day] = next
  return safeSet(KEYS.deleted, all)
}

/** 批量合并用：整体替换墓碑表（调用方负责墓碑优先规则） */
function replaceDeleted(map) {
  return safeSet(KEYS.deleted, map && typeof map === 'object' ? map : {})
}

function clearDeleted(day) {
  const all = getDeleted()
  if (!all[day]) return true
  delete all[day]
  return safeSet(KEYS.deleted, all)
}

function getDeletedList() {
  const all = getDeleted()
  return Object.keys(all)
    .map((day) => ({ day, deletedAt: all[day] }))
    .filter((item) => item.day && typeof item.deletedAt === 'number')
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
    .slice(-400)
}

function getPending() {
  const raw = safeGet(KEYS.pending, null)
  if (!raw || typeof raw.bedAt !== 'number') return null
  return raw
}

function setPending(value) {
  const data = typeof value === 'number' ? { bedAt: value } : value
  if (!data || !Number.isFinite(Number(data.bedAt))) return false
  return safeSet(KEYS.pending, {
    bedAt: Number(data.bedAt),
    expectedWakeAt: Number(data.expectedWakeAt) || 0,
    reminderOptIn: data.reminderOptIn === true,
    id: data.id ? String(data.id) : ''
  })
}

function clearPending() {
  return safeRemove(KEYS.pending)
}

function getUnlockExpire() {
  const value = safeGet(KEYS.unlock, 0)
  return typeof value === 'number' ? value : 0
}

function setUnlockExpire(timestamp) {
  return safeSet(KEYS.unlock, timestamp)
}

/** 首页背景图解锁：{ id, expireAt }；到期自动回退默认图 */
function getBackgroundUnlock() {
  const value = safeGet(KEYS.background, null)
  if (!value || typeof value !== 'object') return null
  if (!value.id || typeof value.expireAt !== 'number') return null
  return value
}

function setBackgroundUnlock(value) {
  return safeSet(KEYS.background, value)
}

function clearBackgroundCache() {
  return safeRemove(KEYS.backgroundCache)
}

/** 背景图本地缓存索引：{ [url]: { path, savedAt } }，最多保留 6 张 */
function getBackgroundCache() {
  const value = safeGet(KEYS.backgroundCache, {})
  return value && typeof value === 'object' ? value : {}
}

function setBackgroundCache(url, path) {
  if (!url || !path) return false
  const cache = getBackgroundCache()
  cache[url] = { path, savedAt: Date.now() }
  const keys = Object.keys(cache).sort((a, b) => {
    return (cache[b].savedAt || 0) - (cache[a].savedAt || 0)
  })
  keys.slice(6).forEach((key) => {
    const entry = cache[key]
    if (entry && entry.path) {
      try {
        wx.getFileSystemManager().unlinkSync(entry.path)
      } catch (e) {}
    }
    delete cache[key]
  })
  return safeSet(KEYS.backgroundCache, cache)
}

function getMeta() {
  const raw = safeGet(KEYS.meta, {})
  return raw && typeof raw === 'object' ? raw : {}
}

function patchMeta(patch) {
  const next = Object.assign({}, getMeta(), patch)
  const saved = safeSet(KEYS.meta, next)
  return saved ? next : false
}

/** 云备份默认关闭：数据本地化是产品默认状态，用户显式开启后才会上传 */
function getSyncEnabled() {
  return getMeta().syncEnabled === true
}

function setSyncEnabled(enabled) {
  return !!patchMeta({ syncEnabled: enabled === true })
}

function getConfigCache() {
  const raw = safeGet(KEYS.config, null)
  if (!raw || !raw.data || !raw.fetchedAt) return null
  return raw
}

function setConfigCache(data) {
  return safeSet(KEYS.config, { fetchedAt: Date.now(), data })
}

function getPrefs() {
  const meta = getMeta()
  return meta.prefs && typeof meta.prefs === 'object' ? meta.prefs : {}
}

function setPrefs(patch) {
  return patchMeta({ prefs: Object.assign({}, getPrefs(), patch) })
}

/** 环境音收藏（本地）：只存音频 id，不进云同步 */
function getFavorites() {
  const meta = getMeta()
  return Array.isArray(meta.favoriteAudioIds) ? meta.favoriteAudioIds : []
}

function toggleFavorite(id) {
  if (!id) return getFavorites()
  const current = getFavorites()
  const index = current.indexOf(id)
  if (index >= 0) current.splice(index, 1)
  else current.push(id)
  patchMeta({ favoriteAudioIds: current })
  return current
}

/** 清除全部个人数据（保留远程配置缓存，避免下次冷启动无配置） */
function clearAll() {
  let ok = true
  ;[KEYS.records, KEYS.pending, KEYS.deleted, KEYS.unlock, KEYS.events, KEYS.background, KEYS.backgroundCache].forEach(
    (key) => {
      if (!safeRemove(key)) ok = false
    }
  )
  // 保留一个单调递增的代际号，让清除前发出的 sync 响应在回来时被识别为过期
  if (!safeSet(KEYS.meta, { syncEpoch: Date.now() })) ok = false
  return ok
}

module.exports = {
  KEYS,
  getRecords,
  getRawRecords,
  saveRecord,
  saveSession,
  updateSession,
  removeSession,
  replaceRecords,
  removeRecord,
  getDeleted,
  getDeletedList,
  replaceDeleted,
  markDeleted,
  clearDeleted,
  getPending,
  setPending,
  clearPending,
  getUnlockExpire,
  setUnlockExpire,
  getBackgroundUnlock,
  setBackgroundUnlock,
  getBackgroundCache,
  setBackgroundCache,
  clearBackgroundCache,
  getMeta,
  patchMeta,
  getSyncEnabled,
  setSyncEnabled,
  getConfigCache,
  setConfigCache,
  getPrefs,
  setPrefs,
  getFavorites,
  toggleFavorite,
  clearAll
}
