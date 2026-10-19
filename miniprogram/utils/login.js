/**
 * 静默登录：只拿 code，不涉及任何用户信息授权，不会弹窗。
 *
 * wx.login 的 code 是一次性凭证，所以不能只“共享 Promise”让两个接口复用同一个 code；
 * 这里把“取 code + 调接口”整体串行，保证每个 code 只被一次业务请求使用。
 */
function rawLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success(res) {
        if (res && res.code) resolve(res.code)
        else reject(new Error('登录凭证获取失败'))
      },
      fail() {
        reject(new Error('登录失败'))
      }
    })
  })
}

let queue = Promise.resolve()

function withLogin(task) {
  const run = queue.then(
    () => rawLogin().then((code) => task(code)),
    () => rawLogin().then((code) => task(code))
  )
  // 无论成功失败都让队列继续，错误只抛给本次调用方
  queue = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

module.exports = { wxLogin: rawLogin, withLogin }
