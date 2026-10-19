/**
 * 自绘 12 小时时间轮：时 / 分 / 上午·下午。
 * 时、分各渲染 3 个周期，滚动停止后落在边界周期时无感跳回中间周期，形成循环。
 * 视觉为立体滚筒（电表轮）：每行按其到滚筒中心的行距做 rotateX + 透视变形，
 * 越靠上下边缘越倾斜、越透明；中心行实时放大高亮。
 * 对外仍使用 24 小时 "HH:MM"，页面无需改算法。
 */
const COMPONENT_WIDTH_RPX = 84
const VISIBLE_ROWS = 5
const CYCLES = 3
const CYCLE_HOURS = 12
// 滚筒造型参数
const DRUM_ALPHA_DEG = 24 // 每行对应的圆心角，越大弧度越弯
const DRUM_PERSPECTIVE_ROWS = 8 // 每行透视距离（rowH 的倍数），越小立体感越强
const DRUM_FADE_SPAN = 2.5 // 透明度从 1 衰减到 ~0.15 的行距
const DRUM_EDGE_ROWS = 3.2 // 超出该行距直接透明

function pad2(value) {
  return value < 10 ? '0' + value : String(value)
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

Component({
  properties: {
    value: {
      type: String,
      value: '',
      observer: 'onExternalValue'
    },
    minuteStep: {
      type: Number,
      value: 1
    }
  },

  data: {
    rowH: 38,
    padH: 76,
    wheelH: 190,
    selH: 7,
    selM: 30,
    period: '上午',
    hourTop: 0,
    minuteTop: 0,
    hourItems: [],
    minuteItems: [],
    hourStyles: [],
    minuteStyles: []
  },

  lifetimes: {
    attached() {
      this._ready = false
      this._hourTimer = null
      this._minuteTimer = null
      this._applyTimerHour = null
      this._applyTimerMinute = null
      // 程序化滚动的目标位置，用于识别 scroll-top 回声，替代旧的定时 suppress
      this._hourTarget = null
      this._minuteTarget = null
      // 已上报（triggerEvent）的选中值，实时高亮只改展示，change 仍在落定时发一次
      this._emittedH = null
      this._emittedM = null

      let width = 375
      try {
        const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
        width = info.windowWidth || 375
      } catch (e) {}
      const rowH = Math.max(36, Math.round((COMPONENT_WIDTH_RPX * width) / 750))
      this._rowH = rowH
      this._wheelH = rowH * VISIBLE_ROWS
      this._padH = rowH * 2

      const hourItems = []
      for (let c = 0; c < CYCLES; c += 1) {
        for (let h = 1; h <= CYCLE_HOURS; h += 1) {
          hourItems.push({ key: c + '-' + h, v: h, label: pad2(h) })
        }
      }

      const minuteItems = []
      const minuteStep = this.data.minuteStep || 1
      const minuteCount = Math.round(60 / minuteStep)
      this._minuteCount = minuteCount
      for (let c = 0; c < CYCLES; c += 1) {
        for (let i = 0; i < minuteCount; i += 1) {
          const m = i * minuteStep
          minuteItems.push({ key: c + '-' + m, v: m, label: pad2(m) })
        }
      }

      const p = this.parse(this.properties.value)
      const hourTop = (12 + (p.h12 - 1)) * rowH
      const minuteTop = (minuteCount + p.minute / minuteStep) * rowH
      this._emittedH = p.h12
      this._emittedM = p.minute
      this._hourTarget = hourTop
      this._minuteTarget = minuteTop

      const hourStyles = []
      for (let i = 0; i < hourItems.length; i += 1) {
        hourStyles.push(
          Math.abs(this.drumDeltaOf(i, hourTop)) > DRUM_EDGE_ROWS + 1
            ? ''
            : this.drumStyleAt('hour', i, hourTop)
        )
      }
      const minuteStyles = []
      for (let i = 0; i < minuteItems.length; i += 1) {
        minuteStyles.push(
          Math.abs(this.drumDeltaOf(i, minuteTop)) > DRUM_EDGE_ROWS + 1
            ? ''
            : this.drumStyleAt('minute', i, minuteTop)
        )
      }

      this.setData(
        {
          rowH,
          padH: this._padH,
          wheelH: this._wheelH,
          selH: p.h12,
          selM: p.minute,
          period: p.period,
          hourTop,
          minuteTop,
          hourItems,
          minuteItems,
          hourStyles,
          minuteStyles
        },
        () => {
          this._ready = true
          // 等内容完成布局后复核一次定位（幂等）
          setTimeout(() => {
            if (this._ready) this.scrollToValue(this.properties.value)
          }, 60)
        }
      )
    },

    detached() {
      clearTimeout(this._hourTimer)
      clearTimeout(this._minuteTimer)
      clearTimeout(this._applyTimerHour)
      clearTimeout(this._applyTimerMinute)
    }
  },

  methods: {
    parse(value) {
      const parts = String(value || '07:30').split(':')
      let hour = Number(parts[0])
      let minute = Number(parts[1])
      const step = this.data.minuteStep || 1
      if (!isFinite(hour)) hour = 7
      if (!isFinite(minute)) minute = 30
      minute = Math.round(minute / step) * step
      if (minute >= 60) {
        minute = 0
        hour = (hour + 1) % 24
      }
      const period = hour < 12 ? '上午' : '下午'
      let h12 = hour % 12
      if (h12 === 0) h12 = 12
      return { h12, minute, period }
    },

    to24() {
      const hour = this.data.period === '上午'
        ? (this.data.selH === 12 ? 0 : this.data.selH)
        : (this.data.selH === 12 ? 12 : this.data.selH + 12)
      return pad2(hour) + ':' + pad2(this.data.selM)
    },

    /** 第 i 行相对滚筒中心的行距（正 = 在中心下方） */
    drumDeltaOf(i, top) {
      return (this._padH + (i + 0.5) * this._rowH - (top + this._wheelH / 2)) / this._rowH
    },

    /** 滚筒样式：rotateX 弧面变形 + 上下透明度衰减 */
    drumStyleAt(which, i, top) {
      const delta = this.drumDeltaOf(i, top)
      const ad = Math.abs(delta)
      if (ad >= DRUM_EDGE_ROWS) return 'opacity:0'
      const t = Math.min(1, ad / DRUM_FADE_SPAN)
      let opacity = 1 - 0.85 * Math.pow(t, 1.6)
      if (ad > DRUM_FADE_SPAN) {
        opacity *= Math.max(0, 1 - (ad - DRUM_FADE_SPAN) / (DRUM_EDGE_ROWS - DRUM_FADE_SPAN))
      }
      opacity = Math.max(0, Math.min(1, opacity))
      const persp = Math.round(DRUM_PERSPECTIVE_ROWS * this._rowH)
      const angle = (-delta * DRUM_ALPHA_DEG).toFixed(2)
      return 'transform:perspective(' + persp + 'px) rotateX(' + angle + 'deg);opacity:' + opacity.toFixed(3)
    },

    /** 只更新可视窗口附近行的样式（路径写法减小 diff） */
    buildDrumPatch(which, top) {
      const rowH = this._rowH
      const prefix = which === 'hour' ? 'hourStyles' : 'minuteStyles'
      const items = which === 'hour' ? this.data.hourItems : this.data.minuteItems
      const first = Math.max(0, Math.floor((top - this._padH) / rowH) - 3)
      const last = Math.min(items.length - 1, Math.floor((top - this._padH) / rowH) + VISIBLE_ROWS + 3)
      const patch = {}
      for (let i = first; i <= last; i += 1) {
        patch[prefix + '[' + i + ']'] = this.drumStyleAt(which, i, top)
      }
      return patch
    },

    mergeDrum(patch, which, top) {
      const drum = this.buildDrumPatch(which, top)
      for (const key in drum) patch[key] = drum[key]
      return patch
    },

    scrollToValue(value) {
      if (!this._ready) return
      const p = this.parse(value)
      const rowH = this._rowH
      const minuteStep = this.data.minuteStep || 1
      const minuteCount = this._minuteCount || Math.round(60 / minuteStep)
      const hourTop = (12 + (p.h12 - 1)) * rowH
      const minuteTop = (minuteCount + p.minute / minuteStep) * rowH
      clearTimeout(this._hourTimer)
      clearTimeout(this._minuteTimer)
      this._hourTarget = hourTop
      this._minuteTarget = minuteTop
      this._emittedH = p.h12
      this._emittedM = p.minute
      const patch = {
        selH: p.h12,
        selM: p.minute,
        period: p.period,
        hourTop,
        minuteTop
      }
      this.mergeDrum(patch, 'hour', hourTop)
      this.mergeDrum(patch, 'minute', minuteTop)
      this.setData(patch)
    },

    onHourScroll(event) {
      this.onColumnScroll('hour', event)
    },

    onMinuteScroll(event) {
      this.onColumnScroll('minute', event)
    },

    onColumnScroll(which, event) {
      if (!this._ready) return
      const top = Number(event.detail.scrollTop) || 0
      if (which === 'hour') this._lastHourTop = top
      else this._lastMinuteTop = top
      this.applyDrumLive(which, top)
      const timerKey = which === 'hour' ? '_hourTimer' : '_minuteTimer'
      clearTimeout(this[timerKey])
      this[timerKey] = setTimeout(() => {
        this.settle(which, top)
      }, 130)
    },

    /** 滚动中实时驱动滚筒样式（16ms 节流 + 尾随补帧）与中心高亮 */
    applyDrumLive(which, top) {
      const stampKey = which === 'hour' ? '_lastHourApply' : '_lastMinuteApply'
      const timerKey = which === 'hour' ? '_applyTimerHour' : '_applyTimerMinute'
      const pendKey = which === 'hour' ? '_pendingHourTop' : '_pendingMinuteTop'
      this[pendKey] = top
      const now = Date.now()
      if (now - (this[stampKey] || 0) >= 16) {
        this[stampKey] = now
        clearTimeout(this[timerKey])
        this[timerKey] = null
        this.commitDrum(which, top)
      } else if (!this[timerKey]) {
        this[timerKey] = setTimeout(() => {
          this[timerKey] = null
          this.commitDrum(which, this[pendKey])
        }, 16)
      }
    },

    commitDrum(which, top) {
      const patch = this.buildDrumPatch(which, top)
      const rowH = this._rowH
      const minuteStep = this.data.minuteStep || 1
      const cycleCount = which === 'hour'
        ? CYCLE_HOURS
        : (this._minuteCount || Math.round(60 / minuteStep))
      const max = CYCLES * cycleCount - 1
      const idx = clamp(Math.round(top / rowH), 0, max) % cycleCount
      if (which === 'hour') {
        const h12 = idx + 1
        if (h12 !== this.data.selH) patch.selH = h12
      } else {
        const minute = idx * minuteStep
        if (minute !== this.data.selM) patch.selM = minute
      }
      this.setData(patch)
    },

    settle(which, top) {
      if (!this._ready) return
      const rowH = this._rowH
      const isHour = which === 'hour'
      const minuteStep = this.data.minuteStep || 1
      const cycleCount = isHour
        ? CYCLE_HOURS
        : (this._minuteCount || Math.round(60 / minuteStep))
      const max = CYCLES * cycleCount - 1
      // 程序化滚动（初始定位 / 回中跳转）的回声：位置未变则忽略
      const target = isHour ? this._hourTarget : this._minuteTarget
      if (target !== null && Math.abs((Number(top) || 0) - target) < rowH / 2) return

      let raw = clamp(Math.round((Number(top) || 0) / rowH), 0, max)
      const idx = raw % cycleCount
      const nextH = isHour ? idx + 1 : this.data.selH
      const nextM = isHour ? this.data.selM : idx * minuteStep
      const changed = isHour ? (nextH !== this._emittedH) : (nextM !== this._emittedM)

      // 越过首尾周期时无感回到中间周期，保持同一数值
      if (raw < cycleCount || raw >= cycleCount * 2) {
        raw = cycleCount + idx
      }
      if (isHour) this._hourTarget = raw * rowH
      else this._minuteTarget = raw * rowH

      const patch = {}
      if (isHour) {
        if (nextH !== this.data.selH) patch.selH = nextH
      } else {
        if (nextM !== this.data.selM) patch.selM = nextM
      }
      patch[isHour ? 'hourTop' : 'minuteTop'] = raw * rowH
      this.mergeDrum(patch, which, raw * rowH)

      this.setData(patch, () => {
        if (changed) {
          if (isHour) this._emittedH = nextH
          else this._emittedM = nextM
          this.triggerEvent('change', { value: this.to24() })
        }
      })
    },

    togglePeriod() {
      const next = this.data.period === '上午' ? '下午' : '上午'
      this.setData({ period: next }, () => {
        this.triggerEvent('change', { value: this.to24() })
      })
    },

    onPeriodTap(event) {
      const targetPeriod = event.currentTarget.dataset.period
      if (!targetPeriod) return
      if (targetPeriod === this.data.period) {
        return this.togglePeriod()
      }
      this.setData({ period: targetPeriod }, () => {
        this.triggerEvent('change', { value: this.to24() })
      })
    },

    onExternalValue(value) {
      if (!this._ready) return
      const p = this.parse(value)
      if (
        p.h12 === this.data.selH &&
        p.minute === this.data.selM &&
        p.period === this.data.period
      ) {
        return
      }
      this.scrollToValue(value)
    }
  }
})
