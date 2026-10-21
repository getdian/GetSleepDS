/**
 * 自定义 tabBar 的显隐控制。
 * 自定义 tabBar 是独立组件，普通页面遮罩压不住它；打开抽屉/背景选择器时需要主动隐藏。
 */
function current() {
  const pages = getCurrentPages()
  const page = pages.length ? pages[pages.length - 1] : null
  if (!page || typeof page.getTabBar !== 'function') return null
  return page.getTabBar()
}

function setHidden(hidden) {
  const bar = current()
  if (bar && typeof bar.setData === 'function') bar.setData({ hidden: !!hidden })
}

module.exports = {
  hide() {
    setHidden(true)
  },
  show() {
    setHidden(false)
  }
}
