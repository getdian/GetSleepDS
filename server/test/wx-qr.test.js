const test = require('node:test')
const assert = require('node:assert/strict')

const { getAccessToken, getUnlimitedQrCode } = require('../src/services/wx')

const WX_OPTIONS = { appid: 'wx-test', secret: 'secret-test' }

function pngResponse() {
  return {
    ok: true,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'image/png' : null) },
    arrayBuffer: async () => new ArrayBuffer(8)
  }
}

function jsonResponse(body) {
  return {
    ok: true,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body
  }
}

test('getAccessToken：首次拉取并缓存，expires 内复用不再请求', async () => {
  let tokenCalls = 0
  const fetchImpl = async (url) => {
    if (url.indexOf('stable_token') >= 0) {
      tokenCalls += 1
      return jsonResponse({ access_token: 'token-' + tokenCalls, expires_in: 7200 })
    }
    throw new Error('unexpected')
  }
  const options = Object.assign({ fetchImpl }, WX_OPTIONS)

  const first = await getAccessToken(options)
  const second = await getAccessToken(options)
  assert.equal(first, 'token-1')
  assert.equal(second, 'token-1')
  assert.equal(tokenCalls, 1)
})

test('getUnlimitedQrCode：返回 PNG buffer，token 复用缓存', async () => {
  let qrCalls = 0
  const fetchImpl = async (url, init) => {
    if (url.indexOf('stable_token') >= 0) {
      return jsonResponse({ access_token: 'token-x', expires_in: 7200 })
    }
    if (url.indexOf('getwxacodeunlimit') >= 0) {
      qrCalls += 1
      assert.equal(init.method, 'POST')
      const body = JSON.parse(init.body)
      assert.equal(body.scene.length <= 32, true)
      assert.equal(body.page, 'pages/index/index')
      return pngResponse()
    }
    throw new Error('unexpected ' + url)
  }
  const options = Object.assign({ fetchImpl }, WX_OPTIONS)

  const buffer = await getUnlimitedQrCode(options, 'p', 'pages/index/index')
  assert.ok(Buffer.isBuffer(buffer))
  assert.equal(buffer.length, 8)
  assert.equal(qrCalls, 1)
})

test('getUnlimitedQrCode：微信返回 JSON 错误时抛业务错误（小程序未发布等）', async () => {
  const fetchImpl = async (url) => {
    if (url.indexOf('stable_token') >= 0) {
      return jsonResponse({ access_token: 'token-y', expires_in: 7200 })
    }
    if (url.indexOf('getwxacodeunlimit') >= 0) {
      return jsonResponse({ errcode: 41030, errmsg: 'invalid page' })
    }
    throw new Error('unexpected')
  }
  const options = Object.assign({ fetchImpl }, WX_OPTIONS)

  await assert.rejects(
    () => getUnlimitedQrCode(options, 'p', 'pages/index/index'),
    (error) => error.code === 'WX_QR_FAILED' && error.status === 502
  )
})

test('未配置 AppSecret 时明确拒绝', async () => {
  await assert.rejects(
    () => getAccessToken({ appid: '', secret: '' }),
    (error) => error.code === 'WX_NOT_CONFIGURED' && error.status === 503
  )
})
