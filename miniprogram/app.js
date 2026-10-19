const { loadConfig } = require('./utils/config')
const { syncNow } = require('./utils/sync')
const storage = require('./utils/storage')
const events = require('./utils/events')
const { launchSourceOf } = require('./utils/launch-source')
const audioCache = require('./utils/audio-cache')
const audioTimer = require('./utils/audio-timer')

App({
  globalData: {
    config: null,
    // 配置加载的 Promise，页面可 await，但页面不依赖它才能渲染
    configReady: null
  },

  onLaunch(options) {
    // 开发版专用：真实感模拟数据入口（体验/正式版不挂载）
    // 开发者工具 console 里执行：getApp().seedDemo() 或 getApp().seedDemo(60)
    try {
      const envInfo = wx.getAccountInfoSync && wx.getAccountInfoSync()
      if (envInfo && envInfo.miniProgram && envInfo.miniProgram.envVersion === 'develop') {
        const devSeed = require('./utils/dev-seed')
        this.seedDemo = (days) => devSeed.seedRealistic(days)
      }
    } catch (e) {}

    this.globalData.configReady = loadConfig(true)
      .then((config) => {
        this.globalData.config = config
        return config
      })
      .catch(() => null)

    this.globalData.configReady.then((config) => {
      // 首次启动静默补一次云端备份；失败不影响使用
      syncNow().catch(() => {})

      if (!config) return

      // 带上启动来源（转发/朋友圈/扫码等 scene），后台看板据此做来源分布
      events.track('app_open', launchSourceOf(options))
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
    const current = this.globalData.config
    if (!current || !current.features || current.features.timer !== false) {
      audioTimer.restore()
    }

    if (!this.globalData.config) {
      loadConfig(true)
        .then((config) => {
          this.globalData.config = config
        })
        .catch(() => {})
    }
  }
})
