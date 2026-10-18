/**
 * 自绘 12 小时时间轮：时 / 分 / 上午·下午。
 * 时、分各渲染 3 个周期，滚动停止后落在边界周期时无感跳回中间周期，形成循环。
 * 对外仍使用 24 小时 "HH:MM"，页面无需改算法。
 */
const COMPONENT_WIDTH_RPX = 88
const VISIBLE_ROWS = 5
const CYCLES = 3
const CYCLE_HOURS = 12
const CYCLE_MINUTES = 12

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
      value: 5
    }
  },

  data: {
    rowH: 44,
    padH: 88,
    wheelH: 220,
    selH: 7,
    selM: 30,
    period: '上午',
    hourTop: 0,
    minuteTop: 0,
    hourItems: [],
    minuteItems: []
  },

  lifetimes: {
    attached() {
      this._ready = false
      this._suppress = false
      this._hourTimer = null
      this._minuteTimer = null
      this._recenterTimer = null

      let width = 375
      try {
        width = wx.getSystemInfoSync().windowWidth || 375
      } catch (e) {}
      const rowH = Math.max(36, Math.round((COMPONENT_WIDTH_RPX * width) / 750))
      this._rowH = rowH

      const hourItems = []
      for (let c = 0; c < CYCLES; c += 1) {
        for (let h = 1; h <= CYCLE_HOURS; h += 1) {
          hourItems.push({ key: c + '-' + h, v: h, label: pad2(h) })
        }
      }

      const minuteItems = []
      const step = this.data.minuteStep || 5
      const minuteCount = Math.round(60 / step)
      this._minuteCount = minuteCount
      for (let c = 0; c < CYCLES; c += 1) {
        for (let i = 0; i < minuteCount; i += 1) {
          const m = i * step
          minuteItems.push({ key: c + '-' + m, v: m, label: pad2(m) })
        }
      }

      this.setData(
        {
          rowH,
          padH: rowH * 2,
          wheelH: rowH * VISIBLE_ROWS,
          hourItems,
          minuteItems
        },
        () => {
          this._ready = true
          // 等 scroll-view 内容完成布局后再定位到当前值
          setTimeout(() => {
            if (this._ready) this.scrollToValue(this.properties.value)
          }, 60)
        }
      )
    },

    detached() {
      clearTimeout(this._hourTimer)
      clearTimeout(this._minuteTimer)
      clearTimeout(this._recenterTimer)
    }
  },

  methods: {
    parse(value) {
      const parts = String(value || '07:30').split(':')
      let hour = Number(parts[0])
      let minute = Number(parts[1])
      const step = this.data.minuteStep || 5
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

    scrollToValue(value) {
      if (!this._ready) return
      const p = this.parse(value)
      const rowH = this._rowH
      const hourIdx = p.h12 - 1
      const minuteStep = this.data.minuteStep || 5
      const minuteCount = this._minuteCount || Math.round(60 / minuteStep)
      const minuteIdx = p.minute / minuteStep
      this._suppress = true
      clearTimeout(this._recenterTimer)
      this._recenterTimer = setTimeout(() => {
        this._suppress = false
      }, 260)
      this.setData({
        selH: p.h12,
        selM: p.minute,
        period: p.period,
        hourTop: (12 + hourIdx) * rowH,
        minuteTop: (minuteCount + minuteIdx) * rowH
      })
    },

    onHourScroll(event) {
      if (!this._ready || this._suppress) return
      this._lastHourTop = event.detail.scrollTop
      clearTimeout(this._hourTimer)
      this._hourTimer = setTimeout(() => {
        this.settle('hour', this._lastHourTop)
      }, 130)
    },

    onMinuteScroll(event) {
      if (!this._ready || this._suppress) return
      this._lastMinuteTop = event.detail.scrollTop
      clearTimeout(this._minuteTimer)
      this._minuteTimer = setTimeout(() => {
        this.settle('minute', this._lastMinuteTop)
      }, 130)
    },

    settle(which, top) {
      if (!this._ready) return
      const rowH = this._rowH
      const isHour = which === 'hour'
      const minuteStep = this.data.minuteStep || 5
      const cycleCount = isHour ? 12 : this._minuteCount || Math.round(60 / minuteStep)
      const max = CYCLES * cycleCount - 1
      let raw = clamp(Math.round((Number(top) || 0) / rowH), 0, max)
      const idx = raw % cycleCount
      const patch = {}

      if (isHour) {
        const h12 = idx + 1
        if (h12 !== this.data.selH) patch.selH = h12
      } else {
        const minute = idx * minuteStep
        if (minute !== this.data.selM) patch.selM = minute
      }

      // 越过首尾周期时无感回到中间周期，保持同一数值
      if (raw < cycleCount || raw >= cycleCount * 2) {
        raw = cycleCount + idx
      }

      patch[isHour ? 'hourTop' : 'minuteTop'] = raw * rowH
      this._suppress = true
      this.setData(patch, () => {
        setTimeout(() => {
          this._suppress = false
        }, 220)
        if (patch.selH !== undefined || patch.selM !== undefined) {
          this.triggerEvent('change', { value: this.to24() })
        }
      })
    },

    onPeriodTap(event) {
      const period = event.currentTarget.dataset.period
      if (!period || period === this.data.period) return
      this.setData({ period }, () => {
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
