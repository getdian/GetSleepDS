/**
 * 上传内容签名校验。
 *
 * 背景：上传接口原先只检查「MIME 或扩展名」，改个扩展名就能把任意内容送进 COS。
 * 这里锁定两件事：签名识别本身正确；伪装内容在进 COS 前被拒。
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')

const { detectAudioType, detectImageType, verifyContent } = require('../src/lib/file-signature')
const { createApp } = require('../src/app')
const { loadConfig } = require('../src/config')
const { createMemoryDb } = require('../src/db')

const PASSWORD = 'test-admin-pass'

function ascii(text) {
  return Buffer.from(text, 'ascii')
}

function mp3Buffer() {
  return Buffer.concat([ascii('ID3'), ascii('fake mp3 payload')])
}

function wavBuffer() {
  return Buffer.concat([ascii('RIFF'), ascii('____'), ascii('WAVE'), ascii('fake wav payload')])
}

function m4aBuffer() {
  return Buffer.concat([ascii('____'), ascii('ftypisom'), ascii('fake m4a payload')])
}

function oggBuffer() {
  return Buffer.concat([ascii('OggS'), ascii('fake ogg payload')])
}

function pngBuffer() {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ascii('fake png payload')
  ])
}

function jpegBuffer() {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), ascii('fake jpeg payload')])
}

function webpBuffer() {
  return Buffer.concat([ascii('RIFF'), ascii('____'), ascii('WEBP'), ascii('fake webp payload')])
}

test('音频签名：mp3 / wav / ogg / m4a 可识别', () => {
  assert.equal(detectAudioType(mp3Buffer()), 'mp3')
  assert.equal(detectAudioType(wavBuffer()), 'wav')
  assert.equal(detectAudioType(oggBuffer()), 'ogg')
  assert.equal(detectAudioType(m4aBuffer()), 'm4a')
})

test('音频签名：纯文本不被当成音频', () => {
  assert.equal(detectAudioType(Buffer.from('这是一段普通文本，不是音频文件', 'utf8')), null)
  assert.equal(detectAudioType(Buffer.from('short')), null)
})

test('图片签名：png / jpg / webp 可识别，文本不识别', () => {
  assert.equal(detectImageType(pngBuffer()), 'png')
  assert.equal(detectImageType(jpegBuffer()), 'jpg')
  assert.equal(detectImageType(webpBuffer()), 'webp')
  assert.equal(detectImageType(Buffer.from('not an image at all!', 'utf8')), null)
})

test('verifyContent：不在白名单内的真实类型被拒', () => {
  const checked = verifyContent(mp3Buffer(), 'mp3', ['jpg', 'png'])
  assert.equal(checked.ok, false)
  assert.match(checked.reason, /实际内容是 mp3/)

  const ok = verifyContent(mp3Buffer(), 'mp3', ['mp3'])
  assert.equal(ok.ok, true)
})

async function withServer(run) {
  const config = loadConfig({
    NODE_ENV: 'test',
    ALLOW_DEV_LOGIN: '1',
    DB_MODE: 'memory',
    ADMIN_PASSWORD: PASSWORD
  })
  const app = createApp({
    config,
    db: createMemoryDb(),
    logger: { log() {}, error() {} }
  })
  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const base = 'http://127.0.0.1:' + server.address().port
  try {
    const login = await fetch(base + '/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD })
    })
    const raw = login.headers.getSetCookie ? login.headers.getSetCookie() : []
    const cookie = (raw[0] || login.headers.get('set-cookie') || '').split(';')[0]
    await run(base, cookie)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test('伪装成 mp3 的文本文件在进 COS 前被拒', async () => {
  await withServer(async (base, cookie) => {
    const form = new FormData()
    form.append(
      'file',
      new Blob([Buffer.from('这不是音频，只是一段文本', 'utf8')], { type: 'audio/mpeg' }),
      'fake.mp3'
    )
    const res = await fetch(base + '/api/admin/audio/upload', {
      method: 'POST',
      headers: { cookie },
      body: form
    })
    assert.equal(res.status, 400)
    const body = await res.json()
    assert.equal(body.error.code, 'INVALID_FILE_CONTENT')
  })
})

test('伪装成 png 的文本图片被拒', async () => {
  await withServer(async (base, cookie) => {
    const form = new FormData()
    form.append(
      'file',
      new Blob([Buffer.from('这不是图片', 'utf8')], { type: 'image/png' }),
      'fake.png'
    )
    const res = await fetch(base + '/api/admin/backgrounds/upload', {
      method: 'POST',
      headers: { cookie },
      body: form
    })
    assert.equal(res.status, 400)
    const body = await res.json()
    assert.equal(body.error.code, 'INVALID_FILE_CONTENT')
  })
})
