/**
 * 打卡日历：7 列（周一起）+ 当月天数，格内直接显示日号与时长。
 * 格子 88rpx 见方，点击目标远大于原来的 24rpx 热力图格；
 * 选中态由组件内部维护，点击后把 cell 抛给页面渲染详情。
 */
const F = require('../../utils/format')

Component({
  properties: {
    cells: {
      type: Array,
      value: []
    },
    title: {
      type: String,
      value: ''
    },
    canNext: {
      type: Boolean,
      value: false
    },
    // 受控选中态：页面在数据/月份变化时置空，避免“详情消失、描边还在”
    selectedKey: {
      type: String,
      value: ''
    }
  },

  data: {
    weekLabels: ['一', '二', '三', '四', '五', '六', '日'],
    rows: []
  },

  observers: {
    cells: function (cells) {
      const rows = (cells || []).map((item) =>
        Object.assign({}, item, {
          durText: item.has ? F.fmtHoursShort(item.durationMin) : ''
        })
      )
      this.setData({ rows })
    }
  },

  methods: {
    onTap(e) {
      const index = Number(e.currentTarget.dataset.index)
      const cell = this.data.rows[index]
      if (!cell || cell.pad) return
      this.triggerEvent('daytap', { cell })
    },

    onPrev() {
      this.triggerEvent('prev')
    },

    onNext() {
      if (!this.data.canNext) return
      this.triggerEvent('next')
    }
  }
})
