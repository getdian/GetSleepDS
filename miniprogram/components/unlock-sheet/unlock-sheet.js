Component({
  properties: {
    show: {
      type: Boolean,
      value: false
    },
    title: {
      type: String,
      value: ''
    },
    desc: {
      type: String,
      value: ''
    },
    confirmText: {
      type: String,
      value: '确认'
    },
    cancelText: {
      type: String,
      value: '取消'
    },
    loading: {
      type: Boolean,
      value: false
    }
  },

  methods: {
    noop() {},

    onConfirm() {
      if (this.data.loading) return
      this.triggerEvent('confirm')
    },

    onCancel() {
      // 取消永远可用：广告/下载卡住时必须给用户退出路径，force 由父组件递增 seq 作废在途回调
      this.triggerEvent('cancel', { force: true })
    }
  }
})
