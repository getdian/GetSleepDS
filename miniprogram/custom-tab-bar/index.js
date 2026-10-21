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
      if (!item || index === this.data.selected) return
      wx.switchTab({
        url: item.pagePath,
        success: () => {
          this.setData({ selected: index })
        }
      })
    }
  }
})
