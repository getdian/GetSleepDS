const { invalidBody } = require('./errors')

const ICONS = ['rain', 'wave', 'fire', 'noise', 'night']
const MAX_AUDIO = 10
const DEFAULT_FEATURES = { summary: true, sync: true, timer: true, preload: true, events: true }
const DEFAULT_CACHE = { maxMB: 80, ttlDays: 7 }
// 页面展示位：默认全部关闭，运营在后台按需开启并填广告位 ID
const AD_SLOTS = ['home', 'sleep', 'stats', 'statsFooter']
const AD_TYPES = ['template', 'banner']
// 首页背景图：默认免费；用户主动更换需看广告解锁
const MAX_BACKGROUNDS = 20
const DEFAULT_BACKGROUND_UNLOCK_HOURS = 24

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeBackgrounds(input, fallback) {
  const source = Array.isArray(input) ? input : Array.isArray(fallback) ? fallback : []
  return source.map((item, index) => {
    const value = isObject(item) ? item : {}
    return {
      id: typeof value.id === 'string' ? value.id : '',
      title: value.title || '未命名背景',
      category: value.category || '夜色',
      url: value.url || '',
      sort: Number.isInteger(value.sort) ? value.sort : index,
      enabled: value.enabled !== false
    }
  })
}

function normalizeAdSlot(raw, fallback) {
  const source = isObject(raw) ? raw : {}
  const base = isObject(fallback) ? fallback : {}
  return {
    enabled: source.enabled === undefined ? base.enabled === true : source.enabled === true,
    unitId:
      typeof source.unitId === 'string'
        ? source.unitId
        : typeof base.unitId === 'string'
          ? base.unitId
          : '',
    type: AD_TYPES.indexOf(source.type) >= 0 ? source.type : AD_TYPES.indexOf(base.type) >= 0 ? base.type : 'template'
  }
}

/** 旧配置没有 ads 字段时补默认值，保证升级后客户端不崩 */
function normalizeAds(input, fallback) {
  const source = isObject(input) ? input : {}
  const base = isObject(fallback) ? fallback : {}
  const out = {}
  AD_SLOTS.forEach((slot) => {
    out[slot] = normalizeAdSlot(source[slot], base[slot])
  })
  return out
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
    ads: normalizeAds(source.ads, fallback.ads),
    backgrounds: normalizeBackgrounds(source.backgrounds, fallback.backgrounds),
    defaultBackgroundId:
      typeof source.defaultBackgroundId === 'string'
        ? source.defaultBackgroundId
        : typeof fallback.defaultBackgroundId === 'string'
          ? fallback.defaultBackgroundId
          : '',
    backgroundUnlockHours:
      Number(source.backgroundUnlockHours) ||
      Number(fallback.backgroundUnlockHours) ||
      DEFAULT_BACKGROUND_UNLOCK_HOURS,
    features: Object.assign({}, DEFAULT_FEATURES, fallback.features || {}, isObject(source.features) ? source.features : {}),
    cache: Object.assign({}, DEFAULT_CACHE, fallback.cache || {}, isObject(source.cache) ? source.cache : {}),
    copy: Object.assign({}, fallback.copy || {}, isObject(source.copy) ? source.copy : {})
  }
}

/**
 * 后台保存时的严格校验，返回可直接下发的配置（不含 version）。
 * base 为当前已生效配置：请求体未携带 ads 时沿用旧值，避免旧后台标签页/脚本把展示位静默清零。
 */
