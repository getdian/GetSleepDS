const { invalidBody } = require('./errors')

const ICONS = ['rain', 'wave', 'fire', 'noise', 'night']
const MAX_AUDIO = 10
// 「人气基数」上限（环境音收藏数 / 背景使用次数共用）：
// 只影响前台展示的起点，真实计数在其上累加。
const MAX_COUNT_BASE = 99999
const DEFAULT_FEATURES = {
  summary: true,
  sync: true,
  timer: true,
  preload: true,
  events: true,
  feedback: true
}
const DEFAULT_CACHE = { maxMB: 80, ttlDays: 7 }
// 页面展示位：默认全部关闭，运营在后台按需开启并填广告位 ID
const AD_SLOTS = ['home', 'sleep', 'stats', 'statsFooter']
const AD_TYPES = ['template', 'banner']
// 首页背景图：默认免费；用户主动更换需看广告解锁
const MAX_BACKGROUNDS = 20
const DEFAULT_BACKGROUND_UNLOCK_HOURS = 24
// 落地页展示：小程序码（后台可上传/清除）与二维码下方的引导文案
const DEFAULT_SITE = { mpQrCodeUrl: '', mpQrNote: '微信搜索「睡点」' }
// 国际站（Web）：站点文案、订阅 CTA、广告与分析 ID；构建期快照 + 运行时兜底。
const DEFAULT_WEB = {
  enabled: true,
  brand: 'SleepCycle',
  tagline: 'Find the bedtime that fits your wake-up call',
  ctaUrl: '',
  adsenseClient: '',
  analyticsId: '',
  locales: ['en', 'es'],
  disclaimer: 'SleepCycle is a planning tool, not medical advice.',
  // 免费额度（0 = 不限）与订阅购买链接；两者配合形成付费墙。
  freeLimit: 5,
  proUrl: ''
}
const WEB_LOCALES = ['en', 'es', 'pt', 'id', 'de', 'fr', 'ja']
// 订阅消息：模板 ID 由运营在微信公众平台申请后填到这里（后台可视化，无需重启）。
// enabled 默认 true 表示“没关门”，真正的可用性取决于 templateId 是否填写；
// 只有运营显式取消勾选才停止下发与创建新提醒。
const DEFAULT_REMINDER = {
  enabled: true,
  templateId: '',
  page: 'pages/sleep/sleep?end=1',
  // 模板字段名：不同模板的关键词不同（thing1/time2、time1/thing2…）。
  // 后台可改，避免“换一个模板就得改代码”。
  thingKey: 'thing1',
  timeKey: 'time2'
}
const REMINDER_PAGE_RE = /^pages\/[A-Za-z0-9_/-]+(\?[^\s]*)?$/
const REMINDER_KEY_RE = /^[a-z]+\d{1,2}$/
// 解锁说明的自动生成模板：命中即视为"未自定义"，随 ttlHours 重新生成。
// 兼容历史默认文案里的“今晚的”：环境音任何时段都能听，新文案不再预设夜间。
const AUTO_UNLOCK_DESC = /^观看视频，解锁(?:今晚的)?环境声音（\d+\s*小时内有效）$/

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
      enabled: value.enabled !== false,
      // 展示用「已被使用 N 次」基数；历史配置没有该字段时按 0（前台回落原文案）
      useBase: clampCount(value.useBase)
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

function normalizeSite(input, fallback) {
  const source = isObject(input) ? input : {}
  const base = isObject(fallback) ? fallback : DEFAULT_SITE
  return {
    mpQrCodeUrl:
      typeof source.mpQrCodeUrl === 'string'
        ? source.mpQrCodeUrl
        : typeof base.mpQrCodeUrl === 'string'
          ? base.mpQrCodeUrl
          : DEFAULT_SITE.mpQrCodeUrl,
    mpQrNote:
      typeof source.mpQrNote === 'string' && source.mpQrNote
        ? source.mpQrNote
        : typeof base.mpQrNote === 'string' && base.mpQrNote
          ? base.mpQrNote
          : DEFAULT_SITE.mpQrNote
  }
}

