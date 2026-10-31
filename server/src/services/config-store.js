const { normalizeConfig, validateConfig } = require('../lib/config-schema')

const CACHE_TTL = 30 * 1000

/** 并发冲突的统一错误：后台据此提示「别人先保存过」，并且不覆盖对方的改动。 */
function conflictError() {
  const conflict = new Error('配置已被其他管理员更新，请刷新页面后重新保存')
  conflict.code = 'CONFIG_CONFLICT'
  conflict.status = 409
  return conflict
}

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
          revision: Number(row.revision) || 1,
          source: 'db'
        }
      }
    } else {
      cache = {
        at: Date.now(),
        value: {
          config: base,
          updatedAt: 0,
          revision: 0,
          source: 'file'
        }
      }
    }

    return cache.value
  }

  /**
   * @param input 完整配置（后台每次提交全量）
   * @param options { expectedRevision, expectedUpdatedAt }
   *   expectedRevision：后台载入时的发布版本，交给存储层做原子 CAS（并发保存只允许一个成功）；
   *   expectedUpdatedAt：旧后台的并发依据（毫秒时间戳），仅在没有 revision 时使用。
   *   两者都不传 = 脚本/内部调用，不做并发校验。
   */
  async function save(input, options) {
    const current = await get()
    const expectedRevision =
      options && options.expectedRevision !== undefined && options.expectedRevision !== null
        ? Number(options.expectedRevision)
        : null
    const expectedUpdatedAt = options && options.expectedUpdatedAt

    // 旧后台没有 revision 时退回时间戳判定（保留兼容，但它是缓存口径，非原子）
    if (
      expectedRevision === null &&
      expectedUpdatedAt !== undefined &&
      expectedUpdatedAt !== null &&
      Number(expectedUpdatedAt) !== Number(current.updatedAt)
    ) {
      throw conflictError()
    }

    const clean = validateConfig(input, current.config)
    const next = Object.assign({}, clean, {
      version: (current.config.version || 1) + 1
    })

    let saved = null
    try {
      saved = await db.saveAppConfig(next, { expectedRevision })
    } catch (error) {
      const wrapped = new Error('配置保存失败')
      wrapped.code = 'DB_UNAVAILABLE'
      wrapped.status = 503
      throw wrapped
    }

    // 存储层 CAS 失败 = 期间有人先保存过：这是并发冲突，不是数据库故障
    if (!saved) {
      cache = null
      throw conflictError()
    }

    cache = {
      at: Date.now(),
      value: { config: next, updatedAt: saved.updatedAt, revision: saved.revision, source: 'db' }
    }
    return cache.value
  }

  function invalidate() {
    cache = null
  }

  return { get, save, invalidate }
}

module.exports = { createConfigStore }
