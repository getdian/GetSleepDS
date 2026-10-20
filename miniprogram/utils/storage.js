/**
 * 本地存储封装。所有 key 集中在这里，避免散落在页面里。
 * 任何存储异常都不应该让页面白屏。
 */

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

function saveRecord(record) {
  const all = getRecords()
  all[record.day] = record
  const ok = safeSet(KEYS.records, all)
  if (ok) clearDeleted(record.day)
  return ok
}

/** 开发工具用：整体替换记录表（调用方负责墓碑等一致性） */
function replaceRecords(map) {
  return safeSet(KEYS.records, map && typeof map === 'object' ? map : {})
}

function removeRecord(day, deletedAt) {
  const all = getRecords()
  delete all[day]
  const saved = safeSet(KEYS.records, all)
  // 墓碑：阻止云端旧记录在下次同步时被回填；写入失败必须让调用方知道。
  // 同步合并时使用服务端墓碑时间，避免把“现在”写成更新的墓碑而挡住清除后新记录。
  const tomb = saved ? markDeleted(day, deletedAt) : false
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

function setPending(bedAt) {
  return safeSet(KEYS.pending, { bedAt })
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
  saveRecord,
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
