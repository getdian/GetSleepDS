/**
 * 播放器 notice 文案（`audio-player` 只发 code，文案由视图层显示）。
 *
 * 为什么要共用一份：文案原先只写在 `audio-dock` 里，于是首页/统计页遇到
 * `expired / load_timeout / audio_failed / only_one_track / bad_url / meta_save_failed`
 * 时完全没有提示——同一件事在三个页面说法不同，甚至静默。
 * 两个视图（入睡页抽屉、跨页迷你条）现在都从这里取文案。
 */
const PLAYER_NOTICES = {
  expired: '解锁已到期，重新解锁后继续',
  network_back: '网络已恢复，解锁后可继续播放',
  play_failed: '播放失败，请重试',
  load_timeout: '连接超时，点按重试',
  audio_failed: '音频加载失败，点按重试',
  replay_limited: '播放异常，请重新播放',
  timer_stop: '定时结束，已停止播放',
  only_one_track: '只有一个音源',
  bad_url: '音频地址未配置',
  unsupported: '当前版本不支持后台播放',
  meta_save_failed: '播放状态保存失败'
}

/** 取 code 对应的提示文案；未知 code 返回空串（静默，不弹空 toast） */
function noticeText(code) {
  return PLAYER_NOTICES[code] || ''
}

module.exports = { PLAYER_NOTICES, noticeText }
