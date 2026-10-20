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

module.exports = {
  apiBase: envVersion === 'develop' ? DEV_API : PROD_API,
  envVersion
}
