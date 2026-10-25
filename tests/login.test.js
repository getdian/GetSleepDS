const test = require('node:test')
const assert = require('node:assert/strict')

let active = 0
let maxActive = 0
let seq = 0

global.wx = {
  login(options) {
    active += 1
    maxActive = Math.max(maxActive, active)
    seq += 1
    const code = 'code-' + seq
    setTimeout(() => {
      active -= 1
      options.success({ code })
    }, 5)
  }
}

const { withLogin, LOGIN_TIMEOUT_MS } = require('../miniprogram/utils/login')

test('withLogin 串行执行取 code + 业务请求，避免并发 code 失效', async () => {
  const seen = []
  const first = withLogin(
    (code) =>
      new Promise((resolve) => {
        seen.push(code)
        setTimeout(resolve, 15)
      })
  )
  const second = withLogin(
    (code) =>
      new Promise((resolve) => {
        seen.push(code)
        setTimeout(resolve, 5)
      })
  )

  await Promise.all([first, second])
  assert.equal(maxActive, 1)
  assert.deepEqual(seen, ['code-1', 'code-2'])
})

test('wx.login 不回调时按超时失败，不把整条身份队列挂死', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const originalLogin = global.wx.login
  // 模拟“既不 success 也不 fail”的坏基础库
  global.wx.login = () => {}
  try {
    const pending = withLogin(() => Promise.resolve('never'))
    const rejected = assert.rejects(pending, /登录超时/)
    // 让 queue.then → rawLogin 先跑完，setTimeout 才会注册进 mock 时钟
    await Promise.resolve()
    await Promise.resolve()
    t.mock.timers.tick(LOGIN_TIMEOUT_MS)
    await rejected
    // 恢复真实定时器：下面的 wx.login 依赖 setTimeout(5) 回调
    t.mock.timers.reset()

    // 队列已释放：下一次调用能正常拿到 code
    global.wx.login = originalLogin
    const code = await withLogin((value) => Promise.resolve(value))
    assert.ok(/^code-/.test(code))
  } finally {
    global.wx.login = originalLogin
  }
})
