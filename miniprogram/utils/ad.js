/**
 * 激励视频广告生命周期。
 * 单例：全局只创建一个广告实例，onClose 必须复用，否则回调会叠加。
 * 广告位 ID 变更时必须解绑旧实例并重建，否则后台改了 ID 仍会一直播旧广告。
 */

let ad = null
let pending = null
let pendingTimer = null
let lastError = null
let currentUnitId = ''
let handlers = null

function clearPending(result) {
  if (pendingTimer) {
    clearTimeout(pendingTimer)
    pendingTimer = null
  }
  const fn = pending
  pending = null
  if (fn) fn(result)
}

function detach() {
  if (!ad) return
  if (handlers) {
    const pairs = [
      ['offLoad', handlers.load],
      ['offError', handlers.error],
      ['offClose', handlers.close]
    ]
    pairs.forEach((pair) => {
      if (typeof ad[pair[0]] !== 'function') return
      try {
        ad[pair[0]](pair[1])
      } catch (e) {}
    })
  }
  if (typeof ad.destroy === 'function') {
    try {
      ad.destroy()
    } catch (e) {}
  }
  ad = null
  handlers = null
  currentUnitId = ''
}

function init(unitId) {
  if (!unitId) return false
  if (ad && currentUnitId === unitId) return true
  if (ad) {
    clearPending('error')
    detach()
  }
  if (!wx.createRewardedVideoAd) return false

  try {
    ad = wx.createRewardedVideoAd({ adUnitId: unitId })
  } catch (e) {
    ad = null
    return false
  }
  if (!ad) return false
  currentUnitId = unitId
  lastError = null

  handlers = {
    load: () => {
      lastError = null
    },
    error: (err) => {
      lastError = err
      // 广告播放中出错时微信可能只回调 onError，不回调 onClose；
      // 不结算会让 unlock-sheet 永远停在 loading。
      clearPending('error')
    },
    close: (res) => {
      clearPending(res && res.isEnded === true ? 'ended' : 'skipped')
    }
  }
  ad.onLoad(handlers.load)
  ad.onError(handlers.error)
  ad.onClose(handlers.close)

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

    // 部分基础库在弱网/素材异常时既不 onClose 也不 onError，必须有总超时。
    // 60 秒激励视频很常见，超时不能短于广告时长；90 秒仍可兜底。
    pendingTimer = setTimeout(() => settle('error'), 90000)

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
