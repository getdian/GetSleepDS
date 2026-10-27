/**
 * 服务端配置不可达时的兜底。
 * 结构必须与 server/config/app.config.json 保持一致。
 * 音频地址必须与生产配置同域，否则会落在 downloadFile 白名单/COS 防盗链之外。
 */
module.exports = {
  version: 1,
  audio: [
    {
      id: 'sleep-10001',
      title: '雨声',
      subtitle: '循环雨声 · 支持锁屏',
      category: '自然之声',
      url: 'https://img.qfmaster.com/sleep/sleep-10001.mp3',
      icon: 'rain'
    }
  ],
  unlock: {
    mode: 'rewarded',
    adUnitId: '',
    ttlHours: 24,
    onAdError: 'grant'
  },
  ads: {
    home: { enabled: false, unitId: '', type: 'template' },
    sleep: { enabled: false, unitId: '', type: 'template' },
    stats: { enabled: false, unitId: '', type: 'template' },
    statsFooter: { enabled: false, unitId: '', type: 'template' }
  },
  backgrounds: [],
  defaultBackgroundId: '',
  backgroundUnlockHours: 24,
  features: {
    summary: true,
    sync: true,
    timer: true,
    preload: true,
    events: true,
    feedback: true
  },
  cache: {
    maxMB: 80,
    ttlDays: 7
  },
  reminder: {
    enabled: true,
    templateId: '',
    page: 'pages/sleep/sleep?end=1',
    // 与 server/config/app.config.json 保持同构（AGENTS.md 五处同改）；
    // 小程序端不消费，服务端发送时使用。
    thingKey: 'thing1',
    timeKey: 'time2'
  },
  // 国际站（Web）配置：小程序不消费，仅保持与 server/config/app.config.json 同构
  web: {
    enabled: true,
    brand: 'SleepCycle',
    tagline: 'Find the bedtime that fits your wake-up call',
    ctaUrl: '',
    adsenseClient: '',
    analyticsId: '',
    locales: ['en', 'es'],
    disclaimer: 'SleepCycle is a planning tool, not medical advice.',
    freeLimit: 5,
    proUrl: ''
  },
  copy: {
    unlockTitle: '解锁环境音',
    unlockDesc: '观看视频，解锁环境声音（24 小时内有效）',
    unlockConfirm: '观看视频',
    unlockCancel: '先不用'
  }
}
