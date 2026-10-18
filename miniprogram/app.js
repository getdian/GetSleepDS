const { loadConfig } = require('./utils/config')
const { syncNow } = require('./utils/sync')
const storage = require('./utils/storage')
const events = require('./utils/events')
const audioCache = require('./utils/audio-cache')

App({
  globalData: {
    config: null,
    // 配置加载的 Promise，页面可 await，但页面不依赖它才能渲染
    configReady: null
  },

  onLaunch() {
    this.globalData.configReady = loadConfig()
      .then((config) => {
        this.globalData.config = config
        return config
      })
      .catch(() => null)

    this.globalData.configReady.then((config) => {
      // 首次启动静默补一次云端备份；失败不影响使用
      syncNow().catch(() => {})

      if (!config) return

      events.track('app_open')
      events.flush()
      audioCache.maybePrune(config.cache)

      // 已解锁时，Wi-Fi 下预热前两条环境音（不阻塞、不打扰）
      audioCache.warmup(
        config.audio,
        config.cache,
        storage.getUnlockExpire() > Date.now()
      )
    })
  },

  onShow() {
    events.flush()

    if (!this.globalData.config) {
      loadConfig(true)
        .then((config) => {
          this.globalData.config = config
        })
        .catch(() => {})
    }
  }
})
