/**
 * 页面展示位。
 * 广告位 ID 为空、未启用或加载失败时不渲染任何内容，页面不会留空白。
 * 加载中保留最小占位高度，避免广告异步填充把下方内容顶下去。
 * 具体展示位由服务端 /api/config 的 ads 下发，运营在后台逐槽开关。
 * ad_show / ad_error 事件用于后台观测填充率。
 */
const events = require('../../utils/events')

Component({
  properties: {
    slotName: {
      type: String,
      value: ''
    },
    unitId: {
      type: String,
      value: ''
    },
    type: {
      type: String,
      value: 'template'
    },
    enabled: {
      type: Boolean,
      value: false
    },
    theme: {
      type: String,
      value: 'dark'
    }
  },

  data: {
    failed: false,
    failCount: 0,
    loaded: false
  },

  observers: {
    // 后台换了广告位 ID 后，旧的失败状态立即失效
    unitId() {
      if (this.data.failed) this.setData({ failed: false, failCount: 0, loaded: false })
    }
  },

  pageLifetimes: {
    show() {
      // 弱网/审核中失败后，回到页面允许重试；最多 3 次，避免反复打点
      if (this.data.failed && this.data.failCount < 3) {
        this.setData({ failed: false, loaded: false })
      }
    }
  },

  methods: {
    onAdLoad() {
      if (this.data.loaded) return
      this.setData({ loaded: true })
      events.track('ad_show', this.data.slotName)
    },

    // 未开通流量主、广告位审核中、加载失败都走这里：静默隐藏，不向用户抛错
    onAdError() {
      this.setData({ failed: true, failCount: this.data.failCount + 1 })
      events.track('ad_error', this.data.slotName)
    }
  }
})
