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

const { withLogin } = require('../miniprogram/utils/login')

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
