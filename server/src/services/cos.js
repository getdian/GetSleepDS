const COS = require('cos-nodejs-sdk-v5')

function createClient(settings) {
  return new COS({
    SecretId: settings.secretId,
    SecretKey: settings.secretKey,
    Timeout: 60000
  })
}

function objectUrl(settings, key) {
  const domain = String(settings.domain || '').replace(/\/+$/, '')
  if (domain) return domain + '/' + key
  return 'https://' + settings.bucket + '.cos.' + settings.region + '.myqcloud.com/' + key
}

function uploadBuffer(settings, options) {
  const client = createClient(settings)
  return new Promise((resolve, reject) => {
    client.putObject(
      {
        Bucket: settings.bucket,
        Region: settings.region,
        Key: options.key,
        Body: options.buffer,
        ContentType: options.contentType || 'audio/mpeg'
      },
      (error, data) => {
        if (error) reject(error)
        else resolve(data)
      }
    )
  })
}

/**
 * 用一次最小 PutObject 验证连通性，而不是 getBucket。
 * 文档建议后台使用“仅该桶 PutObject”的子账号；List 权限并非上传必需。
 * 固定 key 会被覆盖，不会持续产生垃圾对象。
 */
function testBucket(settings) {
  const client = createClient(settings)
  const prefix = String(settings.prefix || 'sleep').replace(/^\/+|\/+$/g, '')
  const key = (prefix ? prefix + '/' : '') + '.connectivity-test'
  return new Promise((resolve, reject) => {
    client.putObject(
      {
        Bucket: settings.bucket,
        Region: settings.region,
        Key: key,
        Body: Buffer.from('getsleep-connectivity-test'),
        ContentType: 'text/plain'
      },
      (error, data) => {
        if (error) reject(error)
        else resolve(data)
      }
    )
  })
}

module.exports = { objectUrl, uploadBuffer, testBucket }
