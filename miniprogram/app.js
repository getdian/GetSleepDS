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
    const launchSource = launchSourceOf(options)
    this._lastLaunchKey = launchSource

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
      // 只有用户在统计页显式开启云备份后才会真正上传；未开启时直接跳过
      syncNow().catch(() => {})

      if (!config) return

      // 带上启动来源（转发/朋友圈/扫码等 scene），后台看板据此做来源分布
      events.track('app_open', launchSource)
      events.flush()
      const lastTrackId = storage.getMeta().lastTrackId
      const playing = (config.audio || []).filter((track) => track.id === lastTrackId)[0]
      audioCache.maybePrune(config.cache, playing && playing.url)

      // 已解锁时，Wi-Fi 下预热前两条环境音（不阻塞、不打扰）
      audioCache.warmup(
        config.audio,
        config.cache,
        storage.getUnlockExpire() > Date.now()
      )
    })
  },

  onShow(options) {
    // 热启动从分享卡片/海报码回到前台也要归因；冷启动由 onLaunch 负责，key 去重避免双报。
    // 只处理带 from/scene 的明确分享/扫码，避免普通切回前台把当前页误记成新来源。
    const query = (options && options.query) || {}
    if (query.from || query.scene) {
      const source = launchSourceOf(options)
      if (source && source !== this._lastLaunchKey) {
        this._lastLaunchKey = source
        events.track('app_open', source)
      }
    }
    events.flush()
    const current = this.globalData.config
    if (!current || !current.features || current.features.timer !== false) {
      audioTimer.restore()
    }

    // 每次回前台都强制刷新，后台改广告位/背景图/开关后能尽快生效；
    // config 内部有在途去重，不会和页面 onShow 的请求叠加。
    loadConfig(true)
      .then((config) => {
        this.globalData.config = config
      })
      .catch(() => {})
  }
})
