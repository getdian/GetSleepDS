/**
 * 静默登录：只拿 code，不涉及任何用户信息授权，不会弹窗。
 *
 * wx.login 的 code 是一次性凭证，所以不能只“共享 Promise”让两个接口复用同一个 code；
 * 这里把“取 code + 调接口”整体串行，保证每个 code 只被一次业务请求使用。
 *
 * 超时：wx.login 在极少数机型/网络下会既不 success 也不 fail，
 * 而所有身份请求都排在同一条队列上——不设上限会让同步、提醒、事件全部挂住。
 */
const LOGIN_TIMEOUT_MS = 10000

function rawLogin() {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('登录超时，请检查网络'))
    }, LOGIN_TIMEOUT_MS)
    const done = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn(value)
    }
    try {
      wx.login({
        success(res) {
          if (res && res.code) done(resolve, res.code)
          else done(reject, new Error('登录凭证获取失败'))
        },
        fail() {
          done(reject, new Error('登录失败'))
        }
      })
    } catch (e) {
      // 基础库异常/API 缺失时同步抛错：必须走 done 清掉超时定时器
      done(reject, new Error('登录失败'))
    }
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

module.exports = { wxLogin: rawLogin, withLogin, LOGIN_TIMEOUT_MS }
