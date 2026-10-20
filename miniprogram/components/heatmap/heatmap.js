// 图板可用宽度（rpx）：750 屏宽 - 页面左右 64 - 卡内左右 48 - 星期列 36
const DEFAULT_AVAILABLE = 602
const CELL_GAP = 4
const MIN_CELL = 22
const MAX_CELL = 30

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
    },
    availableWidth: {
      type: Number,
      value: DEFAULT_AVAILABLE
    }
  },

  data: {
    scrollTarget: '',
    // 由列数反推：保证 N 列恰好铺满可用宽度（月数固定 4 个月时列数会在 17~21 之间浮动）
    cellSize: 26,
    // 每列顶行是周一（stats.heatmapCells 的 lead 补位保证）。
    // 只标注一/三/五/日，二/四/六 留空占位，保证 7 行仍与格子严格对齐
    weekLabels: [
      { key: 'mon', label: '一' },
      { key: 'tue', label: '' },
      { key: 'wed', label: '三' },
      { key: 'thu', label: '' },
      { key: 'fri', label: '五' },
      { key: 'sat', label: '' },
      { key: 'sun', label: '日' }
    ]
  },

  observers: {
    'colCount, availableWidth': function (colCount, availableWidth) {
      const count = Number(colCount) || 0
      if (!count) return
      const width = Number(availableWidth) || DEFAULT_AVAILABLE
      // 向下取整：宁可少 1~2rpx，也不要溢出触发横向滚动
      const size = Math.max(MIN_CELL, Math.min(MAX_CELL, Math.floor((width - (count - 1) * CELL_GAP) / count)))
      if (size !== this.data.cellSize) this.setData({ cellSize: size })
    },

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
