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
      if (this.data.loading) return
      this.triggerEvent('cancel')
    }
  }
})
