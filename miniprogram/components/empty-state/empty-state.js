Component({
  data: {
    // 3×3 迷你格：索引 0（左上）是“即将长出的第一格”，与空态文案一致
    cells: [0, 1, 2, 3, 4, 5, 6, 7, 8]
  },

  properties: {
    title: {
      type: String,
      value: '还没有数据'
    },
    desc: {
      type: String,
      value: ''
    },
    actionText: {
      type: String,
      value: ''
    },
    secondaryText: {
      type: String,
      value: ''
    }
  },

  methods: {
    onAction() {
      this.triggerEvent('action')
    },
    onSecondary() {
      this.triggerEvent('secondary')
    }
  }
})
