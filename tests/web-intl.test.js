const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const T = require('../miniprogram/utils/time')
const P = require('../miniprogram/utils/plan')

const ROOT = path.join(__dirname, '..')
const local = (y, m, d, hh, mm) => new Date(y, m - 1, d, hh || 0, mm || 0).getTime()

test('国际站: 记录时区决定归档日（默认 +480 行为不变）', () => {
  const ts = Date.UTC(2026, 9, 23, 1, 30)
  assert.equal(T.dayKeyOf(ts, 480), '2026-10-23')
  assert.equal(T.dayKeyOf(ts, 0), '2026-10-23')
  assert.equal(T.dayKeyOf(ts, -480), '2026-10-22')
  assert.equal(T.dayKeyOf(ts), '2026-10-23')
  // 未传时区时与历史口径完全一致
  assert.equal(T.calendarDayKey(ts), '2026-10-23')
})

test('国际站: UTC 边界仍按记录时区归属', () => {
  const ts = Date.UTC(2026, 9, 23, 6, 0) // 北京 14:00
  assert.equal(T.dayKeyOf(ts, -420), '2026-10-22')
  assert.equal(T.dayKeyOf(ts, 540), '2026-10-23')
})

test('国际站: core 纯函数不得依赖小程序 API', () => {
  ;['time', 'format', 'sessions', 'plan'].forEach((name) => {
    const src = fs.readFileSync(path.join(ROOT, 'miniprogram', 'utils', name + '.js'), 'utf8')
    assert.equal(/\bwx\./.test(src), false, name + ' 不应依赖 wx')
    assert.equal(/getApp\(/.test(src), false, name + ' 不应依赖 getApp')
    assert.equal(/Page\(|Component\(/.test(src), false, name + ' 不应依赖小程序构造器')
  })
})

test('国际站: 双向计算复用同一套 90 分钟周期', () => {
  const now = local(2026, 10, 23, 9, 0)
  const wake = P.bedtimesForWake(now, 7 * 60, 15, now)
  assert.equal(wake.slots.length, 3)
  assert.deepEqual(
    wake.slots.map((slot) => slot.cycles),
    [5, 4, 3]
  )
  assert.equal(wake.extra.cycles, 6)
  assert.equal(wake.slots[0].durationMin, 450)

  const sleep = P.wakeTimesForSleep(now, 22 * 60 + 30, 15)
  assert.equal(sleep.slots.length, 3)
  assert.equal(sleep.slots[0].durationMin, 450)
})

test('国际站: 内容页数量、字段与语言覆盖', () => {
  const site = JSON.parse(fs.readFileSync(path.join(ROOT, 'web', 'content', 'site.json'), 'utf8'))
  const { pages } = JSON.parse(fs.readFileSync(path.join(ROOT, 'web', 'content', 'pages.json'), 'utf8'))
  const i18n = JSON.parse(fs.readFileSync(path.join(ROOT, 'web', 'content', 'i18n.json'), 'utf8'))

  assert.ok(pages.length >= 10, '至少 10 个页面')
  const slugs = new Set()
  pages.forEach((page) => {
    ;['slug', 'locale', 'mode', 'title', 'description', 'h1', 'lead'].forEach((key) => {
      assert.ok(page[key], page.slug + ' 缺少 ' + key)
    })
    assert.equal(slugs.has(page.slug), false, '重复 slug: ' + page.slug)
    slugs.add(page.slug)
    assert.ok(page.title.length <= 80, page.slug + ' title 过长')
    assert.ok(page.description.length <= 175, page.slug + ' description 过长')
    assert.ok(i18n[page.locale], '缺少语言包: ' + page.locale)
    assert.ok(page.mode === 'wake' || page.mode === 'sleep', 'mode 非法')
  })

  site.locales.forEach((locale) => {
    assert.ok(
      pages.some((page) => page.locale === locale),
      '语言 ' + locale + ' 没有任何页面'
    )
  })
})
