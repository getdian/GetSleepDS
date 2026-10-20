const { apiError, invalidBody } = require('../lib/errors')

function text(value, label, max, required) {
  if (value === undefined || value === null) {
    if (required) throw invalidBody(label + '不能为空')
    return ''
  }
  if (typeof value !== 'string') throw invalidBody(label + '必须是文本')
  const trimmed = value.trim()
  if (required && !trimmed) throw invalidBody(label + '不能为空')
  if (trimmed.length > max) throw invalidBody(label + '不能超过 ' + max + ' 个字符')
  return trimmed
}

/**
 * COS 连接配置。SecretKey 加密入库，接口只返回 hasSecret。
 */
function createStorageSettings(options) {
  const db = options.db
  const box = options.secretBox
  const securityReady = !!options.securityReady

  /** 只把数据库层异常映射成 503，业务校验错误保持原状。 */
  async function dbCall(run) {
    try {
      return await run()
    } catch (error) {
      if (error && (error.status || error.code === 'DB_UNAVAILABLE')) throw error
      const wrapped = new Error('数据库暂时不可用')
      wrapped.code = 'DB_UNAVAILABLE'
      wrapped.status = 503
      throw wrapped
    }
  }

  async function getRow() {
    return dbCall(() => db.getSetting('cos'))
  }

  async function getRaw() {
    const row = await getRow()
    if (!row || !row.value) return null
    const value = row.value
    return {
      bucket: value.bucket || '',
      region: value.region || '',
      domain: value.domain || '',
      prefix: value.prefix || 'sleep',
      secretId: value.secretId || '',
      secretKey: box.decrypt(value.secretKeyEnc)
    }
  }

  async function getPublic() {
    const row = await getRow()
    const value = row && row.value ? row.value : {}
    const secretKey = value.secretKeyEnc ? box.decrypt(value.secretKeyEnc) : ''
    const complete = !!(value.bucket && value.region && value.secretId && secretKey)
    return {
      securityReady,
      configured: complete,
      secretBroken: !!value.secretKeyEnc && !secretKey,
      bucket: value.bucket || '',
      region: value.region || '',
      domain: value.domain || '',
      prefix: value.prefix || 'sleep',
      secretId: value.secretId || '',
      hasSecret: !!value.secretKeyEnc
    }
  }

  async function save(input) {
    if (!securityReady) {
      throw apiError(
        'SECURITY_KEY_MISSING',
        '请先在服务端 .env 设置 ADMIN_PASSWORD 或 CONFIG_SECRET，再保存 COS 凭证',
        400
      )
    }
    if (!input || typeof input !== 'object') throw invalidBody('配置格式错误')

    const bucket = text(input.bucket, 'Bucket', 64, true)
    if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(bucket)) {
      throw invalidBody('Bucket 名称格式不正确')
    }

    const region = text(input.region, 'Region', 32, true)
    if (!/^[a-z0-9-]+$/.test(region)) throw invalidBody('Region 格式不正确')

    const domain = text(input.domain, '访问域名', 200, false)
    if (domain && !/^https:\/\/[^\s]+$/i.test(domain)) {
      throw invalidBody('访问域名必须是 https:// 开头')
    }

    let prefix = text(input.prefix, '存储路径', 80, false) || 'sleep'
    prefix = prefix.replace(/^\/+|\/+$/g, '')
    if (!/^[a-zA-Z0-9/_-]*$/.test(prefix)) {
      throw invalidBody('存储路径只能包含字母、数字、斜线、下划线和短横线')
    }

    const secretId = text(input.secretId, 'SecretId', 128, false)
    const existing = await getRow()
    const existingValue = existing && existing.value ? existing.value : {}
    const incomingSecret = text(input.secretKey, 'SecretKey', 128, false)
    const secretKeyEnc = incomingSecret ? box.encrypt(incomingSecret) : existingValue.secretKeyEnc || ''

    if (!secretId) throw invalidBody('SecretId 不能为空')
    if (!secretKeyEnc) throw invalidBody('SecretKey 不能为空')

    await dbCall(() =>
      db.saveSetting('cos', {
        bucket,
        region,
        domain,
        prefix,
        secretId,
        secretKeyEnc
      })
    )

    return getPublic()
  }

  return { getRaw, getPublic, save }
}

module.exports = { createStorageSettings }
