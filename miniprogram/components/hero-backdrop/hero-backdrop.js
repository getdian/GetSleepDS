/**
 * 页面顶部环境背景：复用后台按分类/解锁配置的背景图。
 * 计算器页已有实现；这里抽成组件给入睡页复用，避免两套下载/回退逻辑。
 */
const { getConfig, loadConfig } = require('../../utils/config')
const backgrounds = require('../../utils/backgrounds')

Component({
  data: {
    background: null,
    failed: false
  },

  lifetimes: {
    attached() {
      this._alive = true
      this.load()
    },
    detached() {
      this._alive = false
    }
  },

  pageLifetimes: {
    show() {
      this.load()
    }
  },

  methods: {
    load() {
      if (!this._alive) return
      this.apply(getConfig())
      loadConfig(true)
        .then((config) => {
          if (this._alive) this.apply(config)
        })
        .catch(() => {})
    },

    apply(config) {
      const active = backgrounds.prepare(config, (id, path) => {
        if (this._alive && this.data.background && this.data.background.id === id) {
          this.setData({ 'background.localPath': path })
        }
      })
      this.setData({ background: active, failed: false })
    },

    onError() {
      // 本地缓存失效先回退远程；远程也失败才隐藏，避免白屏
      if (this.data.background && this.data.background.localPath) {
        this.setData({ 'background.localPath': '' })
        return
      }
      this.setData({ failed: true })
    }
  }
})
