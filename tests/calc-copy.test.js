/**
 * 计算器文案口径契约（2026-10-22 定稿）：
 * Hero 标题必须描述「你要选的那个时间」（与卡顶胶囊同侧），副标/主按钮描述算出的结果。
 * 历史问题：标题问「想几点入睡？」而胶囊让你「选择起床时间」，标题与输入反向配对，用户会把该选的时间读反。
 * 本测试直接读页面文件，改回反向配对会红。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const WXML = fs.readFileSync(path.join(ROOT, 'miniprogram', 'pages', 'index', 'index.wxml'), 'utf8')
const PAGE_JS = fs.readFileSync(path.join(ROOT, 'miniprogram', 'pages', 'index', 'index.js'), 'utf8')
const SITE = fs.readFileSync(path.join(ROOT, 'server', 'public', 'site', 'index.html'), 'utf8')

/** 取标记行及其后若干行（默认 3 行；多行块如 hero-echo 可传更多） */
function lineWith(source, marker, label, count) {
  const lines = source.split(/\r?\n/)
  const index = lines.findIndex((item) => item.indexOf(marker) >= 0)
  assert.ok(index >= 0, label + ' 未找到（' + marker + '）')
  return lines.slice(index, index + (count || 3)).join('\n')
}

test('Hero 标题跟输入：选起床时间→「想几点起？」，选入睡时间→「想几点睡？」', () => {
  const title = lineWith(WXML, 'class="hero-title"', 'hero-title')
  assert.ok(title.indexOf("mode === 'wake' ? '想几点起？' : '想几点睡？'") >= 0, title)

  const sub = lineWith(WXML, 'class="hero-sub"', 'hero-sub')
  assert.ok(sub.indexOf("'选一个起床时间，找到适合你的睡点。'") >= 0, sub)
  assert.ok(sub.indexOf("'选一个入睡时间，找到适合你的起床时间。'") >= 0, sub)
})

test('翻转后页头回显所选时间：问句只在正面出现，背面陈述输入', () => {
  const title = lineWith(WXML, 'class="hero-title"', 'hero-title')
  assert.ok(title.indexOf('wx:if="{{!flipped}}"') >= 0, 'hero-title 应只在未翻转时渲染：' + title)

  // 背面页头必须是「你选的那个时间」，不是结果；结果由卡内「推荐…时间」承担
  const echo = lineWith(WXML, 'class="hero-echo"', 'hero-echo', 5)
  assert.ok(echo.indexOf('{{view.echoPrefix}}') >= 0, '回显必须带今天/明天前缀：' + echo)
  assert.ok(echo.indexOf("mode === 'wake' ? wakeTime : sleepTime") >= 0, echo)
  assert.ok(echo.indexOf("mode === 'wake' ? '起床' : '入睡'") >= 0, echo)
})

test('胶囊 / 主按钮 / 结果面切换与 Hero 同一口径（输入→输出）', () => {
  const capsule = lineWith(WXML, 'class="mode-text"', 'mode-text')
  assert.ok(capsule.indexOf("mode === 'wake' ? '选择起床时间' : '选择入睡时间'") >= 0, capsule)

  const cta = lineWith(WXML, 'class="calc-action"', 'calc-action')
  assert.ok(cta.indexOf("mode === 'wake' ? '计算我的睡点' : '计算我的起床时间'") >= 0, cta)

  const swap = lineWith(WXML, 'class="result-switch"', 'result-switch')
  assert.ok(swap.indexOf("mode === 'wake' ? '换成我想几点睡' : '换成我想几点起'") >= 0, swap)

  const resetBtn = lineWith(WXML, 'class="result-reset"', 'result-reset')
  assert.ok(resetBtn.indexOf('‹ 返回') >= 0, resetBtn)
})

test('结果标签与算法方向一致：起床模式出睡点，入睡模式出起床时间', () => {
  lineWith(PAGE_JS, "label: main ? '推荐入睡时间' : '现在睡'", 'wake 结果标签')
  lineWith(PAGE_JS, "label: '推荐起床时间'", 'sleep 结果标签')
})

test('不再残留反向配对的旧文案与旧返回文案', () => {
  assert.equal(WXML.indexOf('想几点入睡？'), -1, 'index.wxml 仍有「想几点入睡？」')
  assert.equal(WXML.indexOf('选一个时间，找到适合你的睡点'), -1, 'index.wxml 仍有含糊副标')
  assert.equal(WXML.indexOf('换成我想几点醒'), -1, 'index.wxml 仍有「几点醒」')
  assert.equal(WXML.indexOf('重新选择'), -1, 'index.wxml 仍有「重新选择」')
})

test('入睡提示陈述选中时刻；结果头图标随模式（睡点月牙 / 起床太阳）', () => {
  const hint = lineWith(WXML, 'class="now-hint"', 'now-hint')
  assert.ok(hint.indexOf("mode === 'wake' ? wakeContext : sleepContext") >= 0, hint)
  assert.equal(WXML.indexOf('当前 {{nowText}}'), -1, '入睡模式不应再显示当前时间')

  const icon = lineWith(WXML, 'class="result-ico', 'result-ico')
  assert.ok(icon.indexOf("mode === 'wake' ? 'is-moon' : 'is-sun'") >= 0, icon)
})

test('90 分钟说明：入口可点、数字留有余量、带免责声明', () => {
  assert.ok(WXML.indexOf('bindtap="openWhy"') >= 0, '脚注必须可点')
  assert.ok(WXML.indexOf('为什么是 90 分钟？') >= 0, '入口文案缺失')
  // 事实口径：均值 + 个体区间，不写“正好 90 分钟”
  assert.ok(WXML.indexOf('70–120 分钟') >= 0, '必须给出个体区间')
  assert.ok(WXML.indexOf('平均约 90 分钟') >= 0)
  assert.equal(WXML.indexOf('正好是 90 分钟'), -1, '不要断言人人都正好 90 分钟')
  // 不得出现“第 6 个周期深睡期被叫醒”这类与睡眠结构不符的断言
  assert.equal(WXML.indexOf('第 6 个周期的“深睡期”'), -1)
  assert.ok(WXML.indexOf('不构成医疗建议') >= 0, '说明必须带免责')
})

test('落地页手机演示与应用计算器同口径', () => {
  assert.ok(SITE.indexOf('<strong>想几点起？</strong>') >= 0)
  assert.ok(SITE.indexOf('设定起床点，倒推你的入睡点') >= 0)
})

test('结果面 compact 也走 dense：712rpx 舞台不能把紧凑态排除在压缩之外', () => {
  const back = lineWith(WXML, 'calc-face calc-back', 'calc-back')
  assert.ok(back.indexOf("view.rows.length >= 3 ? 'is-dense'") >= 0, back)
  assert.equal(back.indexOf('!view.compact'), -1, 'compact 不能被排除在 dense 之外')
})
