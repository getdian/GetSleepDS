const crypto = require('crypto')

const VERSION = 'v1'

/**
 * 用服务端密钥对 COS SecretKey 做 AES-256-GCM 加密后再入库。
 * 密钥来自 CONFIG_SECRET，未配置时退化为 ADMIN_SECRET / ADMIN_PASSWORD；
 * 如果后台密码本身是启动期随机生成的，securityReady 为 false，拒绝保存。
 */
function createSecretBox(secret) {
  const enabled = !!secret
  const key = enabled ? crypto.createHash('sha256').update(String(secret)).digest() : null

  function encrypt(plain) {
    if (!enabled) throw new Error('加密密钥未配置')
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return [VERSION, iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join('.')
  }

  function decrypt(payload) {
    if (!enabled || typeof payload !== 'string') return ''
    const parts = payload.split('.')
    if (parts.length !== 4 || parts[0] !== VERSION) return ''
    try {
      const iv = Buffer.from(parts[1], 'base64')
      const tag = Buffer.from(parts[2], 'base64')
      const data = Buffer.from(parts[3], 'base64')
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
    } catch (e) {
      return ''
    }
  }

  return { enabled, encrypt, decrypt }
}

module.exports = { createSecretBox }
