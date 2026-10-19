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
    scrollTarget: ''
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
