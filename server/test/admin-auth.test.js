const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')

const { createAdminAuth, makeCredential } = require('../src/services/admin-auth')

/** 用指定密钥伪造一枚 v2 令牌（模拟“知道旧密码的攻击者”） */
function forge(secret, version, exp) {
  const payload = 'v2.' + version + '.' + exp
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return payload + '.' + sig
}

test('未配置独立 ADMIN_SECRET 时，改密后旧密码不能再伪造管理员令牌', () => {
  // 生产典型现状：只配了 ADMIN_PASSWORD，签名密钥就是它
  const auth = createAdminAuth({ password: 'old-password-123' })
  const exp = Date.now() + 60 * 1000

  // 改密前：旧密码伪造的令牌确实能过（这是修复前的问题面）
  assert.equal(auth.verify(forge('old-password-123', 0, exp)), true)

  // 改密：凭据落库、version +1
  auth.setCredentials(makeCredential('new-password-456', 2, Date.now()))

  // 旧密码 + 新版本号（攻击者可以枚举 1..N）必须全部失败
  assert.equal(auth.verify(forge('old-password-123', 2, exp)), false)
  assert.equal(auth.verify(forge('old-password-123', 1, exp)), false)

  // 新密码签发的令牌仍然可用
  assert.equal(auth.verify(auth.issue()), true)
})

test('改密后，改密前签发的令牌一律失效', () => {
  const auth = createAdminAuth({ password: 'old-password-123' })
  const before = auth.issue()
  assert.equal(auth.verify(before), true)

  auth.setCredentials(makeCredential('new-password-456', 2, Date.now()))
  assert.equal(auth.verify(before), false)
})

test('配置了独立 ADMIN_SECRET 时，旧密码本来就不是签名密钥', () => {
  const auth = createAdminAuth({ password: 'old-password-123', secret: 'independent-secret' })
  const exp = Date.now() + 60 * 1000
  assert.equal(auth.verify(forge('old-password-123', 0, exp)), false)

  auth.setCredentials(makeCredential('new-password-456', 2, Date.now()))
  assert.equal(auth.verify(forge('independent-secret', 2, exp)), false, '凭据派生后根密钥也不能直接签')
  assert.equal(auth.verify(auth.issue()), true)
})