function validateConfig(input, base) {
  if (!isObject(input)) throw invalidBody('配置格式错误')

  // 部分字段保存时一律沿用当前生效配置，避免旧后台/脚本把未提交字段静默重置。
  const baseConfig = isObject(base) ? base : {}
  const audioInput = input.audio === undefined ? baseConfig.audio : input.audio
  if (!Array.isArray(audioInput) || !audioInput.length) {
    throw invalidBody('至少保留 1 条环境音')
  }
  if (audioInput.length > MAX_AUDIO) {
    throw invalidBody('最多 ' + MAX_AUDIO + ' 条环境音')
  }

  const seen = {}
  const audio = audioInput.map((item, index) => {
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

  const unlockInput = Object.assign(
    {},
    isObject(baseConfig.unlock) ? baseConfig.unlock : {},
    isObject(input.unlock) ? input.unlock : {}
  )

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

  const featuresInput = Object.assign(
    {},
    isObject(baseConfig.features) ? baseConfig.features : {},
    isObject(input.features) ? input.features : {}
  )
  const features = {
    summary: featuresInput.summary !== false,
    sync: featuresInput.sync !== false,
    timer: featuresInput.timer !== false,
    preload: featuresInput.preload !== false,
    events: featuresInput.events !== false
  }

  const cacheInput = Object.assign(
    {},
    isObject(baseConfig.cache) ? baseConfig.cache : {},
    isObject(input.cache) ? input.cache : {}
  )

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

  const adsInput = isObject(input.ads) ? input.ads : {}
  const baseAds = isObject(base) && isObject(base.ads) ? base.ads : {}
  const ads = {}
  AD_SLOTS.forEach((slot) => {
    // 整个 ads 缺失或只提交部分槽位时，未提交的槽位沿用当前配置
    const raw = isObject(adsInput[slot])
      ? adsInput[slot]
      : isObject(baseAds[slot])
        ? baseAds[slot]
        : {}
    let type = 'template'
    if (raw.type !== undefined) {
      if (AD_TYPES.indexOf(raw.type) < 0) {
        throw invalidBody('展示位类型只能是 template 或 banner')
      }
      type = raw.type
    }
    const unitId = readText(raw.unitId, '展示位广告位 ID', 64, false)
    if (raw.enabled === true && !unitId) {
      throw invalidBody('已启用的展示位必须填写广告位 ID')
    }
    ads[slot] = {
      enabled: raw.enabled === true,
      unitId,
      type
    }
  })

  const backgroundsInput = Array.isArray(input.backgrounds)
    ? input.backgrounds
    : Array.isArray(baseConfig.backgrounds)
      ? baseConfig.backgrounds
      : []
  if (backgroundsInput.length > MAX_BACKGROUNDS) {
    throw invalidBody('最多 ' + MAX_BACKGROUNDS + ' 张背景图')
  }
  const seenBg = {}
  const backgrounds = backgroundsInput.map((item, index) => {
    const label = '第 ' + (index + 1) + ' 张背景图'
    if (!isObject(item)) throw invalidBody(label + '格式错误')

    const title = readText(item.title, label + '名称', 30, true)
    const url = readText(item.url, label + '地址', 500, true)
    if (!/^https:\/\/[^\s]+$/i.test(url)) {
      throw invalidBody(label + '地址必须以 https:// 开头')
    }
    const category = readText(item.category, label + '分类', 12, false) || '夜色'

    let id = readText(item.id, label + ' ID', 32, false)
    if (!id) id = 'bg-' + Date.now().toString(36) + '-' + (index + 1)
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw invalidBody(label + ' ID 只能包含字母、数字、下划线和短横线')
    }
    if (seenBg[id]) throw invalidBody('背景图 ID 重复：' + id)
    seenBg[id] = true

    let sort = index
    if (item.sort !== undefined) {
      const n = Number(item.sort)
      if (!Number.isInteger(n) || n < 0 || n > 999) {
        throw invalidBody(label + '排序需为 0–999 的整数')
      }
      sort = n
    }

    return {
      id,
      title,
      category,
      url,
      sort,
      enabled: item.enabled !== false
    }
  })

  const defaultInput =
    input.defaultBackgroundId !== undefined ? input.defaultBackgroundId : baseConfig.defaultBackgroundId
  let defaultBackgroundId = readText(defaultInput, '默认背景图', 32, false)
  if (defaultBackgroundId && !seenBg[defaultBackgroundId]) {
    throw invalidBody('默认背景图不在列表中')
  }

  const unlockHoursInput =
    input.backgroundUnlockHours !== undefined
      ? input.backgroundUnlockHours
      : baseConfig.backgroundUnlockHours
  let backgroundUnlockHours = DEFAULT_BACKGROUND_UNLOCK_HOURS
  if (unlockHoursInput !== undefined) {
    const n = Number(unlockHoursInput)
    if (!Number.isInteger(n) || n < 1 || n > 168) {
      throw invalidBody('背景图解锁时长需为 1–168 小时的整数')
    }
    backgroundUnlockHours = n
  }

  const copyInput = Object.assign(
    {},
    isObject(baseConfig.copy) ? baseConfig.copy : {},
    isObject(input.copy) ? input.copy : {}
  )
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
    ads,
    backgrounds,
    defaultBackgroundId,
    backgroundUnlockHours,
    features,
    cache: { maxMB, ttlDays },
    copy
  }
}

module.exports = {
  ICONS,
  MAX_AUDIO,
  AD_SLOTS,
  AD_TYPES,
  MAX_BACKGROUNDS,
  normalizeConfig,
  validateConfig
}
