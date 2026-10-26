Component({
  data: {
    selected: 0,
    hidden: false,
    list: [
      { pagePath: '/pages/index/index', text: '计算器', key: 'calc' },
      { pagePath: '/pages/sleep/sleep', text: '入睡', key: 'sleep' },
      { pagePath: '/pages/stats/stats', text: '统计', key: 'stats' }
    ]
  },

  lifetimes: {
    attached() {
      const pages = getCurrentPages()
      const current = pages.length ? pages[pages.length - 1].route : ''
      const index = this.data.list.findIndex((item) => item.pagePath === '/' + current)
      if (index >= 0) this.setData({ selected: index })
    }
  },

  methods: {
    onTap(event) {
      const index = Number(event.currentTarget.dataset.index)
      const item = this.data.list[index]
      if (!item) return
      // 点当前 tab：回到顶部作为“重新浏览”的明确反馈，不再静默无反应
      if (index === this.data.selected) {
        if (wx.pageScrollTo) wx.pageScrollTo({ scrollTop: 0, duration: 200 })
        return
      }
      wx.switchTab({
        url: item.pagePath,
        success: () => {
          this.setData({ selected: index })
        },
        fail: () => {
          // 朋友圈单页模式等场景不支持 switchTab：必须让用户知道为什么没跳
          wx.showToast({ title: '请在微信中打开「睡点」', icon: 'none' })
        }
      })
    }
  }
})
