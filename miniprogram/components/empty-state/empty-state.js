Component({
  data: {
    // 3×3 迷你格：索引 8 是右下角“亮起的第一格”（与热力图最新在右一致）
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
    }
  },

  methods: {
    onAction() {
      this.triggerEvent('action')
    }
  }
})
