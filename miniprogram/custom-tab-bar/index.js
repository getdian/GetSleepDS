const tabbar = require('../utils/tabbar')

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
      const app = getApp()
      const pages = getCurrentPages()
      const current = pages.length ? pages[pages.length - 1].route : ''
      let index = this.data.list.findIndex((item) => item.pagePath === '/' + current)
      // 冷启动/切换瞬间 getCurrentPages() 可能为空或还是上一页（实测 attached 拿到空栈），
      // 只靠 route 会让新页面首帧固定显示 0=计算器，再被 onShow 改回目标页 → 闪一下。
      // 全局 tabIndex 由 onTap（切换前）和页面 onShow 写入，作为首帧的可靠兜底。
      if (index < 0 && app && app.globalData && typeof app.globalData.tabIndex === 'number') {
        index = app.globalData.tabIndex
      }
      if (index >= 0) this.setData({ selected: index })
    }
  },

  methods: {
    onTap(event) {
      const index = Number(event.currentTarget.dataset.index)
      const item = this.data.list[index]
      if (!item) return
      // “是不是当前 tab”同时看页面栈和最后一次点击意图：
      // 快速连点（A→B→A）时页面栈还停在 A，只看栈会把第二次点 A 误判成“点当前页”。
      const app = getApp()
      const intent = app && app.globalData ? app.globalData.tabIndex : null
      const pages = getCurrentPages()
      const top = pages.length ? pages[pages.length - 1].route : ''
      const onThisPage = !!top && '/' + top === item.pagePath
      if (onThisPage && (typeof intent !== 'number' || intent === index)) {
        // 点当前 tab：回到顶部作为“重新浏览”的明确反馈，不再静默无反应
        if (wx.pageScrollTo) wx.pageScrollTo({ scrollTop: 0, duration: 200 })
        return
      }
      // 统一入口：写意图 + 当前条先重绘 + 最后一次点击生效（见 utils/tabbar.switchTo）
      tabbar.switchTo(index, item.pagePath, () => {
        // 朋友圈单页模式等场景不支持 switchTab：必须让用户知道为什么没跳
        wx.showToast({ title: '请在微信中打开「睡点」', icon: 'none' })
      })
    }
  }
})
