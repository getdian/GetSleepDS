Component({
  properties: {
    title: {
      type: String,
      value: ''
    }
  },

  data: {
    statusBarHeight: 20,
    navHeight: 44,
    totalHeight: 64,
    capsuleGap: 16
  },

  lifetimes: {
    attached() {
      let statusBarHeight = 20
      let navHeight = 44
      let capsuleGap = 16

      try {
        const info = wx.getSystemInfoSync()
        statusBarHeight = info.statusBarHeight || 20
        const menu = wx.getMenuButtonBoundingClientRect
          ? wx.getMenuButtonBoundingClientRect()
          : null
        if (menu && menu.height && menu.top) {
          navHeight = (menu.top - statusBarHeight) * 2 + menu.height
          capsuleGap = Math.max(12, info.windowWidth - menu.left + 8)
        }
      } catch (e) {}

      this.setData({
        statusBarHeight,
        navHeight: Math.max(40, navHeight),
        totalHeight: statusBarHeight + Math.max(40, navHeight),
        capsuleGap
      })
    }
  }
})
