/* 国际站前端：无框架、无外部请求，只依赖 core.js 暴露的 window.SleepCore */
(function () {
  var T = window.SleepCore.T
  var P = window.SleepCore.P
  var page = window.__PAGE__ || { locale: 'en', mode: 'wake' }
  var t = window.__I18N__ || {}

  var STORE_KEY = 'sleepintl:records:v1'
  var MAX_SAVED = 20

  var root = document.getElementById('calc')
  if (!root) return

  var clock = document.getElementById('clock')
  var fall = document.getElementById('fall')
  var label = document.getElementById('clock-label')
  var head = document.getElementById('result-head')
  var list = document.getElementById('slots')
  var status = document.getElementById('status')
  var savedList = document.getElementById('saved-list')

  var state = { mode: page.mode === 'sleep' ? 'sleep' : 'wake' }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n)
  }

  function clockText(ts) {
    var d = new Date(ts)
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes())
  }

  function durationText(min) {
    var total = Math.max(0, Math.round(min))
    var h = Math.floor(total / 60)
    var m = total % 60
    if (!h) return m + 'm'
    return m ? h + 'h ' + m + 'm' : h + 'h'
  }

  function dayWord(ts) {
    var a = new Date(ts)
    var b = new Date()
    a.setHours(0, 0, 0, 0)
    b.setHours(0, 0, 0, 0)
    var diff = Math.round((a - b) / 86400000)
    if (diff === 0) return t.today || 'today'
    if (diff === 1) return t.tomorrow || 'tomorrow'
    if (diff === -1) return t.yesterday || 'yesterday'
    return ''
  }

  function fill(template, vars) {
    return String(template || '').replace(/\{(\w+)\}/g, function (m, key) {
      return vars[key] === undefined ? m : vars[key]
    })
  }

  function readClock() {
    var parts = String(clock.value || '07:00').split(':')
    return (Number(parts[0]) || 0) * 60 + (Number(parts[1]) || 0)
  }

  function setMode(mode) {
    state.mode = mode
    root.querySelectorAll('.seg button').forEach(function (btn) {
      btn.classList.toggle('is-on', btn.dataset.mode === mode)
    })
    label.textContent = mode === 'sleep' ? t.shiftSleep : t.shiftWake
    render()
  }

  function compute() {
    var now = Date.now()
    var fallMin = Number(fall.value) || 0
    var minutes = readClock()
    if (state.mode === 'wake') {
      var r = P.bedtimesForWake(now, minutes, fallMin, now)
      return {
        head: fill(t.resultsWake, { time: clockText(r.wakeAt) }),
        slots: r.slots,
        extra: r.extra,
        target: r.wakeAt
      }
    }
    var s = P.wakeTimesForSleep(now, minutes, fallMin)
    return {
      head: fill(t.resultsSleep, { time: clockText(s.sleepAt) }),
      slots: s.slots,
      extra: s.extra,
      target: s.sleepAt
    }
  }

  function render() {
    var out
    try {
      out = compute()
    } catch (err) {
      head.textContent = ''
      list.innerHTML = ''
      return
    }
    head.textContent = out.head
    list.innerHTML = ''

    var all = out.slots.concat([out.extra])
    all.forEach(function (slot, index) {
      if (!slot) return
      var li = document.createElement('li')
      li.className = 'slot' + (slot.passed ? ' is-passed' : '') + (index === 0 ? ' is-best' : '')

      var time = document.createElement('span')
      time.className = 'slot-time'
      time.textContent = clockText(slot.at)

      var meta = document.createElement('span')
      meta.className = 'slot-meta'
      var word = dayWord(slot.at)
      meta.textContent =
        fill(index === 3 ? t.cyclesExtra : t.cycles, {
          n: slot.cycles,
          duration: durationText(slot.durationMin)
        }) + (word ? ' · ' + word : '')

      li.appendChild(time)
      li.appendChild(meta)

      if (index === 0 && !slot.passed) {
        var badge = document.createElement('span')
        badge.className = 'badge'
        badge.textContent = t.badgeBest || 'Best'
        li.appendChild(badge)
      } else if (index === 3) {
        var extra = document.createElement('span')
        extra.className = 'badge is-soft'
        extra.textContent = t.badgeExtra || 'Extra'
        li.appendChild(extra)
      }

      if (slot.passed) {
        var passed = document.createElement('span')
        passed.className = 'slot-flag'
        passed.textContent = t.passed || 'passed'
        li.appendChild(passed)
      }

      list.appendChild(li)
    })
  }

  function loadRecords() {
    try {
      var raw = localStorage.getItem(STORE_KEY)
      var parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed : []
    } catch (err) {
      return []
    }
  }

  function saveRecords(records) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(records.slice(0, MAX_SAVED)))
    } catch (err) {}
  }

  function renderSaved() {
    if (!savedList) return
    var records = loadRecords()
    savedList.innerHTML = ''
    records.forEach(function (record) {
      var li = document.createElement('li')
      var day = document.createElement('span')
      day.className = 'saved-day'
      day.textContent = record.day
      var span = document.createElement('span')
      span.textContent = clockText(record.bedAt) + ' → ' + clockText(record.wakeAt) + ' · ' + durationText(record.durationMin)
      li.appendChild(day)
      li.appendChild(span)
      savedList.appendChild(li)
    })
    if (!records.length) {
      var empty = document.createElement('li')
      empty.className = 'saved-empty'
      empty.textContent = t.empty || ''
      savedList.appendChild(empty)
    }
  }

  function save() {
    var out = compute()
    var best = out.slots.filter(function (slot) { return !slot.passed })[0] || out.slots[0]
    if (!best) return
    var bedAt = state.mode === 'wake' ? best.at : out.target
    var wakeAt = state.mode === 'wake' ? out.target : best.at
    var tzOffsetMin = -new Date().getTimezoneOffset()
    var record = {
      id: 'web-' + wakeAt + '-' + best.cycles,
      mode: state.mode,
      bedAt: bedAt,
      wakeAt: wakeAt,
      durationMin: best.durationMin,
      cycles: best.cycles,
      tzOffsetMin: tzOffsetMin,
      day: T.dayKeyOf(wakeAt, tzOffsetMin),
      createdAt: Date.now()
    }
    var records = loadRecords().filter(function (item) { return item.id !== record.id })
    records.unshift(record)
    saveRecords(records)
    renderSaved()
    status.textContent = t.saved || 'Saved'
    setTimeout(function () { status.textContent = '' }, 1800)
  }

  function share() {
    var out = compute()
    var text = out.head + ' ' + out.slots.map(function (slot) { return clockText(slot.at) }).join(' / ')
    var url = location.href
    if (navigator.share) {
      navigator.share({ title: document.title, text: text, url: url }).catch(function () {})
      return
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text + ' ' + url).then(function () {
        status.textContent = t.copied || 'Copied'
        setTimeout(function () { status.textContent = '' }, 1800)
      })
    }
  }

  root.querySelectorAll('.seg button').forEach(function (btn) {
    btn.addEventListener('click', function () { setMode(btn.dataset.mode) })
  })
  clock.addEventListener('input', render)
  clock.addEventListener('change', render)
  fall.addEventListener('change', render)
  document.getElementById('save').addEventListener('click', save)
  document.getElementById('share').addEventListener('click', share)
  var clear = document.getElementById('clear')
  if (clear) {
    clear.addEventListener('click', function () {
      saveRecords([])
      renderSaved()
    })
  }

  setMode(state.mode)
  renderSaved()
})()
