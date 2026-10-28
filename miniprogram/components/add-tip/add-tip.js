const storage = require('../../utils/storage')
const addTip = require('../../utils/add-tip')
const events = require('../../utils/events')

// 卡片顶边与原生胶囊之间的呼吸距离（px）
const CARD_GAP = 8
// 引导是提示不是拦截：6 秒足够读完两行，读完自动收起，不长期占着右上角
const AUTO_HIDE_MS = 6000
// 淡出时长，与 wxss 的 transition 保持一致
const CLOSE_ANIM_MS = 240
// checkIsAddedToMyMiniProgram 没有超时参数：卡住超过 3s 视为“判断失败”，按未添加继续
const CHECK_TIMEOUT = 3000

function measure() {
  // 取不到胶囊信息时的兜底位置（与旧版顶栏一致的 44px 导航行）
  const fallback = { top: 96, right: 12, arrowRight: 64 }
  try {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const width = Number(info && info.windowWidth) || 375
    const menu = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null
    if (!menu || !menu.height) return fallback
    return {
      // 卡片贴在胶囊下沿，右缘与胶囊右缘对齐
      top: Math.round(menu.bottom + CARD_GAP),
      right: Math.max(0, Math.round(width - menu.right)),
      // 箭头只指胶囊左半边的「···」：右半边是「关闭」，指错会让用户点掉小程序
      arrowRight: Math.round(width - (menu.left + menu.width * 0.3))
    }
  } catch (e) {
    return fallback
  }
}

/** 朋友圈单页模式（scene 1154）没有胶囊菜单，这个引导在那边不成立 */
function isSinglePage() {
  try {
    const options = wx.getEnterOptionsSync ? wx.getEnterOptionsSync() : wx.getLaunchOptionsSync()
    return Number(options && options.scene) === 1154
  } catch (e) {
    return false
  }
}

Component({
  data: Object.assign({ visible: false, closing: false }, measure()),

  lifetimes: {
    attached() {
      // 开发者工具切换设备后胶囊位置会变，挂载时复核一次（幂等）
      this.setData(measure())
    },
    detached() {
      this.clearTimers()
    }
  },

  pageLifetimes: {
    // 每次页面显示判一次：只依赖本地状态，未到窗口期时连接口都不调
    show() {
      this.maybeShow()
    },
    // 切到别的 tab 时收起，避免回来看见一张停在前一屏的卡
    hide() {
      this.clearTimers()
      if (this.data.visible) this.setData({ visible: false, closing: false })
    }
  },

  methods: {
    maybeShow() {
      if (this._busy || this._added || this.data.visible) return
      if (isSinglePage()) return
      const snap = this.snapshot()
      if (!addTip.shouldShow(snap).show) return

      this._busy = true
      this.checkAdded((added) => {
        this._busy = false
        // 已确认添加：本次运行内不再问；跨会话重开时会再判一次（用户可能取消添加）
        if (added === true) {
          this._added = true
          return
        }
        // 等接口的这几百毫秒里可能已在别的页展示过或跨了周/月，落库前再判一次
        const now = Date.now()
        const gate = addTip.shouldShow({
          now,
          state: storage.getAddTip(),
          hasRecord: snap.hasRecord,
          busy: !!storage.getPending()
        })
        if (!gate.show) return

        storage.setAddTip(addTip.markShown(storage.getAddTip(), now))
        this.setData({ visible: true, closing: false })
        events.track('add_tip', 'show')
        this.armAutoHide()
      })
    },

    /** 本地判据快照：频次/夜间在 add-tip 里统一裁决，组件只负责取数 */
    snapshot() {
      return {
        now: Date.now(),
        state: storage.getAddTip(),
        hasRecord: addTip.hasAnyRecord(storage.getRecords()),
        // 入睡中（含熄灯）不打断：这两件事都在 pending 存在期间发生
        busy: !!storage.getPending()
      }
    },

    /**
     * 判断是否已添加。低版本/接口异常/超时都回调 false，走“未确认已添加”的频次约束——
     * 用户仍可能看到最多 5 次/月的引导，这是没有判断能力时的上限，不是无穷。
     */
    checkAdded(done) {
      let settled = false
      let timer = null
      const finish = (value) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        done(value)
      }

      timer = setTimeout(() => finish(false), CHECK_TIMEOUT)

      if (typeof wx === 'undefined' || typeof wx.checkIsAddedToMyMiniProgram !== 'function') {
        finish(false)
        return
      }
      try {
        wx.checkIsAddedToMyMiniProgram({
          success(res) {
            finish(!!(res && res.added))
          },
          fail() {
            finish(false)
          }
        })
      } catch (e) {
        finish(false)
      }
    },

    armAutoHide() {
      this.clearTimer()
      this._timer = setTimeout(() => this.dismiss('auto'), AUTO_HIDE_MS)
    },

    clearTimer() {
      if (this._timer) {
        clearTimeout(this._timer)
        this._timer = null
      }
    },

    clearTimers() {
      this.clearTimer()
      if (this._closeTimer) {
        clearTimeout(this._closeTimer)
        this._closeTimer = null
      }
    },

    /** 收起：先淡出 240ms 再卸载。action 只用于埋点（tap/close/auto） */
    dismiss(action) {
      if (!this.data.visible || this.data.closing) return
      this.clearTimer()
      this.setData({ closing: true })
      events.track('add_tip', action)
      this._closeTimer = setTimeout(() => {
        this._closeTimer = null
        this.setData({ visible: false, closing: false })
      }, CLOSE_ANIM_MS)
    },

    // 点卡片或「添加」：说清唯一的添加路径，然后收起（不假装已添加）
    onBodyTap() {
      wx.showToast({
        title: '点右上角「···」→ 添加到我的小程序',
        icon: 'none',
        duration: 2600
      })
      this.dismiss('tap')
    },

    onClose() {
      this.dismiss('close')
    }
  }
})
