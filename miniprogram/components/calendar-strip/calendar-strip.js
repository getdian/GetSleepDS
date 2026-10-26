/**
 * 连续多月打卡日历：横向滑动查看 3/6/12 个月。
 * 格子 48rpx（24px）是该视图的最小尺寸，日号仍可读；
 * 点击只上报 day，详情与补记由页面处理，避免组件持有业务状态。
 *
 * 渲染懒加载：1 年视图一次渲染 12 个月 × ~35 格 ≈ 420 个节点，
 * 首次 setData 明显卡顿。初始只渲染最近 6 个月，滑到最左再渲染全部，
 * 并把视口钉回「追加前最旧的月份」，避免跳位。
 */
const INITIAL_VISIBLE = 6

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
    scrollTarget: '',
    visibleMonths: []
  },

  observers: {
    months: function (months) {
      const list = months || []
      if (!list.length) {
        this._monthsSig = ''
        this._visibleCount = 0
        this.setData({ visibleMonths: [], scrollTarget: '' })
        return
      }
      const signature =
        list.length + '|' + list[0].key + '|' + list[list.length - 1].key
      const rangeChanged = signature !== this._monthsSig
      if (rangeChanged) {
        // 切周期/月份范围变化：重置懒加载窗口（默认渲染最近 6 个月）
        this._monthsSig = signature
        this._visibleCount = Math.min(INITIAL_VISIBLE, list.length)
      }
      const visible = list.slice(
        Math.max(0, list.length - (this._visibleCount || list.length))
      )
      if (!rangeChanged) {
        // 同月份数据更新（打卡/补记）：只刷新可见格子，不重置滚动位置
        this.setData({ visibleMonths: visible })
        return
      }
      // 默认滚到最新月份（最右）；去重键必须含周期与月份范围：
      // 3→12 个月切换时最后一个月不变，只看 target 会提前 return，
      // scroll-view 保留旧 scrollLeft（停在最旧月份）。
      const target = 'cs-' + list[list.length - 1].key
      this.setData({ visibleMonths: visible, scrollTarget: '' }, () => {
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
    },

    /** 滑到最左：渲染剩余月份，并把视口钉回追加前最旧的可见月份 */
    onLoadEarlier() {
      const list = this.data.months || []
      if (!list.length) return
      if ((this._visibleCount || 0) >= list.length) return
      const firstVisible = this.data.visibleMonths[0]
      this._visibleCount = list.length
      this.setData({
        visibleMonths: list,
        scrollTarget: firstVisible ? 'cs-' + firstVisible.key : ''
      })
    }
  }
})
