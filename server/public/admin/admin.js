(function () {
  'use strict'

  const $ = function (selector, root) {
    return (root || document).querySelector(selector)
  }
  const $$ = function (selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector))
  }

  const state = {
    config: null,
    meta: { source: 'file', updatedAt: 0, storage: 'memory' },
    storage: null,
    dirty: false,
    panel: 'overview',
    preview: null,
    queriedOpenid: '',
    userHasData: false
  }

  let toastTimer = null
  let confirmTimer = null
  let bgConfirmTimer = null

  const loginView = $('#login-view')
  const appView = $('#app-view')
  const topbar = $('#topbar')
  const form = $('#config-form')
  const audioList = $('#audio-list')
  const bgList = $('#bg-list')
  const jsonView = $('#json-view')

  /* ---------- 基础工具 ---------- */

  function toast(message, isError) {
    const node = $('#toast')
    node.textContent = message
    node.classList.toggle('error', !!isError)
    node.hidden = false
    clearTimeout(toastTimer)
    toastTimer = setTimeout(function () {
      node.hidden = true
    }, 2800)
  }

  function setDirty(value) {
    state.dirty = value
    const node = $('#dirty')
    const side = $('#side-save-state')
    if (node) {
      node.textContent = value ? '有未保存的修改' : '已保存'
      node.classList.toggle('warn', value)
    }
    if (side) side.textContent = value ? '有未保存的修改' : '已保存'
    updateSavebar()
  }

  async function api(path, options) {
    const opts = options || {}
    const init = {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: {}
    }

    if (opts.body !== undefined) {
      init.headers['content-type'] = 'application/json'
      init.body = JSON.stringify(opts.body)
    }

    const res = await fetch(path, init)

    if (res.status === 401 && path !== '/api/admin/login') {
      showLogin('登录已过期，请重新登录')
      throw new Error('未登录')
    }

    let data = null
    try {
      data = await res.json()
    } catch (e) {
      data = null
    }

    if (!res.ok) {
      const message =
        data && data.error && data.error.message
          ? data.error.message
          : '请求失败（' + res.status + '）'
      throw new Error(message)
    }

    return data || {}
  }

  /* ---------- 视图切换 ---------- */

  function showLogin(message) {
    stopPreview()
    state.config = null
    state.queriedOpenid = ''
    const userResult = $('#user-result')
    if (userResult) userResult.hidden = true
    const userInput = $('#user-openid')
    if (userInput) userInput.value = ''
    $('#boot-view').hidden = true
    loginView.hidden = false
    appView.hidden = true
    topbar.hidden = true

    const error = $('#login-error')
    error.hidden = !message
    error.textContent = message || ''

    $('#password').value = ''
    setTimeout(function () {
      $('#password').focus()
    }, 30)
  }

  function showApp() {
    $('#boot-view').hidden = true
    loginView.hidden = true
    appView.hidden = false
    topbar.hidden = false
    showPanel('overview')
  }

  const PANEL_META = {
    overview: { title: '概览', sub: '今天的打开、打卡、播放与 14 天趋势', badge: '实时' },
    audio: { title: '环境音', sub: '上架、排序、分类、试听与缓存', badge: '内容' },
    backgrounds: { title: '背景图', sub: '首页 Hero 背景、默认图与广告解锁', badge: '内容' },
    unlock: { title: '广告与解锁', sub: '激励视频、页面展示位与失败降级', badge: '变现' },
    features: { title: '功能与缓存', sub: '开关、预加载、容量与有效期', badge: '运行' },
    copy: { title: '解锁文案', sub: '抽屉里的标题、说明与按钮', badge: '文案' },
    users: { title: '用户数据', sub: '按 openid 查询与删除云端记录', badge: '客服 / 合规' },
    storage: { title: '存储与上传', sub: 'COS 凭证、加密保存与连通性测试', badge: '安全' },
    advanced: { title: '配置 JSON', sub: '只读检查当前下发的完整配置', badge: '只读' }
  }

  function isConfigPanel(name) {
    return (
      name === 'audio' ||
      name === 'backgrounds' ||
      name === 'unlock' ||
      name === 'features' ||
      name === 'copy'
    )
  }

  /**
   * 脏状态下保存条必须在所有面板可见。
   * 窄屏下 .side-foot 会被隐藏，如果这里也隐藏 savebar，
   * 运营切到“概览/用户数据”后就完全看不到“有未保存的修改”。
   */
  function updateSavebar() {
    const name = state.panel || 'overview'
    $('#global-savebar').hidden = !isConfigPanel(name) && !state.dirty
  }

  function showPanel(name) {
    const meta = PANEL_META[name] || PANEL_META.overview
    state.panel = name
    $$('.admin-panel').forEach(function (panel) {
      panel.hidden = panel.dataset.panel !== name
    })
    $$('.side-item').forEach(function (item) {
      item.classList.toggle('is-active', item.dataset.panel === name)
    })
    $('#workspace-title').textContent = meta.title
    $('#workspace-sub').textContent = meta.sub
    $('#workspace-badge').textContent = meta.badge
    updateSavebar()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function initAdminNav() {
    $$('.side-item').forEach(function (item) {
      item.addEventListener('click', function () {
        showPanel(item.dataset.panel)
      })
    })
  }

  function updateMeta() {
    const source = state.meta.source === 'db' ? '数据库' : '配置文件'
    const updated = state.meta.updatedAt
      ? new Date(state.meta.updatedAt).toLocaleString('zh-CN', { hour12: false })
      : '尚未在后台保存'
    $('#source-line').textContent = source + ' · ' + updated
  }

  /* ---------- 看板 ---------- */

  function renderTrend(trend) {
    const box = $('#trend')
    box.textContent = ''

    const list = trend || []
    let max = 1
    list.forEach(function (item) {
      max = Math.max(max, item.opens, item.checkins, item.plays)
    })

    const allZero = list.every(function (item) {
      return item.opens === 0 && item.checkins === 0 && item.plays === 0
    })

    if (!list.length || allZero) {
      const empty = document.createElement('div')
      empty.className = 'trend-empty'
      empty.textContent = '还没有事件数据。小程序启动、打卡、播放后会自动上报'
      box.appendChild(empty)
      return
    }

    list.forEach(function (item) {
      const col = document.createElement('div')
      col.className = 'trend-col'
      col.title = item.day + ' 打开 ' + item.opens + ' · 打卡 ' + item.checkins + ' · 播放 ' + item.plays

      const openCount = document.createElement('span')
      openCount.className = 'trend-open'
      openCount.textContent = item.opens ? String(item.opens) : ''

      const bars = document.createElement('div')
      bars.className = 'trend-bars'

      const series = [
        ['open', item.opens],
        ['checkin', item.checkins],
        ['play', item.plays]
      ]

      series.forEach(function (entry) {
        const bar = document.createElement('span')
        bar.className = 'trend-bar ' + entry[0]
        bar.style.height = Math.max(2, Math.round((entry[1] / max) * 92)) + 'px'
        bars.appendChild(bar)
      })

      const day = document.createElement('span')
      day.className = 'trend-day'
      day.textContent = item.day.slice(5)

      col.appendChild(openCount)
      col.appendChild(bars)
      col.appendChild(day)
      box.appendChild(col)
    })
  }

  function renderTopTracks(list) {
    const box = $('#top-tracks')
    box.textContent = ''

    if (!list || !list.length) {
      const empty = document.createElement('li')
      empty.className = 'empty-line'
      empty.textContent = '还没有播放数据'
      box.appendChild(empty)
      return
    }

    list.forEach(function (item) {
      const li = document.createElement('li')
      const name = document.createElement('b')
      name.textContent = item.title
      li.appendChild(name)
      li.appendChild(document.createTextNode(' · ' + item.plays + ' 次'))
      box.appendChild(li)
    })
  }

  // 常见启动 scene 的可读标签；未识别的显示原始码
  const SCENE_LABELS = {
    1001: '发现栏',
    1005: '顶部搜索框',
    1006: '搜一搜结果',
    1007: '会话卡片',
    1008: '群聊卡片',
    1011: '扫一扫',
    1035: '公众号菜单',
    1036: '公众号文章',
    1037: '来自其他小程序',
    1044: '群聊卡片',
    1047: '小程序码',
    1154: '朋友圈（单页）'
  }

  function sceneLabel(code) {
    return SCENE_LABELS[code] || 'scene ' + code
  }

  function renderTopSources(list) {
    const box = $('#top-sources')
    box.textContent = ''

    if (!list || !list.length) {
      const empty = document.createElement('li')
      empty.className = 'empty-line'
      empty.textContent = '还没有来源数据'
      box.appendChild(empty)
      return
    }

    list.forEach(function (item) {
      const li = document.createElement('li')
      const parts = String(item.source || 'unknown').split('|')
      const label = document.createElement('b')
      label.textContent = sceneLabel(parts[0])
      li.appendChild(label)
      if (parts[1]) {
        li.appendChild(document.createTextNode(' · ' + parts[1]))
      }
      if (parts[2]) {
        li.appendChild(document.createTextNode('（' + parts[2] + '）'))
      }
      li.appendChild(document.createTextNode(' — ' + item.opens + ' 次'))
      box.appendChild(li)
    })
  }

  const AD_SLOT_LABELS = {
    home: '首页最下方',
    sleep: '入睡页',
    stats: '统计页内容下方',
    statsFooter: '统计页最下方'
  }

  function renderAdSlots(list) {
    const box = $('#ad-slots')
    if (!box) return
    box.textContent = ''

    if (!list || !list.length) {
      const empty = document.createElement('li')
      empty.className = 'empty-line'
      empty.textContent = '还没有展示位数据（广告加载成功后上报 ad_show）'
      box.appendChild(empty)
      return
    }

    list.forEach(function (item) {
      const li = document.createElement('li')
      const label = document.createElement('b')
      label.textContent = AD_SLOT_LABELS[item.slot] || item.slot
      li.appendChild(label)
      li.appendChild(document.createTextNode(' · 展示 ' + item.shows + ' / 失败 ' + item.errors))
      box.appendChild(li)
    })
  }

  async function loadAnalytics() {
    const data = await api('/api/admin/analytics')
    const today = data.today || {}
    const week = data.week || {}
    const totals = data.totals || {}

    $('#stat-opens').textContent = today.opens || 0
    $('#stat-opens-sub').textContent = '本周 ' + (week.opens || 0)
    $('#stat-checkins').textContent = today.checkins || 0
    $('#stat-checkins-sub').textContent = '本周 ' + (week.checkins || 0)
    $('#stat-plays').textContent = today.plays || 0
    $('#stat-plays-sub').textContent = '本周 ' + (week.plays || 0)
    $('#stat-users').textContent = totals.users || 0
    $('#stat-users-sub').textContent = '有效解锁 ' + (totals.activeUnlocks || 0)

    const ads = data.ads || {}
    $('#stat-ad-shows').textContent = ads.todayShows || 0
    $('#stat-ad-shows-sub').textContent = '本周 ' + (ads.weekShows || 0)
    $('#stat-ad-errors').textContent = ads.todayErrors || 0
    $('#stat-ad-errors-sub').textContent = '本周 ' + (ads.weekErrors || 0)
    $('#stat-ad-fill').textContent =
      ads.fillRate === null || ads.fillRate === undefined ? '–' : ads.fillRate + '%'

    renderTrend(data.trend)
    renderTopTracks(data.topTracks)
    renderTopSources(data.topSources)
    renderAdSlots(ads.bySlot)
  }

  /* ---------- 环境音 ---------- */

  function buildRow(item, index) {
    const fragment = $('#audio-row').content.cloneNode(true)
    const row = fragment.querySelector('.audio-row')

    row.dataset.id = item.id || ''
    row.querySelector('.index').textContent = String(index + 1).padStart(2, '0')
    row.querySelector('.title').value = item.title || ''
    row.querySelector('.subtitle').value = item.subtitle || ''
    row.querySelector('.category').value = item.category || '环境音'
    row.querySelector('.url').value = item.url || ''
    row.querySelector('.icon').value = item.icon || 'noise'

    return row
  }

  function renumber() {
    $$('.audio-row', audioList).forEach(function (row, index) {
      row.querySelector('.index').textContent = String(index + 1).padStart(2, '0')
    })
  }

  function refreshCategoryOptions(list) {
    const datalist = $('#category-options')
    datalist.textContent = ''
    const seen = {}

    ;(list || []).forEach(function (item) {
      const category = String(item.category || '').trim()
      if (!category || seen[category]) return
      seen[category] = true
      const option = document.createElement('option')
      option.value = category
      datalist.appendChild(option)
    })
  }

  function renderAudio(list) {
    audioList.textContent = ''
    const items = list || []
    items.forEach(function (item, index) {
      audioList.appendChild(buildRow(item, index))
    })
    $('#audio-empty').hidden = items.length > 0
    refreshCategoryOptions(items)
  }

  /* ---------- 背景图 ---------- */

  function refreshBgCategoryOptions(list) {
    const datalist = $('#bg-category-options')
    if (!datalist) return
    datalist.textContent = ''
    const seen = {}
    ;(list || []).forEach(function (item) {
      const category = String(item.category || '').trim()
      if (!category || seen[category]) return
      seen[category] = true
      const option = document.createElement('option')
      option.value = category
      datalist.appendChild(option)
    })
  }

  function buildBgRow(item, index) {
    const fragment = $('#bg-row').content.cloneNode(true)
    const row = fragment.querySelector('.bg-row')
    row.dataset.id = item.id || ''
    row.querySelector('.bg-title').value = item.title || ''
    row.querySelector('.bg-category').value = item.category || '夜色'
    row.querySelector('.bg-url').value = item.url || ''
    row.querySelector('.bg-enabled').checked = item.enabled !== false
    const preview = row.querySelector('.bg-preview')
    if (item.url) preview.src = item.url
    preview.alt = item.title || ''
    return row
  }

  function refreshBgDefaultOptions(list, selected) {
    const select = $('#bg-default')
    if (!select) return
    select.textContent = ''
    const empty = document.createElement('option')
    empty.value = ''
    empty.textContent = '不使用默认背景'
    select.appendChild(empty)
    ;(list || []).forEach(function (item) {
      if (item.enabled === false) return
      const option = document.createElement('option')
      option.value = item.id
      option.textContent = item.title || item.id
      select.appendChild(option)
    })
    select.value = selected || ''
  }

  function renderBackgrounds(list, defaultId) {
    if (!bgList) return
    bgList.textContent = ''
    const items = list || []
    items.forEach(function (item, index) {
      bgList.appendChild(buildBgRow(item, index))
    })
    $('#bg-empty').hidden = items.length > 0
    refreshBgDefaultOptions(items, defaultId)
    refreshBgCategoryOptions(items)
  }

  function stopPreview() {
    if (!state.preview) return
    state.preview.audio.pause()
    state.preview.button.textContent = '试听'
    state.preview = null
  }

  function resetConfirm() {
    clearTimeout(confirmTimer)
    $$('.audio-row', audioList).forEach(function (row) {
      if (row.dataset.confirm !== '1') return
      row.dataset.confirm = ''
      const button = row.querySelector('.remove')
      if (!button) return
      button.classList.remove('confirming')
      button.textContent = '✕'
    })
  }

  function togglePreview(row, button) {
    const url = row.querySelector('.url').value.trim()

    if (!/^https:\/\//i.test(url)) {
      toast('音频地址必须是 https', true)
      return
    }

    if (state.preview && state.preview.url === url) {
      if (state.preview.audio.paused) {
        state.preview.audio.play().then(function () {
          button.textContent = '暂停'
        }).catch(function () {
          toast('播放失败，检查地址是否可访问', true)
        })
      } else {
        state.preview.audio.pause()
        button.textContent = '试听'
      }
      return
    }

    stopPreview()

    const audio = new Audio(url)
    state.preview = { url: url, audio: audio, button: button }
    button.textContent = '播放中'

    audio.addEventListener('ended', function () {
      button.textContent = '试听'
    })
    audio.addEventListener('error', function () {
      toast('播放失败，检查地址是否可访问', true)
      stopPreview()
    })

    audio.play().catch(function () {
      toast('播放失败，检查地址是否可访问', true)
      stopPreview()
    })
  }

  /* ---------- 表单读写 ---------- */

  function collect() {
    const audio = $$('.audio-row', audioList).map(function (row) {
      return {
        id: row.dataset.id,
        title: row.querySelector('.title').value.trim(),
        subtitle: row.querySelector('.subtitle').value.trim(),
        category: row.querySelector('.category').value.trim(),
        url: row.querySelector('.url').value.trim(),
        icon: row.querySelector('.icon').value
      }
    })

    const adSlots = ['home', 'sleep', 'stats', 'statsFooter']
    const ads = {}
    adSlots.forEach(function (slot) {
      ads[slot] = {
        enabled: $('#ad-' + slot + '-enabled').checked,
        unitId: $('#ad-' + slot + '-unit').value.trim(),
        type: $('#ad-' + slot + '-type').value
      }
    })

    const backgrounds = $$('.bg-row', bgList).map(function (row) {
      return {
        id: row.dataset.id,
        title: row.querySelector('.bg-title').value.trim(),
        category: row.querySelector('.bg-category').value.trim(),
        url: row.querySelector('.bg-url').value.trim(),
        enabled: row.querySelector('.bg-enabled').checked
      }
    })

    return {
      audio: audio,
      unlock: {
        mode: $('#unlock-mode').value,
        adUnitId: $('#ad-unit').value.trim(),
        ttlHours: Number($('#ttl').value),
        onAdError: $('#ad-error').value
      },
      ads: ads,
      backgrounds: backgrounds,
      defaultBackgroundId: $('#bg-default').value,
      backgroundUnlockHours: Number($('#bg-unlock-hours').value),
      features: {
        summary: $('#feat-summary').checked,
        sync: $('#feat-sync').checked,
        events: $('#feat-events').checked,
        timer: $('#feat-timer').checked,
        preload: $('#feat-preload').checked
      },
      cache: {
        maxMB: Number($('#cache-max').value),
        ttlDays: Number($('#cache-ttl').value)
      },
      copy: {
        unlockTitle: $('#copy-title').value.trim(),
        unlockDesc: $('#copy-desc').value.trim(),
        unlockConfirm: $('#copy-confirm').value.trim(),
        unlockCancel: $('#copy-cancel').value.trim()
      }
    }
  }

  function updateJson() {
    if (jsonView.hidden || !state.config) return
    // 面板标题是“下发的 JSON”，必须展示服务端已生效的配置，
    // 而不是 collect() 里尚未保存、也未经 normalize 的表单值。
    jsonView.textContent = JSON.stringify(state.config, null, 2)
  }

  function render() {
    const config = state.config

    $('#unlock-mode').value = config.unlock.mode
    $('#ad-unit').value = config.unlock.adUnitId || ''
    $('#ttl').value = config.unlock.ttlHours
    $('#ad-error').value = config.unlock.onAdError || 'grant'

    ;['home', 'sleep', 'stats', 'statsFooter'].forEach(function (slot) {
      const item = (config.ads && config.ads[slot]) || {}
      $('#ad-' + slot + '-enabled').checked = item.enabled === true
      $('#ad-' + slot + '-unit').value = item.unitId || ''
      $('#ad-' + slot + '-type').value = item.type === 'banner' ? 'banner' : 'template'
    })

    $('#feat-summary').checked = config.features.summary !== false
    $('#feat-sync').checked = config.features.sync !== false
    $('#feat-events').checked = config.features.events !== false
    $('#feat-timer').checked = config.features.timer !== false
    $('#feat-preload').checked = config.features.preload !== false

    $('#cache-max').value = (config.cache && config.cache.maxMB) || 80
    $('#cache-ttl').value = (config.cache && config.cache.ttlDays) || 7

    $('#copy-title').value = config.copy.unlockTitle || ''
    $('#copy-desc').value = config.copy.unlockDesc || ''
    $('#copy-confirm').value = config.copy.unlockConfirm || ''
    $('#copy-cancel').value = config.copy.unlockCancel || ''

    renderAudio(config.audio)
    renderBackgrounds(config.backgrounds || [], config.defaultBackgroundId || '')
    $('#bg-unlock-hours').value = config.backgroundUnlockHours || 24
    updateMeta()
    updateJson()
    setDirty(false)
  }

  function validatePayload(payload) {
    for (let i = 0; i < payload.audio.length; i += 1) {
      const item = payload.audio[i]
      if (!item.title) return '第 ' + (i + 1) + ' 条环境音缺少名称'
      if (!/^https:\/\//i.test(item.url)) return '第 ' + (i + 1) + ' 条环境音地址必须是 https'
    }
    if (!Number.isInteger(payload.unlock.ttlHours) || payload.unlock.ttlHours < 1 || payload.unlock.ttlHours > 168) {
      return '解锁有效期需为 1–168 小时的整数'
    }
    if (!Number.isInteger(payload.cache.maxMB) || payload.cache.maxMB < 20 || payload.cache.maxMB > 200) {
      return '缓存上限需为 20–200MB'
    }
    if (!Number.isInteger(payload.cache.ttlDays) || payload.cache.ttlDays < 1 || payload.cache.ttlDays > 30) {
      return '缓存有效期需为 1–30 天'
    }
    const adSlots = ['home', 'sleep', 'stats', 'statsFooter']
    for (let i = 0; i < adSlots.length; i += 1) {
      const item = payload.ads && payload.ads[adSlots[i]]
      if (item && item.enabled && !item.unitId) return '已启用的展示位必须填写广告位 ID'
    }

    const backgrounds = payload.backgrounds || []
    if (backgrounds.length > 20) return '最多 20 张背景图'
    for (let i = 0; i < backgrounds.length; i += 1) {
      const item = backgrounds[i]
      if (!item.title) return '第 ' + (i + 1) + ' 张背景图缺少名称'
      if (!/^https:\/\//i.test(item.url)) return '第 ' + (i + 1) + ' 张背景图地址必须是 https'
    }
    if (
      !Number.isInteger(payload.backgroundUnlockHours) ||
      payload.backgroundUnlockHours < 1 ||
      payload.backgroundUnlockHours > 168
    ) {
      return '背景图解锁时长需为 1–168 小时的整数'
    }
    if (payload.defaultBackgroundId) {
      const defaultBg = backgrounds.filter(function (item) {
        return item.id === payload.defaultBackgroundId
      })[0]
      if (!defaultBg) return '默认背景图不在列表中'
      if (defaultBg.enabled === false) return '默认背景图已停用，请先启用或换一张'
    }
    return ''
  }

  /* ---------- 用户数据 ---------- */

  function formatRecordTime(value) {
    const ts = Number(value)
    if (!Number.isFinite(ts) || ts <= 0) return '—'
    const date = new Date(ts)
    const pad = function (n) {
      return n < 10 ? '0' + n : String(n)
    }
    return (
      date.getMonth() + 1 + '月' + date.getDate() + '日 ' +
      pad(date.getHours()) + ':' + pad(date.getMinutes())
    )
  }

  function renderUser(data) {
    state.queriedOpenid = data.openid || ''
    const count = Number(data.count) || 0
    const unlockExpireAt = Number(data.unlockExpireAt) || 0
    const eventCount = Number(data.eventCount) || 0
    const activeUnlock = unlockExpireAt > Date.now()
    state.userHasData = count > 0 || activeUnlock || eventCount > 0

    $('#user-result').hidden = false
    $('#user-count').textContent = count
    $('#user-openid-label').textContent = data.openid || ''
    const extra = $('#user-extra')
    if (extra) {
      const erasedAt = Number(data.erasedAt) || 0
      const deletedDayCount = Number(data.deletedDayCount) || 0
      extra.textContent =
        '解锁 ' +
        (activeUnlock ? '有效（' + formatRecordTime(unlockExpireAt) + ' 到期）' : '无') +
        ' · 事件 ' +
        eventCount +
        ' 条 · 清除水位 ' +
        (erasedAt ? formatRecordTime(erasedAt) : '无') +
        ' · 墓碑 ' +
        deletedDayCount +
        ' 天'
    }
    // 即使当前没有云端数据，也要允许写入全量清除水位；
    // 这是“用户要求以后也不再上传旧记录”的唯一后台入口。
    $('#user-delete').disabled = false

    const box = $('#user-records')
    box.textContent = ''
    const records = data.records || []

    if (!records.length) {
      const empty = document.createElement('div')
      empty.className = 'user-empty'
      empty.textContent = state.userHasData
        ? '没有云端睡眠记录，但仍有解锁或事件数据。'
        : '这个 openid 没有任何云端数据。'
      box.appendChild(empty)
      return
    }

    records.forEach(function (record) {
      const row = document.createElement('div')
      row.className = 'user-record'

      const day = document.createElement('strong')
      day.textContent = record.day || '—'

      const bed = document.createElement('span')
      bed.textContent = '入睡 ' + formatRecordTime(record.bedAt)

      const wake = document.createElement('span')
      wake.textContent = '起床 ' + formatRecordTime(record.wakeAt)

      const duration = document.createElement('span')
      duration.className = 'num'
      duration.textContent = (record.durationMin || 0) + ' 分钟'

      row.appendChild(day)
      row.appendChild(bed)
      row.appendChild(wake)
      row.appendChild(duration)
      box.appendChild(row)
    })
  }

  async function queryUser() {
    const openid = $('#user-openid').value.trim()
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(openid)) {
      toast('请输入正确的 openid', true)
      return
    }

    const button = $('#user-query')
    button.disabled = true
    $('#user-msg').textContent = '查询中…'
    try {
      const data = await api('/api/admin/users/' + encodeURIComponent(openid))
      renderUser(data)
      $('#user-msg').textContent = '查询完成，仅显示云端记录。'
    } catch (error) {
      $('#user-result').hidden = true
      state.userHasData = false
      $('#user-msg').textContent = ''
      toast(error.message || '查询失败', true)
    } finally {
      button.disabled = false
    }
  }

  async function deleteUser() {
    const openid = $('#user-openid').value.trim()
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(openid)) {
      toast('请先查询要删除的 openid', true)
      return
    }
    if (!state.queriedOpenid || openid !== state.queriedOpenid) {
      toast('输入已变化，请先重新查询确认', true)
      return
    }

    if (
      !window.confirm(
        '确认删除 ' + openid + ' 的全部云端数据（睡眠 / 解锁 / 事件）？\n' +
          '这会写入全量清除水位：用户下次同步时，本机旧睡眠记录也会被清除，且不可恢复。'
      )
    ) {
      return
    }

    const button = $('#user-delete')
    button.disabled = true
    try {
      const result = await api('/api/admin/users/' + encodeURIComponent(openid) + '/records', {
        method: 'DELETE'
      })
      toast('已删除 ' + (result.deleted || 0) + ' 条云端记录')
      await queryUser()
    } catch (error) {
      toast(error.message || '删除失败', true)
    } finally {
      button.disabled = $('#user-result').hidden
    }
  }

  /* ---------- COS 存储 ---------- */

  function renderStorage(settings) {
    state.storage = settings
    $('#cos-bucket').value = settings.bucket || ''
    $('#cos-region').value = settings.region || ''
    $('#cos-domain').value = settings.domain || ''
    $('#cos-prefix').value = settings.prefix || 'sleep'
    $('#cos-secret-id').value = settings.secretId || ''
    $('#cos-secret-key').value = ''

    const badge = $('#storage-badge')
    badge.textContent = settings.configured ? '已配置' : '未配置'
    badge.className = 'badge' + (settings.configured ? ' ok' : '')

    $('#security-warning').hidden = !!settings.securityReady
    $('#storage-save').disabled = !settings.securityReady
    $('#storage-test').disabled = !settings.configured

    if (settings.secretBroken) {
      $('#storage-msg').textContent = '密钥无法解密（可能更换过 ADMIN_PASSWORD / CONFIG_SECRET），请重新填写 SecretKey'
    } else {
      $('#storage-msg').textContent = ''
    }
  }

  async function loadStorage() {
    const settings = await api('/api/admin/storage')
    renderStorage(settings)
  }

  async function saveStorage() {
    const button = $('#storage-save')
    button.disabled = true
    try {
      const settings = await api('/api/admin/storage', {
        method: 'PUT',
        body: {
          bucket: $('#cos-bucket').value.trim(),
          region: $('#cos-region').value.trim(),
          domain: $('#cos-domain').value.trim(),
          prefix: $('#cos-prefix').value.trim(),
          secretId: $('#cos-secret-id').value.trim(),
          secretKey: $('#cos-secret-key').value
        }
      })
      renderStorage(settings)
      toast('COS 配置已保存')
    } catch (error) {
      toast(error.message || '保存失败', true)
    } finally {
      button.disabled = !(state.storage && state.storage.securityReady)
    }
  }

  async function testStorage() {
    const button = $('#storage-test')
    const msg = $('#storage-msg')
    button.disabled = true
    msg.textContent = '测试中…'
    try {
      const result = await api('/api/admin/storage/test', { method: 'POST' })
      msg.textContent = '连接成功：' + result.bucket
      toast('COS 连接正常')
    } catch (error) {
      msg.textContent = ''
      toast(error.message || '连接失败', true)
    } finally {
      button.disabled = false
    }
  }

  /* ---------- 上传 ---------- */

  function uploadAudio(file) {
    if ($$('.audio-row', audioList).length >= 10) {
      toast('最多 10 条环境音', true)
      return
    }
    if (!state.storage || !state.storage.configured) {
      toast('先在下方配置 COS 存储', true)
      return
    }

    const status = $('#upload-status')
    status.hidden = false
    status.textContent = '上传中 0%'

    const data = new FormData()
    data.append('file', file)
    data.append('title', file.name.replace(/\.[^.]+$/, '').slice(0, 30))
    data.append('category', '环境音')

    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/admin/audio/upload')
    xhr.withCredentials = true

    xhr.upload.onprogress = function (event) {
      if (!event.lengthComputable) return
      status.textContent = '上传中 ' + Math.round((event.loaded / event.total) * 100) + '%'
    }

    xhr.onload = function () {
      let body = null
      try {
        body = JSON.parse(xhr.responseText)
      } catch (e) {
        body = null
      }

      status.hidden = true

      if (xhr.status === 401) {
        showLogin('登录已过期，请重新登录')
        return
      }

      if (xhr.status >= 200 && xhr.status < 300 && body) {
        audioList.appendChild(
          buildRow(
            {
              id: 'track-' + Date.now().toString(36),
              title: body.title || '新环境音',
              subtitle: '循环播放 · 支持锁屏',
              category: body.category || '环境音',
              url: body.url,
              icon: 'noise'
            },
            $$('.audio-row', audioList).length
          )
        )
        $('#audio-empty').hidden = true
        renumber()
        refreshCategoryOptions(collect().audio)
        setDirty(true)
        updateJson()
        toast('上传完成，记得点“保存并生效”')
        return
      }

      const message =
        body && body.error && body.error.message ? body.error.message : '上传失败（' + xhr.status + '）'
      toast(message, true)
    }

    xhr.onerror = function () {
      status.hidden = true
      toast('上传失败，请检查网络', true)
    }

    xhr.send(data)
  }

  function readImage(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader()
      reader.onload = function () {
        const image = new Image()
        image.onload = function () {
          resolve(image)
        }
        image.onerror = reject
        image.src = reader.result
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  // 浏览器端压缩：jpg/png/webp → 最大 1440×1920、webp 0.82；失败或更大时回退原图
  function prepareBackgroundImage(file) {
    const type = String(file.type || '').toLowerCase()
    if (!/^image\/(jpeg|png|webp)$/.test(type)) {
      return Promise.resolve({ file: file, fileName: file.name, compressed: false, displayName: file.name })
    }

    return readImage(file)
      .then(function (image) {
        const maxWidth = 1440
        const maxHeight = 1920
        const sourceWidth = image.naturalWidth || image.width
        const sourceHeight = image.naturalHeight || image.height
        const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight)
        const width = Math.max(1, Math.round(sourceWidth * scale))
        const height = Math.max(1, Math.round(sourceHeight * scale))

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        canvas.getContext('2d').drawImage(image, 0, 0, width, height)

        return new Promise(function (resolve) {
          canvas.toBlob(
            function (blob) {
              if (!blob || blob.type !== 'image/webp') {
                resolve({ file: file, fileName: file.name, compressed: false, displayName: file.name })
                return
              }
              // 原图已经很小且 webp 反而更大时，不折腾
              if (scale === 1 && blob.size >= file.size && file.size <= 1024 * 1024) {
                resolve({ file: file, fileName: file.name, compressed: false, displayName: file.name })
                return
              }

              const base = String(file.name || 'background').replace(/\.[^.]+$/, '')
              const fileName = base + '.webp'
              let output = blob
              try {
                output = new File([blob], fileName, { type: 'image/webp', lastModified: Date.now() })
              } catch (e) {
                output = blob
              }

              resolve({
                file: output,
                fileName: fileName,
                compressed: true,
                displayName: base,
                width: width,
                height: height,
                size: blob.size
              })
            },
            'image/webp',
            0.82
          )
        })
      })
      .catch(function () {
        return { file: file, fileName: file.name, compressed: false, displayName: file.name }
      })
  }

  function uploadBackground(file) {
    if ($$('.bg-row', bgList).length >= 20) {
      toast('最多 20 张背景图', true)
      return
    }
    if (!state.storage || !state.storage.configured) {
      toast('先在“存储与上传”配置 COS', true)
      return
    }

    const status = $('#bg-upload-status')
    status.hidden = false

    const keepOriginal = !!($('#bg-keep-original') && $('#bg-keep-original').checked)
    if (keepOriginal) {
      status.textContent = '上传中 0%'
      uploadBackgroundFile(
        {
          file: file,
          fileName: file.name,
          compressed: false,
          keepOriginal: true,
          displayName: file.name
        },
        status
      )
      return
    }

    status.textContent = '压缩中…'
    prepareBackgroundImage(file).then(function (prepared) {
      uploadBackgroundFile(prepared, status)
    })
  }

  function uploadBackgroundFile(prepared, status) {
    const file = prepared.file
    const fileName = prepared.fileName || file.name || 'background.webp'
    status.textContent = '上传中 0%'

    const data = new FormData()
    data.append('file', file, fileName)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/admin/backgrounds/upload')
    xhr.withCredentials = true

    xhr.upload.onprogress = function (event) {
      if (!event.lengthComputable) return
      status.textContent = '上传中 ' + Math.round((event.loaded / event.total) * 100) + '%'
    }

    xhr.onload = function () {
      let body = null
      try {
        body = JSON.parse(xhr.responseText)
      } catch (e) {
        body = null
      }

      status.hidden = true

      if (xhr.status === 401) {
        showLogin('登录已过期，请重新登录')
        return
      }

      if (xhr.status >= 200 && xhr.status < 300 && body && body.url) {
        const name = String(prepared.displayName || fileName).replace(/\.[^.]+$/, '').slice(0, 30)
        bgList.appendChild(
          buildBgRow(
            {
              id: 'bg-' + Date.now().toString(36),
              title: name || '新背景',
              category: '夜色',
              url: body.url,
              enabled: true
            },
            $$('.bg-row', bgList).length
          )
        )
        $('#bg-empty').hidden = true
        const rows = collect().backgrounds
        refreshBgCategoryOptions(rows)
        refreshBgDefaultOptions(rows, $('#bg-default').value)
        setDirty(true)
        updateJson()
        const sizeText = prepared.size ? ' · ' + Math.round(prepared.size / 1024) + 'KB' : ''
        const prefix = prepared.compressed
          ? '已压缩为 webp' + sizeText
          : prepared.keepOriginal
            ? '已按原图上传'
            : '上传完成'
        toast(prefix + '，记得点“保存并生效”')
        return
      }

      const message =
        body && body.error && body.error.message ? body.error.message : '上传失败（' + xhr.status + '）'
      toast(message, true)
    }

    xhr.onerror = function () {
      status.hidden = true
      toast('上传失败，请检查网络', true)
    }

    xhr.send(data)
  }

  /* ---------- 数据加载 ---------- */

  async function loadAll() {
    const data = await api('/api/admin/config')
    state.config = data.config
    state.meta = {
      source: data.source,
      updatedAt: data.updatedAt,
      storage: data.storage
    }
    render()
    showApp()

    loadAnalytics().catch(function () {})
    loadStorage().catch(function (error) {
      // 存储面板失败时不能静默留空表单，否则容易被误当成“尚未配置”而重填凭证。
      toast('存储配置加载失败：' + (error.message || '请稍后重试'), true)
    })
  }

  async function boot() {
    try {
      const session = await api('/api/admin/session')
      if (session.authenticated) {
        await loadAll()
      } else {
        showLogin()
      }
    } catch (error) {
      showLogin(error.message === '未登录' ? '' : '无法连接后台，请确认服务已启动')
    }
  }

  /* ---------- 事件 ---------- */

  $('#login-form').addEventListener('submit', async function (event) {
    event.preventDefault()
    const button = $('#login-btn')
    const error = $('#login-error')

    button.disabled = true
    error.hidden = true

    try {
      await api('/api/admin/login', {
        method: 'POST',
        body: { password: $('#password').value }
      })
      await loadAll()
      toast('已登录')
    } catch (e) {
      error.textContent = e.message || '登录失败'
      error.hidden = false
    } finally {
      button.disabled = false
    }
  })

  $('#logout').addEventListener('click', async function () {
    try {
      await api('/api/admin/logout', { method: 'POST' })
    } catch (e) {
      // 本地直接回登录页
    }
    showLogin()
  })

  $('#refresh').addEventListener('click', async function () {
    if (state.dirty && !window.confirm('有未保存的修改，刷新会丢弃，继续？')) return
    try {
      await loadAll()
      toast('已刷新')
    } catch (e) {
      toast(e.message || '刷新失败', true)
    }
  })

  $('#add-audio').addEventListener('click', function () {
    resetConfirm()
    const rows = $$('.audio-row', audioList)
    if (rows.length >= 10) {
      toast('最多 10 条环境音', true)
      return
    }

    const item = {
      id: 'track-' + Date.now().toString(36),
      title: '新环境音',
      subtitle: '循环播放 · 支持锁屏',
      category: '环境音',
      url: '',
      icon: 'noise'
    }

    audioList.appendChild(buildRow(item, rows.length))
    $('#audio-empty').hidden = true
    setDirty(true)
    updateJson()
    audioList.lastElementChild.querySelector('.title').focus()
  })

  $('#audio-file').addEventListener('change', function (event) {
    const file = event.target.files && event.target.files[0]
    event.target.value = ''
    if (file) uploadAudio(file)
  })

  $('#add-bg').addEventListener('click', function () {
    const rows = $$('.bg-row', bgList)
    if (rows.length >= 20) {
      toast('最多 20 张背景图', true)
      return
    }
    const item = {
      id: 'bg-' + Date.now().toString(36),
      title: '新背景',
      category: '夜色',
      url: '',
      enabled: true
    }
    bgList.appendChild(buildBgRow(item, rows.length))
    $('#bg-empty').hidden = true
    const list = collect().backgrounds
    refreshBgCategoryOptions(list)
    refreshBgDefaultOptions(list, $('#bg-default').value)
    setDirty(true)
    updateJson()
    bgList.lastElementChild.querySelector('.bg-title').focus()
  })

  $('#bg-file').addEventListener('change', function (event) {
    const file = event.target.files && event.target.files[0]
    event.target.value = ''
    if (file) uploadBackground(file)
  })

  bgList.addEventListener('click', function (event) {
    const button = event.target.closest('button')
    if (!button) return
    const row = button.closest('.bg-row')
    if (!row) return

    if (button.classList.contains('remove')) {
      if (row.dataset.confirm !== '1') {
        row.dataset.confirm = '1'
        button.classList.add('confirming')
        button.textContent = '确认'
        clearTimeout(bgConfirmTimer)
        bgConfirmTimer = setTimeout(function () {
          row.dataset.confirm = ''
          button.classList.remove('confirming')
          button.textContent = '✕'
        }, 3000)
        return
      }
      row.remove()
      $('#bg-empty').hidden = $$('.bg-row', bgList).length > 0
      const list = collect().backgrounds
      refreshBgCategoryOptions(list)
      refreshBgDefaultOptions(list, $('#bg-default').value)
      setDirty(true)
      updateJson()
      return
    }

    if (button.classList.contains('up') || button.classList.contains('down')) {
      const isUp = button.classList.contains('up')
      const sibling = isUp ? row.previousElementSibling : row.nextElementSibling
      if (!sibling) return
      if (isUp) bgList.insertBefore(row, sibling)
      else bgList.insertBefore(sibling, row)
      setDirty(true)
      updateJson()
    }
  })

  audioList.addEventListener('click', function (event) {
    const button = event.target.closest('button')
    if (!button) return

    const row = button.closest('.audio-row')
    if (!row) return

    if (button.classList.contains('remove')) {
      if (audioList.children.length <= 1) {
        toast('至少要保留 1 条环境音', true)
        return
      }

      if (row.dataset.confirm !== '1') {
        resetConfirm()
        row.dataset.confirm = '1'
        button.classList.add('confirming')
        button.textContent = '确认'
        clearTimeout(confirmTimer)
        confirmTimer = setTimeout(resetConfirm, 3500)
        return
      }

      if (state.preview && state.preview.button === button) stopPreview()
      row.remove()
      renumber()
      resetConfirm()
      setDirty(true)
      updateJson()
      return
    }

    resetConfirm()

    if (button.classList.contains('up') || button.classList.contains('down')) {
      const isUp = button.classList.contains('up')
      const sibling = isUp ? row.previousElementSibling : row.nextElementSibling
      if (!sibling) return
      if (isUp) audioList.insertBefore(row, sibling)
      else audioList.insertBefore(sibling, row)
      renumber()
      setDirty(true)
      updateJson()
      return
    }

    if (button.classList.contains('preview')) {
      togglePreview(row, button)
    }
  })

  function isUploadOnly(target) {
    return !!target && target.id === 'bg-keep-original'
  }

  form.addEventListener('input', function (event) {
    if (isUploadOnly(event.target)) return
    setDirty(true)
    updateJson()
  })

  form.addEventListener('change', function (event) {
    if (isUploadOnly(event.target)) return
    // 停用某张背景图时，默认图下拉必须同步移除该选项，
    // 否则表单仍会提交一个已停用的 id，服务端只能拒绝或客户端静默回退。
    if (event.target.classList && event.target.classList.contains('bg-enabled')) {
      refreshBgDefaultOptions(collect().backgrounds, $('#bg-default').value)
    }
    setDirty(true)
    updateJson()
  })

  form.addEventListener('submit', async function (event) {
    event.preventDefault()

    resetConfirm()
    if (state.preview) stopPreview()

    const payload = collect()
    const problem = validatePayload(payload)
    if (problem) {
      toast(problem, true)
      return
    }

    const button = $('#save')
    button.disabled = true
    button.textContent = '保存中…'

    try {
      const data = await api('/api/admin/config', { method: 'PUT', body: payload })
      state.config = data.config
      state.meta = {
        source: data.source,
        updatedAt: data.updatedAt,
        storage: data.storage
      }
      render()
      toast('已保存，重新打开小程序即可生效')
      loadAnalytics().catch(function () {})
    } catch (e) {
      toast(e.message || '保存失败', true)
    } finally {
      button.disabled = false
      button.textContent = '保存并生效'
    }
  })

  $('#storage-save').addEventListener('click', saveStorage)
  $('#storage-test').addEventListener('click', testStorage)
  $('#user-query').addEventListener('click', queryUser)
  $('#user-delete').addEventListener('click', deleteUser)
  $('#user-openid').addEventListener('input', function () {
    // 改过 openid 后，删除按钮必须重新查询才能再启用，避免误删另一用户
    state.queriedOpenid = ''
    state.userHasData = false
    $('#user-delete').disabled = true
  })
  $('#user-openid').addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      event.preventDefault()
      queryUser()
    }
  })

  $('#toggle-json').addEventListener('click', function () {
    jsonView.hidden = !jsonView.hidden
    $('#toggle-json').textContent = jsonView.hidden ? '查看 JSON' : '收起 JSON'
    updateJson()
  })

  window.addEventListener('beforeunload', function (event) {
    if (!state.dirty) return
    event.preventDefault()
    event.returnValue = ''
  })

  initAdminNav()
  boot()
})()
