function measure() {
  let statusBarHeight = 20
  let navHeight = 44
  let capsuleGap = 16
  try {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    statusBarHeight = info.statusBarHeight || 20
    const menu = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null
    if (menu && menu.height && menu.top) {
      navHeight = (menu.top - statusBarHeight) * 2 + menu.height
      capsuleGap = Math.max(12, info.windowWidth - menu.left + 8)
    }
  } catch (e) {}
  const height = Math.max(40, navHeight)
  return {
    statusBarHeight,
    navHeight: height,
    totalHeight: statusBarHeight + height,
    capsuleGap
  }
}

// 在首次渲染前算好，避免先按 64px 渲染再在 attached 跳 20+px
const INITIAL_METRICS = measure()

Component({
  properties: {
    title: {
      type: String,
      value: ''
    },
    // 首页使用：只显示「睡点」品牌，右侧留给微信原生胶囊
    brandOnly: {
      type: Boolean,
      value: false
    },
    // 右侧页面级动作文案（如「换背景」）；为空时不渲染，其他页面不受影响
    actionText: {
      type: String,
      value: ''
    }
  },

  methods: {
    onActionTap() {
      this.triggerEvent('action')
    }
  },

  data: Object.assign({}, INITIAL_METRICS),

  lifetimes: {
    attached() {
      // 首帧已用测量值；这里只做一次幂等复核（例如开发者工具切换设备）
      this.setData(measure())
    }
  }
})
