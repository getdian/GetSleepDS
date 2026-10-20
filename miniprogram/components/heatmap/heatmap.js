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
    // 格子边长（rpx）：26 + 4 间距 = 30/列。固定 20 整周 = 20 列，
    // 总宽 20*26 + 19*4 = 596rpx，恰好补满卡片内可视宽（750 屏宽 - 页面 64 - 卡内 48 - 星期列 36 = 602rpx）
    cellSize: 26,
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
            // 对齐到“今天”，而不是未来板位的最后一格
            this.setData({ scrollTarget: 'hm-today' })
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
