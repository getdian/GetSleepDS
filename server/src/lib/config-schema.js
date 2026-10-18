const { invalidBody } = require('./errors')

const ICONS = ['rain', 'wave', 'fire', 'noise', 'night']
const MAX_AUDIO = 10
const DEFAULT_FEATURES = { summary: true, sync: true, timer: true, preload: true }
const DEFAULT_CACHE = { maxMB: 80, ttlDays: 7 }

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readText(value, label, max, required) {
  if (value === undefined || value === null) {
    if (required) throw invalidBody(label + '不能为空')
    return ''
  }
  if (typeof value !== 'string') throw invalidBody(label + '必须是文本')
  const text = value.trim()
  if (required && !text) throw invalidBody(label + '不能为空')
  if (text.length > max) throw invalidBody(label + '不能超过 ' + max + ' 个字')
  return text
}

/** 文件配置 / 数据库配置的宽松合并，缺失字段用兜底补齐 */
function normalizeConfig(input, base) {
  const source = isObject(input) ? input : {}
  const fallback = base || {}
  const rawAudio =
    Array.isArray(source.audio) && source.audio.length ? source.audio : fallback.audio || []

  // 旧版本配置没有 category，这里逐条补齐，避免升级后分类筛选直接空掉
  const audio = rawAudio.map((item) => {
    const value = isObject(item) ? item : {}
    return {
      id: typeof value.id === 'string' ? value.id : '',
      title: value.title || '未命名环境音',
      subtitle: value.subtitle || '循环播放 · 支持锁屏',
      category: value.category || '环境音',
      url: value.url || '',
      icon: ICONS.indexOf(value.icon) >= 0 ? value.icon : 'noise'
    }
  })

  return {
    version: Number(source.version) || Number(fallback.version) || 1,
    audio,
    unlock: Object.assign({}, fallback.unlock || {}, isObject(source.unlock) ? source.unlock : {}),
    features: Object.assign({}, DEFAULT_FEATURES, fallback.features || {}, isObject(source.features) ? source.features : {}),
    cache: Object.assign({}, DEFAULT_CACHE, fallback.cache || {}, isObject(source.cache) ? source.cache : {}),
    copy: Object.assign({}, fallback.copy || {}, isObject(source.copy) ? source.copy : {})
  }
}

/** 后台保存时的严格校验，返回可直接下发的配置（不含 version） */
function validateConfig(input) {
  if (!isObject(input)) throw invalidBody('配置格式错误')

  if (!Array.isArray(input.audio) || !input.audio.length) {
    throw invalidBody('至少保留 1 条环境音')
  }
  if (input.audio.length > MAX_AUDIO) {
    throw invalidBody('最多 ' + MAX_AUDIO + ' 条环境音')
  }

  const seen = {}
  const audio = input.audio.map((item, index) => {
    const label = '第 ' + (index + 1) + ' 条环境音'
    if (!isObject(item)) throw invalidBody(label + '格式错误')

    const title = readText(item.title, label + '名称', 30, true)
    const url = readText(item.url, label + '地址', 500, true)
    if (!/^https:\/\/[^\s]+$/i.test(url)) {
      throw invalidBody(label + '地址必须以 https:// 开头')
    }

    const subtitle = readText(item.subtitle, label + '副标题', 40, false)
    const category = readText(item.category, label + '分类', 12, false) || '环境音'
    const icon = ICONS.indexOf(item.icon) >= 0 ? item.icon : 'noise'

    let id = readText(item.id, label + ' ID', 32, false)
    if (!id) id = 'track-' + Date.now().toString(36) + '-' + (index + 1)
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw invalidBody(label + ' ID 只能包含字母、数字、下划线和短横线')
    }
    if (seen[id]) throw invalidBody('环境音 ID 重复：' + id)
    seen[id] = true

    return {
      id,
      title,
      subtitle: subtitle || '循环播放 · 支持锁屏',
      category,
      url,
      icon
    }
  })

  const unlockInput = isObject(input.unlock) ? input.unlock : {}

  let mode = 'rewarded'
  if (unlockInput.mode !== undefined) {
    if (['rewarded', 'free'].indexOf(unlockInput.mode) < 0) {
      throw invalidBody('解锁方式只能是 rewarded 或 free')
    }
    mode = unlockInput.mode
  }

  let ttlHours = 24
  if (unlockInput.ttlHours !== undefined) {
    const ttl = Number(unlockInput.ttlHours)
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > 168) {
      throw invalidBody('解锁有效期需为 1–168 小时的整数')
    }
    ttlHours = ttl
  }

  let onAdError = 'grant'
  if (unlockInput.onAdError !== undefined) {
    if (['grant', 'deny'].indexOf(unlockInput.onAdError) < 0) {
      throw invalidBody('广告失败策略只能是 grant 或 deny')
    }
    onAdError = unlockInput.onAdError
  }

  const featuresInput = isObject(input.features) ? input.features : {}
  const features = {
    summary: featuresInput.summary !== false,
    sync: featuresInput.sync !== false,
    timer: featuresInput.timer !== false,
    preload: featuresInput.preload !== false
  }

  const cacheInput = isObject(input.cache) ? input.cache : {}

  let maxMB = 80
  if (cacheInput.maxMB !== undefined) {
    const value = Number(cacheInput.maxMB)
    if (!Number.isInteger(value) || value < 20 || value > 200) {
      throw invalidBody('本地缓存上限需为 20–200MB 的整数')
    }
    maxMB = value
  }

  let ttlDays = 7
  if (cacheInput.ttlDays !== undefined) {
    const value = Number(cacheInput.ttlDays)
    if (!Number.isInteger(value) || value < 1 || value > 30) {
      throw invalidBody('缓存有效期需为 1–30 天')
    }
    ttlDays = value
  }

  const copyInput = isObject(input.copy) ? input.copy : {}
  const copy = {
    unlockTitle: readText(copyInput.unlockTitle, '解锁标题', 20, false) || '解锁环境音',
    unlockDesc:
      readText(copyInput.unlockDesc, '解锁说明', 60, false) ||
      '观看视频，解锁今晚的环境声音（24小时内有效）',
    unlockConfirm: readText(copyInput.unlockConfirm, '确认按钮', 10, false) || '观看视频',
    unlockCancel: readText(copyInput.unlockCancel, '取消按钮', 10, false) || '先不用'
  }

  return {
    audio,
    unlock: {
      mode,
      adUnitId: readText(unlockInput.adUnitId, '广告位 ID', 64, false),
      ttlHours,
      onAdError
    },
    features,
    cache: { maxMB, ttlDays },
    copy
  }
}

module.exports = {
  ICONS,
  MAX_AUDIO,
  normalizeConfig,
  validateConfig
}
