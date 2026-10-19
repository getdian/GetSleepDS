Component({
  properties: {
    cells: {
      type: Array,
      value: []
    },
    colCount: {
      type: Number,
      value: 0
    },
    months: {
      type: Array,
      value: []
    }
  },

  data: {
    scrollTarget: '',
    // 格子边长（rpx）：28 + 5 间距 = 33/列，18 列（近 4 个月）总宽 589rpx，
    // 在最窄机型上也能整幅进屏（rpx 随屏宽等比），右侧即“今天”焦点
    cellSize: 28,
    // 每列顶行是周一（stats.heatmapCells 的 lead 补位保证），标签自上而下 一→日
    weekLabels: ['一', '二', '三', '四', '五', '六', '日']
  },

  observers: {
    'cells, colCount': function () {
      // 先清空再指向最后一格，保证数据刷新后仍自动滚到“今天”一侧
      this.setData({ scrollTarget: '' }, () => {
        const next = wx.nextTick || ((fn) => setTimeout(fn, 0))
        next(() => {
          if (this.data.cells && this.data.cells.length) {
            this.setData({ scrollTarget: 'hm-last' })
          }
        })
      })
    }
  },

  methods: {
    onCellTap(e) {
      const index = Number(e.currentTarget.dataset.index)
      const cell = this.data.cells[index]
      if (!cell || cell.pad) return
      this.triggerEvent('celltap', { cell })
    }
  }
})