/**
 * 国际站（Web）配置的归一化。
 *
 * 为什么必须有这一段：`web` 之前只在 validateConfig（后台保存）里出现，
 * normalizeConfig 的返回对象漏了它，而 config-store 每次读都要过 normalizeConfig——
 * 于是后台保存的 web 在 30s 缓存过期后就被静默丢弃，/api/config 从来不含它
 * （docs/14 §9 要求「后台可视化、无需重启」，实测是只写不读）。
 * 这里补上归一化，并沿用后台的 locales 白名单口径。
 */
function normalizeWeb(input, fallback) {
  const source = isObject(input) ? input : {}
  const base = isObject(fallback) ? fallback : {}
  const merged = Object.assign({}, DEFAULT_WEB, base, source)
  const locales = Array.isArray(merged.locales) ? merged.locales : DEFAULT_WEB.locales
  const usable = locales.filter((item) => WEB_LOCALES.indexOf(item) >= 0).slice(0, 4)
  merged.enabled = merged.enabled !== false
  merged.locales = usable.length ? usable : DEFAULT_WEB.locales
  return merged
}

function normalizeReminder(input, fallback) {
  const source = isObject(input) ? input : {}
  const base = isObject(fallback) ? fallback : DEFAULT_REMINDER
  return {
    enabled: source.enabled === undefined ? base.enabled !== false : source.enabled !== false,
    templateId:
      typeof source.templateId === 'string'
        ? source.templateId
        : typeof base.templateId === 'string'
          ? base.templateId
          : '',
    page:
      typeof source.page === 'string' && source.page
        ? source.page
        : typeof base.page === 'string' && base.page
          ? base.page
          : DEFAULT_REMINDER.page,
    thingKey:
      typeof source.thingKey === 'string' && source.thingKey
        ? source.thingKey
        : typeof base.thingKey === 'string' && base.thingKey
          ? base.thingKey
          : DEFAULT_REMINDER.thingKey,
    timeKey:
      typeof source.timeKey === 'string' && source.timeKey
        ? source.timeKey
        : typeof base.timeKey === 'string' && base.timeKey
          ? base.timeKey
          : DEFAULT_REMINDER.timeKey
  }
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

/** 读路径的宽容版：脏数据/旧配置一律落到 0，不让一条坏基数阻断整个 /api/config */
function clampCount(value) {
  const num = Math.floor(Number(value))
  if (!Number.isFinite(num) || num <= 0) return 0
  return Math.min(num, MAX_COUNT_BASE)
}

/** 按 id 建索引：保存时「旧后台未提交某字段」要按同 id 沿用已生效值 */
function indexById(list) {
  const map = {}
  ;(Array.isArray(list) ? list : []).forEach((item) => {
    if (item && typeof item.id === 'string') map[item.id] = item
  })
  return map
}

/** 保存路径的严格版：后台填错要报错，而不是静默改成 0 */
function readCount(value, label) {
  if (value === undefined || value === null || value === '') return 0
  const num = Number(value)
  if (!Number.isInteger(num) || num < 0 || num > MAX_COUNT_BASE) {
    throw invalidBody(label + '人气基数需为 0–' + MAX_COUNT_BASE + ' 的整数')
  }
  return num
}

/** 文件配置 / 数据库配置的宽松合并，缺失字段用兜底补齐 */
function normalizeConfig(input, base) {
  const source = isObject(input) ? input : {}
  const fallback = base || {}
  const rawAudio =
    Array.isArray(source.audio) && source.audio.length ? source.audio : fallback.audio || []

  // 旧版本配置没有 category / favBase，这里逐条补齐，避免升级后分类筛选直接空掉
  const audio = rawAudio.map((item) => {
    const value = isObject(item) ? item : {}
    return {
      id: typeof value.id === 'string' ? value.id : '',
      title: value.title || '未命名环境音',
      subtitle: value.subtitle || '循环播放 · 支持锁屏',
      category: value.category || '环境音',
      url: value.url || '',
      icon: ICONS.indexOf(value.icon) >= 0 ? value.icon : 'noise',
      // 展示用收藏基数：历史配置没有该字段时按 0（只显示真实收藏）
      favBase: clampCount(value.favBase)
    }
  })

  const backgrounds = normalizeBackgrounds(source.backgrounds, fallback.backgrounds)
  const enabledBgIds = {}
  backgrounds.forEach((item) => {
    if (item.enabled !== false) enabledBgIds[item.id] = true
  })
  let defaultBackgroundId =
    typeof source.defaultBackgroundId === 'string'
      ? source.defaultBackgroundId
      : typeof fallback.defaultBackgroundId === 'string'
        ? fallback.defaultBackgroundId
        : ''
  // 历史库行/直接改库可能留下“默认图已停用或不存在”的组合。
  // 保存路径会拦截，但读路径也必须兜底，否则 /api/config 会原样下发，
  // 后台打开时下拉变空、保存其它字段就静默清掉默认背景。
  if (defaultBackgroundId && !enabledBgIds[defaultBackgroundId]) defaultBackgroundId = ''

  const unlock = Object.assign({}, fallback.unlock || {}, isObject(source.unlock) ? source.unlock : {})
  const copy = Object.assign({}, fallback.copy || {}, isObject(source.copy) ? source.copy : {})
  // 自动生成的说明文案统一重写：跟随 ttlHours（旧版写死 24 小时会出现抽屉两套数字），
  // 同时把历史“今晚的”旧词迁移掉；命中模板视为未自定义，用户自定义文案不动。
  if (typeof copy.unlockDesc === 'string' && AUTO_UNLOCK_DESC.test(copy.unlockDesc)) {
    copy.unlockDesc = '观看视频，解锁环境声音（' + (Number(unlock.ttlHours) || 24) + ' 小时内有效）'
  }

  return {
    version: Number(source.version) || Number(fallback.version) || 1,
    audio,
    unlock,
    ads: normalizeAds(source.ads, fallback.ads),
    backgrounds,
    defaultBackgroundId,
    backgroundUnlockHours:
      Number(source.backgroundUnlockHours) ||
      Number(fallback.backgroundUnlockHours) ||
      DEFAULT_BACKGROUND_UNLOCK_HOURS,
    site: normalizeSite(source.site, fallback.site),
    // 与 validateConfig 的返回保持一致：漏了它，后台保存的 web 段会在下一次读时消失
    web: normalizeWeb(source.web, fallback.web),
    reminder: normalizeReminder(source.reminder, fallback.reminder),
    features: Object.assign({}, DEFAULT_FEATURES, fallback.features || {}, isObject(source.features) ? source.features : {}),
    cache: Object.assign({}, DEFAULT_CACHE, fallback.cache || {}, isObject(source.cache) ? source.cache : {}),
    copy
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

  // 旧后台标签页 / 脚本提交的 audio 条目没有 favBase：按同 id 的已生效值沿用，
  // 否则运营只改个标题就会把收藏基数一起清零。
  const baseAudioById = indexById(baseConfig.audio)

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
    if (!id) id = 'track-' + Date.now().toString(36) + '-' + (index + 1) + '-' + Math.random().toString(36).slice(2, 6)
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw invalidBody(label + ' ID 只能包含字母、数字、下划线和短横线')
    }
    if (seen[id]) throw invalidBody('环境音 ID 重复：' + id)
    seen[id] = true

    const favBaseFallback = baseAudioById[id] ? baseAudioById[id].favBase : 0
    const favBase = readCount(item.favBase === undefined ? favBaseFallback : item.favBase, label)

    return {
      id,
      title,
      subtitle: subtitle || '循环播放 · 支持锁屏',
      category,
      url,
      icon,
      favBase
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
    events: featuresInput.events !== false,
    feedback: featuresInput.feedback !== false
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
  // 旧后台标签页 / 脚本提交的背景条目没有 useBase：按同 id 的已生效值沿用，
  // 否则运营只改个标题就会把使用基数一起清零。
  const baseBgById = indexById(baseConfig.backgrounds)

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
    if (!id) id = 'bg-' + Date.now().toString(36) + '-' + (index + 1) + '-' + Math.random().toString(36).slice(2, 6)
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw invalidBody(label + ' ID 只能包含字母、数字、下划线和短横线')
    }
    if (Object.prototype.hasOwnProperty.call(seenBg, id)) {
      throw invalidBody('背景图 ID 重复：' + id)
    }
    seenBg[id] = item.enabled !== false

    let sort = index
    if (item.sort !== undefined) {
      const n = Number(item.sort)
      if (!Number.isInteger(n) || n < 0 || n > 999) {
        throw invalidBody(label + '排序需为 0–999 的整数')
      }
      sort = n
    }

    const useBaseFallback = baseBgById[id] ? baseBgById[id].useBase : 0
    const useBase = readCount(item.useBase === undefined ? useBaseFallback : item.useBase, label)

    return {
      id,
      title,
      category,
      url,
      sort,
      enabled: item.enabled !== false,
      useBase
    }
  })

  const defaultInput =
    input.defaultBackgroundId !== undefined ? input.defaultBackgroundId : baseConfig.defaultBackgroundId
  let defaultBackgroundId = readText(defaultInput, '默认背景图', 32, false)
  if (defaultBackgroundId && !Object.prototype.hasOwnProperty.call(seenBg, defaultBackgroundId)) {
    throw invalidBody('默认背景图不在列表中')
  }
  if (defaultBackgroundId && seenBg[defaultBackgroundId] === false) {
    throw invalidBody('默认背景图已停用，请先启用或换一张')
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

  const siteInput = Object.assign(
    {},
    isObject(baseConfig.site) ? baseConfig.site : {},
    isObject(input.site) ? input.site : {}
  )
  const site = {
    // 小程序码可留空（落地页回退为“微信搜索」提示），但填了必须是 https 图片地址
    mpQrCodeUrl: readText(siteInput.mpQrCodeUrl, '小程序码地址', 500, false)
  }
  if (site.mpQrCodeUrl && !/^https:\/\//i.test(site.mpQrCodeUrl)) {
    throw invalidBody('小程序码地址必须以 https:// 开头')
  }
  site.mpQrNote = readText(siteInput.mpQrNote, '小程序码文案', 30, false) || '微信搜索「睡点」'

  // 国际站配置：只放公开展示项，不放任何密钥（AdSense 客户端 ID 本身是公开的）
  const webInput = Object.assign(
    {},
    isObject(baseConfig.web) ? baseConfig.web : {},
    isObject(input.web) ? input.web : {}
  )
  const webCtaUrl = readText(webInput.ctaUrl, '外部 CTA 链接', 300, false)
  if (webCtaUrl && !/^https:\/\//i.test(webCtaUrl)) {
    throw invalidBody('外部 CTA 链接必须以 https:// 开头')
  }
  const webAdsenseClient = readText(webInput.adsenseClient, 'AdSense 客户端 ID', 40, false)
  if (webAdsenseClient && !/^ca-pub-\d{10,20}$/.test(webAdsenseClient)) {
    throw invalidBody('AdSense 客户端 ID 形如 ca-pub-1234567890123456')
  }
  const webProUrl = readText(webInput.proUrl, '订阅购买链接', 300, false)
  if (webProUrl && !/^https:\/\//i.test(webProUrl)) {
    throw invalidBody('订阅购买链接必须以 https:// 开头')
  }
  const rawFreeLimit = Number(webInput.freeLimit)
  const webFreeLimit =
    Number.isInteger(rawFreeLimit) && rawFreeLimit >= 0 && rawFreeLimit <= 100
      ? rawFreeLimit
      : DEFAULT_WEB.freeLimit
  const webLocalesInput = Array.isArray(webInput.locales) ? webInput.locales : DEFAULT_WEB.locales
  const webLocales = webLocalesInput.filter((item) => WEB_LOCALES.indexOf(item) >= 0).slice(0, 4)
  const web = {
    enabled: webInput.enabled !== false,
    brand: readText(webInput.brand, '站点品牌', 24, false) || DEFAULT_WEB.brand,
    tagline: readText(webInput.tagline, '站点标语', 80, false) || DEFAULT_WEB.tagline,
    ctaUrl: webCtaUrl,
    adsenseClient: webAdsenseClient,
    analyticsId: readText(webInput.analyticsId, '分析 ID', 40, false),
    locales: webLocales.length ? webLocales : ['en'],
    disclaimer: readText(webInput.disclaimer, '免责声明', 300, false) || DEFAULT_WEB.disclaimer,
    freeLimit: webFreeLimit,
    proUrl: webProUrl
  }

  const copyInput = Object.assign(
    {},
    isObject(baseConfig.copy) ? baseConfig.copy : {},
    isObject(input.copy) ? input.copy : {}
  )
  // 自动生成的说明文案必须跟随 ttlHours，否则改完时长抽屉里会出现两套数字。
  // 兼容历史两种格式：旧的「（24小时内有效）」与新生成的「（24 小时内有效）」。
  if (typeof copyInput.unlockDesc === 'string' && AUTO_UNLOCK_DESC.test(copyInput.unlockDesc)) {
    copyInput.unlockDesc = ''
  }
  const copy = {
    unlockTitle: readText(copyInput.unlockTitle, '解锁标题', 20, false) || '解锁环境音',
    unlockDesc:
      readText(copyInput.unlockDesc, '解锁说明', 60, false) ||
      // 未自定义时跟随可配置的 ttlHours；写死 24 小时会和抽屉里的“解锁 N 小时”互相矛盾。
      // 文案不写“今晚”：环境音任何时段都能听。
      '观看视频，解锁环境声音（' + ttlHours + ' 小时内有效）',
    unlockConfirm: readText(copyInput.unlockConfirm, '确认按钮', 10, false) || '观看视频',
    unlockCancel: readText(copyInput.unlockCancel, '取消按钮', 10, false) || '先不用'
  }

  const reminderInput = Object.assign(
    {},
    isObject(baseConfig.reminder) ? baseConfig.reminder : {},
    isObject(input.reminder) ? input.reminder : {}
  )
  const reminderTemplateId = readText(reminderInput.templateId, '订阅消息模板 ID', 64, false)
  if (reminderTemplateId && !/^[A-Za-z0-9_-]{10,64}$/.test(reminderTemplateId)) {
    throw invalidBody('订阅消息模板 ID 格式不正确（微信后台复制，通常 43 位字母/数字/下划线/短横线）')
  }
  const reminderPage =
    readText(reminderInput.page, '提醒跳转路径', 128, false) || DEFAULT_REMINDER.page
  if (!REMINDER_PAGE_RE.test(reminderPage)) {
    throw invalidBody('提醒跳转路径需形如 pages/sleep/sleep?end=1')
  }
  const reminderThingKey =
    readText(reminderInput.thingKey, '提醒事项字段名', 20, false) ||
    DEFAULT_REMINDER.thingKey
  const reminderTimeKey =
    readText(reminderInput.timeKey, '提醒时间字段名', 20, false) ||
    DEFAULT_REMINDER.timeKey
  if (!REMINDER_KEY_RE.test(reminderThingKey) || !REMINDER_KEY_RE.test(reminderTimeKey)) {
    throw invalidBody('模板字段名需形如 thing1 / time2（小写字母 + 数字）')
  }
  if (reminderThingKey === reminderTimeKey) {
    throw invalidBody('提醒事项与提醒时间不能使用同一个字段名')
  }
  if (reminderInput.enabled !== false && !reminderTemplateId && baseConfig.reminder && baseConfig.reminder.templateId) {
    // 显式清空模板 ID 等价于关闭，不留在“开启但不可用”的中间态
    reminderInput.enabled = false
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
    site,
    web,
    reminder: {
      enabled: reminderInput.enabled !== false,
      templateId: reminderTemplateId,
      page: reminderPage,
      thingKey: reminderThingKey,
      timeKey: reminderTimeKey
    },
    features,
    cache: { maxMB, ttlDays },
    copy
  }
}

module.exports = {
  ICONS,
  MAX_AUDIO,
  MAX_COUNT_BASE,
  AD_SLOTS,
  AD_TYPES,
  MAX_BACKGROUNDS,
  normalizeConfig,
  validateConfig
}
