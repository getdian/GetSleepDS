/**
 * 激励视频广告生命周期。
 * 单例：全局只创建一个广告实例，onClose 必须复用，否则回调会叠加。
 */

let ad = null
let pending = null
let lastError = null

function init(unitId) {
  if (!unitId || ad) return false
  if (!wx.createRewardedVideoAd) return false

  try {
    ad = wx.createRewardedVideoAd({ adUnitId: unitId })
  } catch (e) {
    ad = null
    return false
  }

  ad.onLoad(() => {
    lastError = null
  })

  ad.onError((err) => {
    lastError = err
  })

  ad.onClose((res) => {
    const resolve = pending
    pending = null
    if (!resolve) return
    resolve(res && res.isEnded === true ? 'ended' : 'skipped')
  })

  return true
}

/**
 * 拉起广告。
 * resolve: ended / skipped / error / unavailable
 */
function show() {
  if (!ad) return Promise.resolve('unavailable')

  return new Promise((resolve) => {
    pending = resolve

    const settle = (result) => {
      const fn = pending
      pending = null
      if (fn) fn(result)
    }

    let task = null
    try {
      task = ad.show()
    } catch (e) {
      task = null
    }

    if (!task) {
      settle('error')
      return
    }

    if (task.catch) {
      task.catch(() => {
        ad.load()
          .then(() => ad.show())
          .catch(() => settle('error'))
      })
    }
  })
}

function isReady() {
  return !!ad
}

function getLastError() {
  return lastError
}

module.exports = {
  init,
  show,
  isReady,
  getLastError
}
