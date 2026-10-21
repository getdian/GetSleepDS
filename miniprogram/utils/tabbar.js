/**
 * 自定义 tabBar 的显隐控制。
 * tabBar 是独立组件（层级 90，低于底部弹层 180/200），但与迷你播放条/抽屉同处底部，
 * 打开抽屉或背景选择器时主动隐藏，避免视觉上与操作层争抢空间。
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
