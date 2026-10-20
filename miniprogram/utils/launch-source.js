/**
 * 启动来源归一化：写入 app_open 事件的 target 字段。
 * 形如 "1007|pages/index/index|share"（scene + 打开页 + 分享 from 参数），
 * 服务端 target 上限 64 字符，这里同样截断兜底。
 * 零 wx 依赖，Node 可直接单测。
 */
function launchSourceOf(options) {
  if (!options || typeof options !== 'object') return '0'
  const scene = options.scene ? String(options.scene) : '0'
  const path = typeof options.path === 'string' ? options.path.replace(/^\/+/, '') : ''
  const query = options.query && typeof options.query === 'object' ? options.query : {}
  // 海报小程序码通过 query.scene='p' 下发；归入 from=qr:p，复用看板来源展示。
  const from =
    typeof query.from === 'string'
      ? query.from.slice(0, 16)
      : typeof query.scene === 'string' && query.scene
        ? ('qr:' + query.scene).slice(0, 16)
        : ''
  const parts = [scene]
  if (path) parts.push(path)
  if (from) parts.push(from)
  return parts.join('|').slice(0, 64)
}

module.exports = { launchSourceOf }
