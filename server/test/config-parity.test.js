/**
 * 配置单源的第一步：让“一侧加了字段、另一侧没加”立刻红灯。
 *
 * 背景（2026-10-28 架构 review）：新增一个配置标量要改 7 个文件 11 处
 * （AGENTS.md 记的“五处同改”还漏了 admin/index.html 与 src/config/index.js），
 * `web` 段就是这么漏的——后台能存、validateConfig 会返回，但 normalizeConfig
 * 不返回它，于是每次读路径都丢掉，30s 缓存过期后面板里的值就没了。
 *
 * 在把默认值改成“一处生成”之前（那是下一步），先用结构断言把漂移变成可发现的：
 * 只比键集合与少数标量，不锁文案，避免测试变成第二份手写配置。
 *
 * 刻意不比较的：
 * - `version`：只由 normalizeConfig 产出，validateConfig 之后由 config-store.save 补，
 *   属于已知且合理的差异（下面单独断言“只差这一个”）。
 * - `audio` / `backgrounds` / `site` / `copy` 的具体值：运营在后台改，测试只锁结构。
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const { normalizeConfig, validateConfig } = require('../src/lib/config-schema')
const fileConfig = require('../config/app.config.json')
const clientFallback = require('../../miniprogram/config/fallback')

const normalized = normalizeConfig({})

function keysOf(value) {
  return Object.keys(value || {}).sort()
}

/** 断言 from 的每个键都能在 to 里找到；缺一个就报“哪一侧漏了” */
function assertNoMissing(from, to, label) {
  const lack = keysOf(from).filter((key) => !Object.prototype.hasOwnProperty.call(to || {}, key))
  assert.deepEqual(lack, [], label + ' 缺字段：' + lack.join(', '))
}

/**
 * 反向断言：to 里的每个键都能在 from 里找到（豁免清单除外）。
 * 原先只有正向断言（客户端 ⊆ 服务端），方向写反了：
 * 服务端新增字段而客户端没加时，测试照样通过 —— 「只写不读」就是这么漏出去的。
 */
function assertCovers(from, to, label, exempt) {
  const skip = exempt || []
  const lack = keysOf(to).filter(
    (key) => !Object.prototype.hasOwnProperty.call(from || {}, key) && skip.indexOf(key) < 0
  )
  assert.deepEqual(lack, [], label + ' 缺字段：' + lack.join(', '))
}

/**
 * 明确豁免：这些配置只服务后台/国际站落地页，小程序运行时不需要。
 * 写进清单而不是让它悄悄不一致 —— 以后要下发到小程序时从清单里删掉即可。
 */
const CLIENT_EXEMPT_KEYS = ['site']

test('文件配置的每个顶层键都必须出现在 normalizeConfig 输出里', () => {
  // web 段曾在这里失败：app.config.json 有 web，normalizeConfig 不返回 → 只写不读
  assertNoMissing(fileConfig, normalized, 'normalizeConfig')
})

test('客户端 fallback 的键不得落后于服务端归一化结果', () => {
  // 反向：服务端有、客户端没有 = 客户端会漏读这个字段（豁免清单除外）
  assertCovers(clientFallback, normalized, 'miniprogram/config/fallback.js', CLIENT_EXEMPT_KEYS)
  // 正向：客户端不得出现服务端不认识的字段（否则是写错的死字段）
  assertNoMissing(clientFallback, normalized, 'miniprogram/config/fallback.js')
})

test('功能开关 / 缓存 / 提醒三处键集合一致，同名字段默认值一致', () => {
  assert.deepEqual(keysOf(clientFallback.features), keysOf(normalized.features))
  assert.deepEqual(keysOf(clientFallback.cache), keysOf(normalized.cache))
  assert.deepEqual(keysOf(clientFallback.reminder), keysOf(normalized.reminder))

  assert.equal(clientFallback.cache.maxMB, normalized.cache.maxMB)
  assert.equal(clientFallback.cache.ttlDays, normalized.cache.ttlDays)
  // 提醒字段名曾因为“路由层少返回一次”在库里落成空串，线上 47003
  assert.equal(clientFallback.reminder.thingKey, normalized.reminder.thingKey)
  assert.equal(clientFallback.reminder.timeKey, normalized.reminder.timeKey)
  assert.equal(clientFallback.reminder.page, normalized.reminder.page)
})

test('广告槽位：客户端与服务端的槽名、槽内键一致', () => {
  const slots = keysOf(normalized.ads)
  assert.ok(slots.length > 0, 'normalizeConfig 没有输出广告槽')
  assert.deepEqual(keysOf(clientFallback.ads), slots)
  slots.forEach((slot) => {
    assert.deepEqual(keysOf(clientFallback.ads[slot]), keysOf(normalized.ads[slot]), '槽 ' + slot + ' 键不一致')
  })
})

test('保存路径与读取路径的顶层键只允许差一个 version', () => {
  // 用 app.config.json 当“后台提交的全量配置”替身：normalizeConfig({}) 的 audio 为空，
  // validateConfig 会以“至少保留 1 条环境音”拒绝，那是另一条规则，不该混进结构断言。
  const validated = validateConfig(fileConfig, normalized)
  const withVersion = keysOf(normalized)
  const withoutVersion = keysOf(validated)
  // version 由 config-store.save 在 validateConfig 之后补，不在这两个函数里
  assert.deepEqual(
    withVersion.filter((key) => key !== 'version'),
    withoutVersion,
    'validateConfig 与 normalizeConfig 的键集合出现新漂移'
  )
})

test('比较器自己能抓到漂移（避免测试永远为真）', () => {
  const drifted = Object.assign({}, normalized)
  delete drifted.web
  assert.throws(() => assertNoMissing(fileConfig, drifted, 'normalizeConfig'), /缺字段/)
  assert.throws(() => assertNoMissing(clientFallback, drifted, 'fallback'), /缺字段/)

  // 反向比较器也要能抓到「服务端新增字段、客户端没跟」
  const missingOnClient = Object.assign({}, normalized)
  missingOnClient.newFeature = { on: true }
  assert.throws(
    () => assertCovers(clientFallback, missingOnClient, 'fallback', CLIENT_EXEMPT_KEYS),
    /缺字段/
  )
})
