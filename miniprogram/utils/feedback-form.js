/**
 * 反馈表单的纯逻辑：类型表、清洗、校验。
 *
 * 为什么单独抽出来：页面只负责 setData 与请求，规则必须可被 node:test 直接断言；
 * 服务端 server/src/routes/feedback.js 有一份权威校验，两边的 TYPES 与长度上限
 * 必须同步修改（客户端只做即时报错，服务端才是最终判据）。
 */
const TYPES = [
  { key: 'SUGGEST', label: '功能建议' },
  { key: 'MUSIC', label: '想听的音乐' },
  { key: 'ISSUE', label: '问题反馈' }
]
const TYPE_KEYS = TYPES.map((item) => item.key)
const DEFAULT_TYPE = 'SUGGEST'
const MAX_CONTENT = 500
const MAX_CONTACT = 64

// 与 WXML textarea/input 的 maxlength 同口径：按 JS 字符串长度计数，
// 含 emoji 代理对时与微信的计数一致（都不拆开数）。
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

function cleanText(value) {
  if (typeof value !== 'string') return ''
  return value.replace(CONTROL_RE, '').trim()
}

function cleanContact(value) {
  return cleanText(value).replace(/[\r\n\t]+/g, ' ')
}

function isType(key) {
  return TYPE_KEYS.indexOf(key) >= 0
}

function typeOf(key) {
  const hit = TYPES.filter((item) => item.key === key)[0]
  return hit || null
}

/**
 * 校验并生成请求体。
 * 返回 { ok: true, payload } 或 { ok: false, error }（error 直接可展示）。
 */
function buildPayload(input) {
  const source = input || {}
  const type = isType(source.type) ? source.type : DEFAULT_TYPE
  const content = cleanText(source.content)
  if (!content) return { ok: false, error: '写点什么再提交吧' }
  if (content.length > MAX_CONTENT) {
    return { ok: false, error: '反馈最多 ' + MAX_CONTENT + ' 字' }
  }
  const contact = cleanContact(source.contact)
  if (contact.length > MAX_CONTACT) {
    return { ok: false, error: '联系方式最多 ' + MAX_CONTACT + ' 字' }
  }
  return { ok: true, payload: { type, content, contact } }
}

function counterText(content) {
  const text = typeof content === 'string' ? content : ''
  return text.length + '/' + MAX_CONTENT
}

function canSubmit(input) {
  return buildPayload(input).ok
}

module.exports = {
  TYPES,
  TYPE_KEYS,
  DEFAULT_TYPE,
  MAX_CONTENT,
  MAX_CONTACT,
  cleanText,
  cleanContact,
  isType,
  typeOf,
  buildPayload,
  counterText,
  canSubmit
}
