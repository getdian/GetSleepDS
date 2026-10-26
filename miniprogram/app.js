const { loadConfig } = require('./utils/config')
const { syncNow } = require('./utils/sync')
const storage = require('./utils/storage')
const events = require('./utils/events')
const { launchSourceOf } = require('./utils/launch-source')
const launchIntent = require('./utils/launch-intent')
const audioCache = require('./utils/audio-cache')
const audioTimer = require('./utils/audio-timer')
const audioSession = require('./utils/audio-session')

App({
  globalData: {
    config: null,
    // 配置加载的 Promise，页面可 await，但页面不依赖它才能渲染
    configReady: null,
    // 计算器/统计页点迷你播放条后，切到入睡页并打开环境声抽屉
    openAudioSheet: false,
    // 本次启动是否创建过音频会话：冷启动时 meta 可能残留，避免画出幽灵播放条
    audioSession: false,
    // 本次会话在计算器选的「入睡耗时」（分钟，0=未选）。
    // 刻意不落存储：PRD 定的是「入睡耗时每次默认 15、会话内可调」，
    // 跨启动记忆会让隔天打卡莫名沿用上次的 30 分钟。
    fallMinutes: 0
  },

  onLaunch(options) {
    const launchSource = launchSourceOf(options)
    this._lastLaunchKey = launchSource
    // 冷启动捕获订阅消息意图；本进程首次 App.onShow 不重复捕获
    launchIntent.reset()
    launchIntent.capture(options)
    this._coldShowHandled = false

    // 中断可观测：会话层只发回调，事件队列由 App 注入（单测不启动上报定时器）
    audioSession.setReporter((type, target) => events.track(type, target))
    // 环境音中断恢复：注册 wx.onAudioInterruptionBegin/End（全局只注册一次），
    // 来电/闹钟/其他 App 抢占结束后自动续播（用户在小程序内主动暂停的不恢复）。
    audioSession.init()

    // 开发版专用：真实感模拟数据入口（体验/正式版不挂载）
    // 开发者工具 console 里执行：getApp().seedDemo() 或 getApp().seedDemo(60)
    try {
      const envInfo = wx.getAccountInfoSync && wx.getAccountInfoSync()
      if (envInfo && envInfo.miniProgram && envInfo.miniProgram.envVersion === 'develop') {
        const devSeed = require('./utils/dev-seed')
        this.seedDemo = (days) => devSeed.seedRealistic(days)
      }
    } catch (e) {}

    // 启动来源是本地即可确定的事实，不能等配置成功才记：
    // 新用户/弱网首启最慢，旧实现会把这一批 app_open 漏掉，获客分母系统性偏低。
    events.track('app_open', launchSource)
    events.flush()

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
    // 热启动也把订阅消息意图交给入睡页。首次 onShow 通常与 onLaunch 收到同一份
    // options：只有 onLaunch 没捕获到意图时才补捕获，避免重复或漏掉极端启动顺序。
    if (!this._coldShowHandled) {
      this._coldShowHandled = true
      if (!launchIntent.hasPending()) launchIntent.capture(options)
    } else {
      launchIntent.capture(options)
    }
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
    // 切到其他含音频的 App 不会触发 interruption 事件：回前台时补偿续播
    // （用户在小程序内主动暂停/停止的不会恢复，判定在 audio-session 内）
    audioSession.onAppShow()

    // 每次回前台都强制刷新，后台改广告位/背景图/开关后能尽快生效；
    // config 内部有在途去重，不会和页面 onShow 的请求叠加。
    loadConfig(true)
      .then((config) => {
        this.globalData.config = config
        // 首屏可能只有内置兜底配置（找不到上次的曲目），拿到真实清单后补一次续播
        audioSession.onConfigReady()
      })
      .catch(() => {})
  },

  onHide() {
    // 只记录“离开时是否在播”，真正的恢复判定在 onShow / interruptionEnd
    audioSession.onAppHide()
  }
})
