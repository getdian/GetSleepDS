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

/**
 * 记录当前 tab（0 计算器 / 1 入睡 / 2 统计）到 globalData。
 * custom-tab-bar 每个页面各有一个实例，切换瞬间 getCurrentPages() 可能为空；
 * 新实例首帧靠这个值选对高亮项，否则会先闪一下 0=计算器。
 */
function setIndex(index) {
  const app = getApp()
  if (app && app.globalData && typeof index === 'number') app.globalData.tabIndex = index
}

/**
 * 唯一的切 tab 入口：先写意图、再让当前 tabBar 重绘、最后切页。
 *
 * 为什么不能各自 wx.switchTab：
 * 1) custom-tab-bar 每页一个实例，旧页的条不先重绘就切页，过渡帧仍是旧选中态；
 * 2) 快速连点时会排队多次 switchTab，旧页面 onShow 又回写 globalData，
 *    会把“最后一次点击”覆盖成中间页，出现两个 tab 同时像被选中。
 *
 * 用递增 ticket 只放行最后一次点击；过期的切页意图直接丢弃。
 */
let switchSeq = 0

function switchTo(index, path, onFail) {
  if (typeof index !== 'number' || !path) return false
  switchSeq += 1
  const ticket = switchSeq
  setIndex(index)
  let done = false
  const go = () => {
    if (done) return
    done = true
    // 期间又点了别的 tab：这次切页已过期，不再执行
    if (ticket !== switchSeq) return
    wx.switchTab({
      url: path,
      fail: typeof onFail === 'function' ? onFail : undefined
    })
  }
  const bar = current()
  if (bar && typeof bar.setData === 'function') bar.setData({ selected: index }, go)
  // 连点时旧页的条可能在回调前就被卸载，回调不保证到；定时器兜底，
  // 保证“最后一次点击”一定执行（正常路径 go 已执行，这里直接返回）
  setTimeout(go, 80)
  return true
}

module.exports = {
  hide() {
    setHidden(true)
  },
  show() {
    setHidden(false)
  },
  setIndex,
  switchTo
}
