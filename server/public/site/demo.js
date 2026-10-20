(function () {
  'use strict'

  const CYCLE = 90
  const DAY = 24 * 60 * 60 * 1000

  const $ = (selector, root) => (root || document).querySelector(selector)
  const $$ = (selector, root) => Array.prototype.slice.call((root || document).querySelectorAll(selector))

  const RECORDS_KEY = 'demo:records'
  const PENDING_KEY = 'demo:pending'
  const UNLOCK_KEY = 'demo:audio_unlock_expire'
  const FALLBACK_AUDIO = '/demo-ambient.wav'

  const state = {
    wake: '07:30',
    fall: 15,
    range: 30,
    records: readJson(RECORDS_KEY, {}),
    pending: Number(readJson(PENDING_KEY, 0)) || 0,
    tracks: [],
    categories: ['全部'],
    category: '全部',
    keyword: '',
    current: null,
    pendingTrack: null,
    adTimer: null,
    audioBlocked: false,
    unlockHours: 24,
    copy: {
      unlockTitle: '解锁环境音',
      unlockDesc: '观看视频，解锁今晚的环境声音（24小时内有效）',
      unlockConfirm: '观看视频',
      unlockCancel: '先不用'
    }
  }

  const audio = $('#player-audio')

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw) : fallback
    } catch (e) {
      return fallback
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch (e) {}
  }

  function pad2(value) {
    return value < 10 ? '0' + value : String(value)
  }

  function fmtClock(timestamp) {
    const d = new Date(timestamp)
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes())
  }

  function fmtDuration(minutes) {
    const total = Math.max(0, Math.round(minutes))
    if (total < 60) return total + ' 分钟'
    return Math.floor(total / 60) + ' 小时 ' + pad2(total % 60) + ' 分'
  }

  function dateKey(timestamp) {
    const d = new Date(timestamp)
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
  }

  function sleepDayOf(timestamp) {
    return dateKey(timestamp - 12 * 60 * 60 * 1000)
  }

  function minutesOf(timestamp) {
    const d = new Date(timestamp)
    return d.getHours() * 60 + d.getMinutes()
  }

  function startOfDay(timestamp) {
    const d = new Date(timestamp)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }

  function addDays(timestamp, days) {
    const d = new Date(timestamp)
    d.setDate(d.getDate() + days)
    return d.getTime()
  }

  function parseClock(clock) {
    const parts = String(clock || '00:00').split(':')
    return Number(parts[0]) * 60 + Number(parts[1])
  }

  function toast(message) {
    const node = $('#toast')
    node.textContent = message
    node.hidden = false
    clearTimeout(node._timer)
    node._timer = setTimeout(() => {
      node.hidden = true
    }, 2400)
  }

  /* ---------------- 首页 ---------------- */

  function greeting() {
    const hour = new Date().getHours()
    if (hour >= 5 && hour < 11) return '早上好'
    if (hour >= 11 && hour < 13) return '中午好'
    if (hour >= 13 && hour < 18) return '下午好'
    if (hour >= 18 && hour < 23) return '晚上好'
    return '夜深了'
  }

  function buildPlan(now) {
    const buffer = state.fall * 60000
    const dayStart = startOfDay(now)
    let wake = dayStart + parseClock(state.wake) * 60000
    if (wake - buffer <= now) wake += DAY

    const makeSlots = (wakeTs) =>
      [5, 4, 3].map((cycles) => ({
        cycles,
        at: wakeTs - buffer - cycles * CYCLE * 60000,
        passed: wakeTs - buffer - cycles * CYCLE * 60000 <= now
      }))

    // 与小程序/PRD 一致：三个时刻全过时不再滚到下一晚，而是展示“现在睡还能睡 X”。
    const slots = makeSlots(wake)
    const available = Math.max(0, Math.floor((wake - now) / 60000) - state.fall)

    return {
      wakeAt: wake,
      slots,
      rolled: false,
      available,
      cycles: Math.floor(available / CYCLE),
      remainder: available % CYCLE
    }
  }

  function renderHome() {
    const now = Date.now()
    const plan = buildPlan(now)
    const todayKey = sleepDayOf(now)

    $('#home-date').textContent = new Date().toLocaleDateString('zh-CN', {
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    })
    $('#home-greeting').textContent = greeting() + '，今天几点睡？'
    $('#wake-label').textContent = state.wake

    const slotsBox = $('#slots')
    slotsBox.textContent = ''
    plan.slots.forEach((slot) => {
      const node = document.createElement('div')
      node.className = 'slot' + (slot.passed ? ' passed' : '')
      const time = document.createElement('b')
      time.textContent = fmtClock(slot.at)
      const meta = document.createElement('span')
      meta.textContent = slot.cycles + ' 个周期'
      const duration = document.createElement('span')
      duration.textContent = fmtDuration(slot.cycles * CYCLE)
      node.appendChild(time)
      node.appendChild(meta)
      node.appendChild(duration)
      slotsBox.appendChild(node)
    })

    $('#roll-label').hidden = !plan.rolled

    $('#now-main').textContent =
      plan.available < 5
        ? '现在睡已经来不及了'
        : plan.cycles >= 1
          ? '现在睡 · 约 ' + plan.cycles + ' 个完整周期 · ' + fmtDuration(plan.cycles * CYCLE)
          : '现在睡只能睡 ' + plan.available + ' 分钟，不足 1 个周期'

    $('#now-sub').textContent =
      plan.remainder === 0 ? '正好卡在周期边界' : '距下个周期边界 ' + plan.remainder + ' 分钟'

    const dial = $('#dial')
    const done = state.records[todayKey]
    dial.classList.remove('sleeping', 'done')

    if (state.pending) {
      dial.classList.add('sleeping')
      $('#dial-title').textContent = '记录起床'
      $('#dial-sub').textContent = '已入睡 ' + fmtClock(state.pending)
      $('#done-card').hidden = true
    } else if (done) {
      dial.classList.add('done')
      $('#dial-title').textContent = '今日已完成'
      $('#dial-sub').textContent = '睡了 ' + fmtDuration(done.durationMin)
      $('#done-card').hidden = false
      $('#done-bed').textContent = fmtClock(done.bedAt)
      $('#done-wake').textContent = fmtClock(done.wakeAt)
      $('#done-duration').textContent = fmtDuration(done.durationMin)
    } else {
      $('#dial-title').textContent = '入睡打卡'
      $('#dial-sub').textContent = '现在 ' + fmtClock(now)
      $('#done-card').hidden = true
    }
  }

  function onDial() {
    const now = Date.now()
    const todayKey = sleepDayOf(now)

    if (state.records[todayKey]) return

    if (!state.pending) {
      state.pending = now
      writeJson(PENDING_KEY, now)
      renderHome()
      toast('晚安')
      return
    }

    if (now - state.pending < 60 * 1000) {
      toast('刚睡下，再等等')
      return
    }

    const record = {
      day: sleepDayOf(state.pending),
      bedAt: state.pending,
      wakeAt: now,
      durationMin: Math.round((now - state.pending) / 60000)
    }

    state.records[record.day] = record
    writeJson(RECORDS_KEY, state.records)
    state.pending = 0
    writeJson(PENDING_KEY, 0)
    renderHome()
    renderStats()
    toast('已记录')
  }

  function undo() {
    const todayKey = sleepDayOf(Date.now())
    if (!state.records[todayKey]) return
    delete state.records[todayKey]
    writeJson(RECORDS_KEY, state.records)
    renderHome()
    renderStats()
    toast('已撤销')
  }

  $('#dial').addEventListener('click', onDial)
  $('#undo').addEventListener('click', undo)

  $('#wake-time').addEventListener('change', (event) => {
    state.wake = event.target.value || '07:30'
    renderHome()
  })

  $('#fall-chips').addEventListener('click', (event) => {
    const button = event.target.closest('.chip')
    if (!button) return
    state.fall = Number(button.dataset.min)
    $$('#fall-chips .chip').forEach((chip) => chip.classList.toggle('on', chip === button))
    renderHome()
  })

  /* ---------------- 回顾 ---------------- */

  function completed() {
    return Object.keys(state.records)
      .map((key) => state.records[key])
      .filter((record) => record && record.wakeAt > record.bedAt)
      .sort((a, b) => (a.day < b.day ? -1 : 1))
  }

  function circularMean(values) {
    if (!values.length) return null
    let sin = 0
    let cos = 0
    values.forEach((value) => {
      const angle = (value / 1440) * Math.PI * 2
      sin += Math.sin(angle)
      cos += Math.cos(angle)
    })
    let deg = (Math.atan2(sin, cos) * 180) / Math.PI
    if (deg < 0) deg += 360
    return Math.round((deg * 1440) / 360) % 1440
  }

  function weekStart(now) {
    const d = new Date(startOfDay(now))
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    return d.getTime()
  }

  function renderStats() {
    const list = completed()
    const now = Date.now()
    const start = weekStart(now)
    const week = list.filter((record) => {
      const parts = record.day.split('-')
      return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])).getTime() >= start
    })

    const avgBed = circularMean(week.map((record) => minutesOf(record.bedAt)))
    const avgWake = circularMean(week.map((record) => minutesOf(record.wakeAt)))
    const avgDuration = week.length
      ? Math.round(week.reduce((sum, record) => sum + record.durationMin, 0) / week.length)
      : 0

    $('#avg-bed').textContent = avgBed === null ? '--:--' : pad2(Math.floor(avgBed / 60)) + ':' + pad2(avgBed % 60)
    $('#avg-wake').textContent = avgWake === null ? '--:--' : pad2(Math.floor(avgWake / 60)) + ':' + pad2(avgWake % 60)
    $('#avg-duration').textContent = avgDuration ? (Math.round(avgDuration / 6) / 10).toFixed(1) + ' 小时' : '--'

    $('#week-count').textContent = '本周打卡 ' + week.length + ' 天'

    const done = {}
    list.forEach((record) => {
      done[record.day] = true
    })

    let cursor = sleepDayOf(now)
    if (!done[cursor]) {
      cursor = sleepDayOf(addDays(now, -1))
    }
    let streak = 0
    let ts = new Date(cursor + 'T00:00:00').getTime()
    while (done[dateKey(ts)]) {
      streak += 1
      ts = addDays(ts, -1)
    }
    $('#streak').textContent = '连续 ' + streak + ' 天'

    renderHeatmap()

    const fact = $('#fact')
    if (week.length < 3) {
      fact.textContent = '本周记录满 3 天后可查看回顾'
    } else {
      const afterMidnight = week.filter((record) => minutesOf(record.bedAt) < 360).length
      let text =
        '本周你记录了 ' + week.length + ' 次睡眠，平均 ' +
        $('#avg-bed').textContent + ' 入睡、' + $('#avg-wake').textContent + ' 起床，平均 ' +
        fmtDuration(avgDuration) + '。'
      if (afterMidnight > 0) {
        text += '有 ' + afterMidnight + ' 天在 0 点后入睡。'
      }
      fact.textContent = text
    }
  }

  function levelOf(minutes) {
    if (!minutes) return 0
    if (minutes < 360) return 1
    if (minutes < 420) return 2
    if (minutes < 480) return 3
    if (minutes < 540) return 4
    return 5
  }

  function renderHeatmap() {
    const days = state.range
    const end = startOfDay(Date.now())
    const start = addDays(end, -(days - 1))
    const lead = (new Date(start).getDay() + 6) % 7
    const grid = $('#heatmap')
    grid.textContent = ''

    const weekLabels = ['一', '二', '三', '四', '五', '六', '日']
    const week = $('#heat-week')
    week.textContent = ''
    weekLabels.forEach((label) => {
      const span = document.createElement('span')
      span.textContent = label
      week.appendChild(span)
    })

    for (let i = 0; i < lead; i += 1) {
      const cell = document.createElement('div')
      cell.className = 'heat-cell pad'
      grid.appendChild(cell)
    }

    for (let i = 0; i < days; i += 1) {
      const ts = addDays(start, i)
      const key = dateKey(ts)
      const record = state.records[key]
      const cell = document.createElement('div')
      cell.className = 'heat-cell l' + (record ? levelOf(record.durationMin) : 0)
      cell.title = key + (record ? ' · ' + fmtDuration(record.durationMin) : ' · 未打卡')
      cell.addEventListener('click', () => {
        toast(record ? key.slice(5) + ' · ' + fmtDuration(record.durationMin) : key.slice(5) + ' · 未打卡')
      })
      grid.appendChild(cell)
    }
  }

  $$('.seg-item[data-range]').forEach((button) => {
    button.addEventListener('click', () => {
      state.range = Number(button.dataset.range)
      $$('.seg-item[data-range]').forEach((item) => item.classList.toggle('on', item === button))
      renderHeatmap()
    })
  })

  $('#fill-demo').addEventListener('click', () => {
    const today = startOfDay(Date.now())
    for (let i = 1; i <= 16; i += 1) {
      const dayTs = addDays(today, -i)
      const key = dateKey(dayTs)
      if (state.records[key]) continue
      const bedHour = i % 4 === 0 ? 22 : 23
      const bed = new Date(dayTs)
      bed.setHours(bedHour, 22 + ((i * 7) % 30), 0, 0)
      const wake = new Date(bed.getTime() + (390 + ((i * 13) % 90)) * 60000)
      state.records[key] = {
        day: key,
        bedAt: bed.getTime(),
        wakeAt: wake.getTime(),
        durationMin: Math.round((wake.getTime() - bed.getTime()) / 60000)
      }
    }
    writeJson(RECORDS_KEY, state.records)
    renderHome()
    renderStats()
    toast('已填充最近 16 天演示记录')
  })

  /* ---------------- 环境音 ---------------- */

  const FALLBACK_TRACKS = [
    {
      id: 'sleep-10001',
      title: '环境音 01',
      subtitle: '循环播放 · 支持锁屏',
      category: '环境音',
      url: 'https://img.qfmaster.com/sleep/sleep-10001.mp3'
    }
  ]

  async function loadTracks() {
    try {
      const res = await fetch('/api/config', { credentials: 'same-origin' })
      if (!res.ok) throw new Error('bad response')
      const data = await res.json()
      state.tracks = Array.isArray(data.audio) && data.audio.length ? data.audio : FALLBACK_TRACKS
      if (data.copy) state.copy = Object.assign({}, state.copy, data.copy)
      if (data.unlock && Number(data.unlock.ttlHours) > 0) {
        state.unlockHours = Number(data.unlock.ttlHours)
      }
    } catch (e) {
      state.tracks = FALLBACK_TRACKS
    }

    state.categories = ['全部']
    state.tracks.forEach((track) => {
      if (track.category && state.categories.indexOf(track.category) < 0) {
        state.categories.push(track.category)
      }
    })

    renderCategories()
    renderTracks()
  }

  function renderCategories() {
    const box = $('#audio-cats')
    box.textContent = ''
    state.categories.forEach((category) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'cat' + (state.category === category ? ' on' : '')
      button.textContent = category
      button.addEventListener('click', () => {
        state.category = category
        renderCategories()
        renderTracks()
      })
      box.appendChild(button)
    })
  }

  function visibleTracks() {
    const keyword = state.keyword.trim().toLowerCase()
    return state.tracks.filter((track) => {
      if (state.category !== '全部' && track.category !== state.category) return false
      if (!keyword) return true
      return (track.title + ' ' + track.subtitle + ' ' + track.category).toLowerCase().indexOf(keyword) >= 0
    })
  }

  function isUnlocked() {
    return (Number(localStorage.getItem(UNLOCK_KEY)) || 0) > Date.now()
  }

  function renderTracks() {
    const list = visibleTracks()
    const box = $('#audio-list')
    box.textContent = ''
    $('#audio-empty').hidden = list.length > 0

    list.forEach((track) => {
      const row = document.createElement('div')
      row.className = 'audio-row' + (state.current && state.current.id === track.id ? ' on' : '')

      const orb = document.createElement('div')
      orb.className = 'audio-orb'
      orb.textContent = (track.category || '音').slice(0, 1)

      const main = document.createElement('div')
      main.className = 'audio-main'

      const titleRow = document.createElement('div')
      titleRow.className = 'audio-title-row'
      const title = document.createElement('span')
      title.className = 'audio-title'
      title.textContent = track.title
      const cat = document.createElement('span')
      cat.className = 'audio-cat'
      cat.textContent = track.category || '环境音'
      titleRow.appendChild(title)
      titleRow.appendChild(cat)

      const sub = document.createElement('span')
      sub.className = 'audio-sub'
      sub.textContent = track.subtitle || '循环播放 · 支持锁屏'

      main.appendChild(titleRow)
      main.appendChild(sub)

      const status = document.createElement('span')
      status.className = 'audio-state'
      if (state.current && state.current.id === track.id) {
        status.textContent = isUnlocked() ? '播放中' : '已选'
        status.classList.add('playing')
      } else {
        status.textContent = isUnlocked() ? '播放' : '需解锁'
      }

      row.appendChild(orb)
      row.appendChild(main)
      row.appendChild(status)
      row.addEventListener('click', () => onTrackClick(track))

      box.appendChild(row)
    })
  }

  $('#audio-search').addEventListener('input', (event) => {
    state.keyword = event.target.value
    renderTracks()
  })

  function onTrackClick(track) {
    if (!isUnlocked()) {
      openUnlock(track)
      return
    }
    if (state.current && state.current.id === track.id) {
      togglePlay()
      return
    }
    play(track)
  }

  function play(track) {
    if (state.current && state.current.id !== track.id) {
      audio.pause()
    }
    state.current = track
    audio.src = state.audioBlocked ? FALLBACK_AUDIO : track.url
    audio.play().then(() => {
      $('#player').hidden = false
      $('#player-title').textContent = track.title
      $('#player-sub').textContent = '循环播放'
      $('#player-toggle').textContent = '暂停'
      renderTracks()
    }).catch(() => {
      toast('播放失败，检查音频地址')
    })
  }

  function togglePlay() {
    if (!state.current) return
    if (audio.paused) {
      audio.play().catch(() => toast('播放失败'))
      $('#player-toggle').textContent = '暂停'
      $('#player-sub').textContent = '播放中'
    } else {
      audio.pause()
      $('#player-toggle').textContent = '播放'
      $('#player-sub').textContent = '已暂停'
    }
  }

  $('#player-toggle').addEventListener('click', togglePlay)

  $('#player-close').addEventListener('click', () => {
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
    state.current = null
    $('#player').hidden = true
    renderTracks()
  })

  function openUnlock(track) {
    state.pendingTrack = track
    $('#unlock-title').textContent = state.copy.unlockTitle
    $('#unlock-desc').textContent = state.copy.unlockDesc
    $('#unlock-confirm').textContent = '观看广告（演示 5 秒）'
    $('#unlock-confirm').disabled = false
    $('#unlock-cancel').disabled = false
    $('#unlock-modal').hidden = false

    // 广告还没开始就先预加载，模拟“看广告时同步缓存”
    audio.preload = 'auto'
    audio.src = state.audioBlocked ? FALLBACK_AUDIO : track.url
    audio.load()
    setCacheStatus('已开始预加载：' + track.title)
  }

  function closeUnlock() {
    if (state.adTimer) return
    state.pendingTrack = null
    $('#unlock-modal').hidden = true
  }

  $('#modal-mask').addEventListener('click', closeUnlock)
  $('#unlock-cancel').addEventListener('click', closeUnlock)

  $('#unlock-confirm').addEventListener('click', () => {
    if (state.adTimer || !state.pendingTrack) return

    const button = $('#unlock-confirm')
    $('#unlock-cancel').disabled = true
    button.disabled = true

    let left = 5
    const tick = () => {
      if (left <= 0) {
        clearInterval(state.adTimer)
        state.adTimer = null
        localStorage.setItem(
          UNLOCK_KEY,
          String(Date.now() + state.unlockHours * 60 * 60 * 1000)
        )
        const track = state.pendingTrack
        state.pendingTrack = null
        $('#unlock-modal').hidden = true
        renderTracks()
        toast('已解锁，' + state.unlockHours + ' 小时内有效')
        play(track)
        return
      }
      button.textContent = '广告 ' + left + ' 秒'
      left -= 1
    }

    tick()
    state.adTimer = setInterval(tick, 1000)
  })

  function setCacheStatus(text) {
    $('#cache-status').textContent = text
  }

  audio.addEventListener('progress', () => {
    if (!audio.duration || !audio.buffered.length) return
    const pct = Math.min(100, Math.round((audio.buffered.end(0) / audio.duration) * 100))
    setCacheStatus('已加载 ' + pct + '%（浏览器预加载，演示用）')
  })

  audio.addEventListener('canplaythrough', () => {
    setCacheStatus('当前音频已就绪，可直接播放')
  })

  audio.addEventListener('error', () => {
    if (!state.audioBlocked) {
      state.audioBlocked = true
      setCacheStatus('COS 防盗链拦截了带 Referer 的请求，演示页已切换到本地测试音')
      toast('COS 防盗链拦截，已切换本地演示音')
      const target = state.current || state.pendingTrack
      if (target) {
        audio.src = FALLBACK_AUDIO
        if (state.current) {
          audio.play().catch(() => {})
        }
      }
      return
    }
    setCacheStatus('音频加载失败，检查网络')
  })

  audio.addEventListener('ended', () => {
    $('#player-sub').textContent = '循环播放'
  })

  /* ---------------- 标签页 ---------------- */

  let audioInited = false

  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach((item) => item.classList.toggle('on', item === tab))
      $$('.tab-panel').forEach((panel) => {
        panel.hidden = panel.id !== 'tab-' + tab.dataset.tab
      })

      if (tab.dataset.tab === 'stats') renderStats()
      if (tab.dataset.tab === 'audio') {
        if (!audioInited) {
          audioInited = true
          loadTracks().then(() => {
            if (state.tracks[0]) {
              audio.preload = 'auto'
              audio.src = state.audioBlocked ? FALLBACK_AUDIO : state.tracks[0].url
              audio.load()
              setCacheStatus('正在预加载第一条：' + state.tracks[0].title)
            }
          })
        }
      }
    })
  })

  /* ---------------- 启动 ---------------- */

  renderHome()
  renderStats()

  setInterval(() => {
    if (!$('#tab-home').hidden) renderHome()
  }, 30000)
})()
