/**
 * API 域名：开发版走本机，体验版/正式版走线上。
 * 这样同一份代码打包后无需再手改，也不会把 127.0.0.1 带到线上。
 *
 * 本地联调：后端默认跑在 3100（避免和本机其它 3000 服务冲突）。
 * 上线：https://sleep.qfmaster.com 由 1Panel 反代到容器 3000。
 */
const PROD_API = 'https://sleep.qfmaster.com'
const DEV_API = 'http://127.0.0.1:3100'

// 取不到环境信息时按正式版处理：宁可请求线上失败，也不要把 127.0.0.1 带到线上。
let envVersion = 'release'
try {
  if (typeof wx !== 'undefined' && wx.getAccountInfoSync) {
    const account = wx.getAccountInfoSync()
    envVersion = (account && account.miniProgram && account.miniProgram.envVersion) || 'release'
  }
} catch (e) {
  if (typeof console !== 'undefined' && console.warn) {
    console.warn('[env] getAccountInfoSync failed, fallback to release', e)
  }
}

// 仅开发版可覆盖：便于在模拟器里直接用线上配置联调（线上素材/解锁设置都在服务端），
// 体验版/正式版永远忽略这个键，避免把调试地址带到用户端。
let devOverride = ''
if (envVersion === 'develop') {
  try {
    const saved = wx.getStorageSync('sleep:dev-api')
    if (typeof saved === 'string') devOverride = saved.trim()
  } catch (e) {
    devOverride = ''
  }
}
const overrideValid = /^https:\/\/[^\s]+$/.test(devOverride)

module.exports = {
  apiBase: overrideValid ? devOverride : envVersion === 'develop' ? DEV_API : PROD_API,
  envVersion,
  // 供调试页/日志判断当前是否走了线上覆盖
  devOverride: overrideValid
}
