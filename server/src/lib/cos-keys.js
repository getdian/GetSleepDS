/**
 * 从「自家 COS 地址」反推对象 Key，并算出保存配置后可以删除的旧对象。
 *
 * 只允许删本服务自己上传的两个目录（backgrounds/、site/）：
 * - 音频可能来自历史 CDN / 别的桶，且多行可能共用同一文件，误删风险高；
 * - 小程序码与背景图是一次性上传物，替换后旧对象无人引用，可以安全回收。
 *
 * 为什么不在上传时删旧对象：上传后运营可能不点“保存并生效”，
 * 此时线上页面仍引用旧地址，提前删除会立刻 404。删除只在保存成功后做。
 */

const OWNED_DIRS = ['backgrounds/', 'site/']

function stripQuery(url) {
  const value = String(url || '')
  const index = value.search(/[?#]/)
  return index === -1 ? value : value.slice(0, index)
}

function keyFromOwnUrl(settings, url) {
  const value = stripQuery(url).trim()
  if (!value || !settings) return ''

  const domain = String(settings.domain || '').replace(/\/+$/, '')
  const bucketBase =
    settings.bucket && settings.region
      ? 'https://' + settings.bucket + '.cos.' + settings.region + '.myqcloud.com'
      : ''

  let key = ''
  if (domain && value.indexOf(domain + '/') === 0) {
    key = value.slice(domain.length + 1)
  } else if (bucketBase && value.indexOf(bucketBase + '/') === 0) {
    key = value.slice(bucketBase.length + 1)
  }
  if (!key) return ''

  try {
    key = decodeURIComponent(key)
  } catch (e) {
    return ''
  }

  const prefix = String(settings.prefix || 'sleep').replace(/^\/+|\/+$/g, '')
  const owned = OWNED_DIRS.map(function (dir) {
    return (prefix ? prefix + '/' : '') + dir
  })
  const isOwned = owned.some(function (dir) {
    return key.indexOf(dir) === 0
  })
  return isOwned ? key : ''
}

function collectOwnedUrls(config) {
  const urls = []
  const site = config && config.site
  if (site && typeof site.mpQrCodeUrl === 'string') urls.push(site.mpQrCodeUrl)

  const backgrounds = (config && config.backgrounds) || []
  backgrounds.forEach(function (item) {
    if (item && typeof item.url === 'string') urls.push(item.url)
  })
  return urls
}

/**
 * 返回“上一版配置用到、新配置不再引用”的自家对象 Key（去重）。
 * 音频不在统计范围内，见文件头说明。
 */
function orphanKeys(settings, prevConfig, nextConfig) {
  const next = new Set(collectOwnedUrls(nextConfig))
  const seen = new Set()
  const keys = []

  collectOwnedUrls(prevConfig).forEach(function (url) {
    if (!url || next.has(url)) return
    const key = keyFromOwnUrl(settings, url)
    if (!key || seen.has(key)) return
    seen.add(key)
    keys.push(key)
  })

  return keys
}

module.exports = { keyFromOwnUrl, orphanKeys, OWNED_DIRS }
