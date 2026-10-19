const { normalizeConfig, validateConfig } = require('../lib/config-schema')

const CACHE_TTL = 30 * 1000

/**
 * 配置的唯一读取入口：数据库优先，读不到时回退到部署时的 JSON 文件。
 * 后台保存后立即刷新缓存，/api/config 马上生效。
 */
function createConfigStore(options) {
  const db = options.db
  const logger = options.logger || console
  const base = normalizeConfig(options.fileConfig)

  let cache = null
  let lastWarnAt = 0

  async function readDb() {
    try {
      return await db.getAppConfig()
    } catch (error) {
      if (Date.now() - lastWarnAt > 60 * 1000) {
        lastWarnAt = Date.now()
        logger.error('[config] 读取数据库配置失败，回退到文件：' + error.message)
      }
      return null
    }
  }

  async function get() {
    if (cache && Date.now() - cache.at < CACHE_TTL) return cache.value

    const row = await readDb()
    if (row && row.value) {
      cache = {
        at: Date.now(),
        value: {
          config: normalizeConfig(row.value, base),
          updatedAt: row.updatedAt,
          source: 'db'
        }
      }
    } else {
      cache = {
        at: Date.now(),
        value: {
          config: base,
          updatedAt: 0,
          source: 'file'
        }
      }
    }

    return cache.value
  }

  async function save(input) {
    const current = await get()
    const clean = validateConfig(input, current.config)
    const next = Object.assign({}, clean, {
      version: (current.config.version || 1) + 1
    })

    let updatedAt = 0
    try {
      updatedAt = await db.saveAppConfig(next)
    } catch (error) {
      const wrapped = new Error('配置保存失败')
      wrapped.code = 'DB_UNAVAILABLE'
      wrapped.status = 503
      throw wrapped
    }

    cache = {
      at: Date.now(),
      value: { config: next, updatedAt, source: 'db' }
    }
    return cache.value
  }

  function invalidate() {
    cache = null
  }

  return { get, save, invalidate }
}

module.exports = { createConfigStore }
