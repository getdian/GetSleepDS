/**
 * 进程内固定窗口限流。单实例部署足够；多实例需换 Redis。
 */
function createRateLimiter(windowMs, max, maxKeys) {
  const buckets = new Map()
  const limitKeys = maxKeys || 5000
  let lastSweep = Date.now()

  return function allow(key, now) {
    const current = now || Date.now()

    if (buckets.size > limitKeys && current - lastSweep > windowMs) {
      lastSweep = current
      buckets.forEach((bucket, bucketKey) => {
        if (current >= bucket.resetAt) buckets.delete(bucketKey)
      })
    }

    const bucket = buckets.get(key)
    if (!bucket || current >= bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: current + windowMs })
      return true
    }

    bucket.count += 1
    return bucket.count <= max
  }
}

module.exports = { createRateLimiter }
