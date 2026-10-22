const test = require('node:test')
const assert = require('node:assert/strict')

const { keyFromOwnUrl, orphanKeys } = require('../src/lib/cos-keys')

const SETTINGS = {
  bucket: 'sleep-1250000000',
  region: 'ap-shanghai',
  domain: 'https://cdn.example.com',
  prefix: 'sleep'
}

test('只识别自家域名/桶地址下的 backgrounds 与 site 目录', () => {
  assert.equal(
    keyFromOwnUrl(SETTINGS, 'https://cdn.example.com/sleep/site/mp-qr-1.png'),
    'sleep/site/mp-qr-1.png'
  )
  assert.equal(
    keyFromOwnUrl(
      SETTINGS,
      'https://sleep-1250000000.cos.ap-shanghai.myqcloud.com/sleep/backgrounds/bg-1.webp'
    ),
    'sleep/backgrounds/bg-1.webp'
  )
  // 图片处理参数不影响 Key 反推
  assert.equal(
    keyFromOwnUrl(SETTINGS, 'https://cdn.example.com/sleep/site/mp-qr-1.png?imageMogr2/thumbnail/400x'),
    'sleep/site/mp-qr-1.png'
  )

  // 外链、音频（可能共用/历史地址）、越界目录一律不动
  assert.equal(keyFromOwnUrl(SETTINGS, 'https://other.example.com/sleep/site/a.png'), '')
  assert.equal(keyFromOwnUrl(SETTINGS, 'https://cdn.example.com/sleep/sleep-10001.mp3'), '')
  assert.equal(keyFromOwnUrl(SETTINGS, 'https://cdn.example.com/other/site/a.png'), '')
})

test('orphanKeys 只返回被替换且属于自家目录的旧对象', () => {
  const prev = {
    site: { mpQrCodeUrl: 'https://cdn.example.com/sleep/site/old.png' },
    backgrounds: [
      { url: 'https://cdn.example.com/sleep/backgrounds/a.webp' },
      { url: 'https://cdn.example.com/sleep/backgrounds/b.webp' },
      { url: 'https://img.qfmaster.com/sleep/backgrounds/legacy.jpg' }
    ]
  }
  const next = {
    site: { mpQrCodeUrl: 'https://cdn.example.com/sleep/site/new.png' },
    backgrounds: [
      { url: 'https://cdn.example.com/sleep/backgrounds/b.webp' },
      { url: 'https://img.qfmaster.com/sleep/backgrounds/legacy.jpg' }
    ]
  }

  assert.deepEqual(orphanKeys(SETTINGS, prev, next), [
    'sleep/site/old.png',
    'sleep/backgrounds/a.webp'
  ])

  // 只改顺序、不换图时不产生删除
  assert.deepEqual(orphanKeys(SETTINGS, prev, prev), [])

  // 同一张图被多行引用时只删一次
  const shared = {
    backgrounds: [
      { url: 'https://cdn.example.com/sleep/backgrounds/same.webp' },
      { url: 'https://cdn.example.com/sleep/backgrounds/same.webp' }
    ]
  }
  assert.deepEqual(orphanKeys(SETTINGS, shared, { backgrounds: [] }), [
    'sleep/backgrounds/same.webp'
  ])
})
