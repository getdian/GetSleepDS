/**
 * 连续多月打卡日历：横向滑动查看 3/6/12 个月。
 * 格子 48rpx（24px）是该视图的最小尺寸，日号仍可读；
 * 点击只上报 day，详情与补记由页面处理，避免组件持有业务状态。
 */
Component({
  properties: {
    months: {
      type: Array,
      value: []
    },
    selectedKey: {
      type: String,
      value: ''
    }
  },

  data: {
    weekLabels: ['一', '二', '三', '四', '五', '六', '日'],
    scrollTarget: ''
  },

  observers: {
    months: function (months) {
      const list = months || []
      if (!list.length) {
        this.setData({ scrollTarget: '' })
        return
      }
      // 默认滚到最新月份（最右）
      const target = 'cs-' + list[list.length - 1].key
      if (target === this._scrollTarget) return
      this._scrollTarget = target
      this.setData({ scrollTarget: '' }, () => {
        setTimeout(() => {
          if (this.data.months && this.data.months.length) {
            this.setData({ scrollTarget: target })
          }
        }, 30)
      })
    }
  },

  methods: {
    onTap(e) {
      const day = e.currentTarget.dataset.day
      if (!day) return
      this.triggerEvent('daytap', { day })
    }
  }
})
