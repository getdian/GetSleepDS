/**
 * 服务端配置不可达时的兜底。
 * 结构必须与 server/config/app.config.json 保持一致。
 * 音频 url 是占位地址，替换成 COS 正式地址后才能播放。
 */
module.exports = {
  version: 1,
  audio: [
    {
      id: 'sleep-10001',
      title: '雨声',
      subtitle: '循环雨声 · 支持锁屏',
      category: '自然之声',
      url: 'https://qfmaster-1322402212.cos.ap-shanghai.myqcloud.com/sleep/sleep-10001.mp3',
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
    events: true
  },
  cache: {
    maxMB: 80,
    ttlDays: 7
  },
  copy: {
    unlockTitle: '解锁环境音',
    unlockDesc: '观看视频，解锁今晚的环境声音（24小时内有效）',
    unlockConfirm: '观看视频',
    unlockCancel: '先不用'
  }
}
