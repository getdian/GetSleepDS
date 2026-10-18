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

function testBucket(settings) {
  const client = createClient(settings)
  return new Promise((resolve, reject) => {
    client.getBucket(
      {
        Bucket: settings.bucket,
        Region: settings.region,
        MaxKeys: 1
      },
      (error, data) => {
        if (error) reject(error)
        else resolve(data)
      }
    )
  })
}

module.exports = { objectUrl, uploadBuffer, testBucket }
