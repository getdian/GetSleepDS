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

  methods: {
    onCellTap(e) {
      const index = Number(e.currentTarget.dataset.index)
      const cell = this.data.cells[index]
      if (!cell || cell.pad) return
      this.triggerEvent('celltap', { cell })
    }
  }
})
