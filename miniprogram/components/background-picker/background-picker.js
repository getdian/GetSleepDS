/**
 * 首页背景选择抽屉。
 * 只负责展示与事件；是否需看广告、解锁与写 storage 由首页处理。
 */
Component({
  properties: {
    show: {
      type: Boolean,
      value: false
    },
    items: {
      type: Array,
      value: []
    },
    categories: {
      type: Array,
      value: ['全部']
    },
    activeCategory: {
      type: String,
      value: '全部'
    },
    activeId: {
      type: String,
      value: ''
    },
    unlockHours: {
      type: Number,
      value: 24
    },
    busy: {
      type: Boolean,
      value: false
    },
    freeMode: {
      type: Boolean,
      value: false
    }
  },

  methods: {
    noop() {},

    /** COS 图片处理不可用/缩略图 404 时回退原图，避免列表整块空白 */
    onThumbError(event) {
      const id = event.currentTarget.dataset.id
      if (!id) return
      let changed = false
      const items = this.data.items.map((item) => {
        if (item.id !== id || item.thumbFailed) return item
        changed = true
        return Object.assign({}, item, { thumbFailed: true, localPath: '' })
      })
      if (changed) this.setData({ items })
    },

    onClose() {
      this.triggerEvent('close')
    },

    onCategory(event) {
      const category = event.currentTarget.dataset.cat
      if (!category || category === this.data.activeCategory) return
      this.triggerEvent('category', { category })
    },

    onSelect(event) {
      if (this.data.busy) return
      const id = event.currentTarget.dataset.id
      if (id) this.triggerEvent('select', { id })
    }
  }
})
