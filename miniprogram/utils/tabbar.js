/**
 * tabBar 的显隐与切换控制。
 * 支持微信原生 tabBar（通过 wx.hideTabBar/wx.showTabBar），
 * 同时兼容如果存在自定义 tabBar 实例时的 setData 调用。
 */
function current() {
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
  const page = pages.length ? pages[pages.length - 1] : null
  if (!page || typeof page.getTabBar !== 'function') return null
  return page.getTabBar()
}

function setHidden(hidden) {
  const bar = current()
  if (bar && typeof bar.setData === 'function') bar.setData({ hidden: !!hidden })
}

/**
 * 记录当前 tab（0 计算器 / 1 入睡 / 2 统计）到 globalData。
 */
function setIndex(index) {
  if (typeof getApp !== 'function') return
  const app = getApp()
  if (app && app.globalData && typeof index === 'number') app.globalData.tabIndex = index
}

/**
 * 统一的切 tab 入口：调用微信原生 wx.switchTab
 */
function switchTo(index, path, onFail) {
  if (!path) return false
  if (typeof index === 'number') setIndex(index)
  if (typeof wx !== 'undefined' && typeof wx.switchTab === 'function') {
    wx.switchTab({
      url: path,
      fail: typeof onFail === 'function' ? onFail : undefined
    })
    return true
  }
  return false
}

module.exports = {
  hide(opts) {
    if (typeof wx !== 'undefined' && typeof wx.hideTabBar === 'function') {
      try {
        wx.hideTabBar(Object.assign({ animation: false }, opts))
      } catch (e) {}
    }
    setHidden(true)
  },
  show(opts) {
    if (typeof wx !== 'undefined' && typeof wx.showTabBar === 'function') {
      try {
        wx.showTabBar(Object.assign({ animation: false }, opts))
      } catch (e) {}
    }
    setHidden(false)
  },
  setIndex,
  switchTo
}
