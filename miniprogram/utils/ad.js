/**
 * 激励视频广告生命周期。
 * 单例：全局只创建一个广告实例，onClose 必须复用，否则回调会叠加。
 */

let ad = null
let pending = null
let pendingTimer = null
let lastError = null
let currentUnitId = ''

function clearPending(result) {
  if (pendingTimer) {
    clearTimeout(pendingTimer)
    pendingTimer = null
  }
  const fn = pending
  pending = null
  if (fn) fn(result)
}

function init(unitId) {
  if (!unitId) return false
  if (ad) return currentUnitId === unitId
  if (!wx.createRewardedVideoAd) return false

  try {
    ad = wx.createRewardedVideoAd({ adUnitId: unitId })
  } catch (e) {
    ad = null
    return false
  }
  currentUnitId = unitId

  ad.onLoad(() => {
    lastError = null
  })

  ad.onError((err) => {
    lastError = err
    // 广告播放中出错时微信可能只回调 onError，不回调 onClose；
    // 不结算会让 unlock-sheet 永远停在 loading。
    clearPending('error')
  })

  ad.onClose((res) => {
    clearPending(res && res.isEnded === true ? 'ended' : 'skipped')
  })

  return true
}

/**
 * 拉起广告。
 * resolve: ended / skipped / error / unavailable
 */
function show() {
  if (!ad) return Promise.resolve('unavailable')
  if (pending) return Promise.resolve('error')

  return new Promise((resolve) => {
    pending = resolve

    const settle = (result) => {
      clearPending(result)
    }

    // 部分基础库在弱网/素材异常时既不 onClose 也不 onError，必须有总超时
    pendingTimer = setTimeout(() => settle('error'), 45000)

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
