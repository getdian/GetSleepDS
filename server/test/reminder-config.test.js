const test = require('node:test')
const assert = require('node:assert/strict')

const { reminderConfigOf, DEFAULT_PAGE } = require('../src/lib/reminder-config')

test('提醒配置归一化：缺省时补齐模板字段名（thing1/time2）', () => {
  const cfg = reminderConfigOf({ templateId: 'tmpl-1' })
  assert.equal(cfg.templateId, 'tmpl-1')
  assert.equal(cfg.thingKey, 'thing1')
  assert.equal(cfg.timeKey, 'time2')
  assert.equal(cfg.page, DEFAULT_PAGE)
  assert.equal(cfg.enabled, true)
})

test('提醒配置归一化：后台自定义的字段名必须原样带出（落库做快照）', () => {
  // 公共模板库的“睡觉到点提醒”是 time1 + thing2，不能被默认值覆盖
  const cfg = reminderConfigOf({ templateId: 'tmpl-2', thingKey: 'time1', timeKey: 'thing2' })
  assert.equal(cfg.thingKey, 'time1')
  assert.equal(cfg.timeKey, 'thing2')
})

test('提醒配置归一化：空配置与 env 兜底', () => {
  const empty = reminderConfigOf(null, { fallbackTemplateId: 'env-tmpl' })
  assert.equal(empty.enabled, true, '没有配置时不应禁用提醒')
  assert.equal(empty.templateId, 'env-tmpl')
  assert.equal(empty.thingKey, 'thing1')
  assert.equal(empty.timeKey, 'time2')

  const disabled = reminderConfigOf({ enabled: false, templateId: 't' })
  assert.equal(disabled.enabled, false)
})
