(function () {
  'use strict'

  const $ = function (selector, root) {
    return (root || document).querySelector(selector)
  }
  const $$ = function (selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector))
  }

  // 同一毫秒内连续新增两项时，纯 Date.now() 会生成重复 ID，服务端保存必报“ID 重复”
  function uniqueId(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
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
    mini: { title: '小程序与提醒', sub: '订阅消息模板、跳转路径与运行环境', badge: '通知' },
    copy: { title: '解锁文案', sub: '抽屉里的标题、说明与按钮', badge: '文案' },
    landing: { title: '落地页', sub: '落地页展示的小程序码与引导文案', badge: '内容' },
    web: { title: '国际站', sub: '站点品牌、订阅入口、AdSense 与分析 ID', badge: '出海' },
    feedback: { title: '用户反馈', sub: '建议、想听的音乐与问题反馈', badge: '客服' },
    users: { title: '用户数据', sub: '按 openid 查询与删除云端记录', badge: '客服 / 合规' },
    audit: { title: '操作日志', sub: '配置保存、删除用户与上传的留痕', badge: '审计' },
    security: { title: '安全', sub: '后台密码与登录会话', badge: '安全' },
    storage: { title: '存储与上传', sub: 'COS 凭证、加密保存与连通性测试', badge: '安全' },
    advanced: { title: '配置 JSON', sub: '只读检查当前下发的完整配置', badge: '只读' }
  }

  function isConfigPanel(name) {
    return (
      name === 'audio' ||
      name === 'backgrounds' ||
      name === 'unlock' ||
      name === 'features' ||
      name === 'copy' ||
      name === 'landing' ||
      name === 'web'
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
    if (name === 'audit') {
      // 审计只写不读时无法对账：进面板即拉一次，失败给出可见错误
      loadAudit().catch(function () {})
    }
    if (name === 'mini') {
      // 环境状态来自 .env，只读；进面板时拉一次，避免把密钥回显到页面
      loadEnvStatus().catch(function () {})
    }
    if (name === 'security') {
      // 密码来源与上次修改时间只读展示，进面板时拉一次
      loadSecurity().catch(function () {})
    }
    if (name === 'feedback') {
      // 反馈是运营的低频巡检项：进面板即拉一次，失败在列表里给可见错误
      loadFeedback().catch(function () {})
    }
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
    // 内存模式下保存只写进程内存，容器重启会回滚；必须让运营看得见
    const memory = state.meta.storage === 'memory' ? ' · 内存模式，重启后会丢失配置' : ''
    $('#source-line').textContent = source + ' · ' + updated + memory
  }

  /* ---------- 看板 ---------- */

  function renderTrend(trend) {
    const box = $('#trend')
    box.textContent = ''

    const list = trend || []
    let max = 1
    list.forEach(function (item) {
      max = Math.max(max, item.opens, item.checkins, item.plays, item.shares || 0)
    })

    const allZero = list.every(function (item) {
      return (
        item.opens === 0 &&
        item.checkins === 0 &&
        item.plays === 0 &&
        !item.interrupts &&
        !item.shares
      )
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
      col.title =
        item.day +
        ' 打开 ' + item.opens +
        ' · 打卡 ' + item.checkins +
        ' · 播放 ' + item.plays +
        ' · 分享 ' + (item.shares || 0) +
        ' · 中断 ' + (item.interrupts || 0)

      const openCount = document.createElement('span')
      openCount.className = 'trend-open'
      openCount.textContent = item.opens ? String(item.opens) : ''

      const bars = document.createElement('div')
      bars.className = 'trend-bars'

      const series = [
        ['open', item.opens],
        ['checkin', item.checkins],
        ['play', item.plays],
        ['share', item.shares || 0]
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

  const UNLOCK_FAIL_LABELS = {
    skipped: '用户未看完',
    busy: '广告忙碌',
    error: '广告加载失败',
    unavailable: '广告不可用'
  }

  function renderUnlockFailReasons(list) {
    const box = $('#unlock-fail-reasons')
    if (!box) return
    box.textContent = ''

    if (!list || !list.length) {
      const empty = document.createElement('li')
      empty.className = 'empty-line'
      empty.textContent = '还没有解锁失败数据'
      box.appendChild(empty)
      return
    }

    list.forEach(function (item) {
      const li = document.createElement('li')
      const label = document.createElement('b')
      label.textContent = UNLOCK_FAIL_LABELS[item.reason] || item.reason
      li.appendChild(label)
      li.appendChild(document.createTextNode(' · ' + item.count + ' 次'))
      box.appendChild(li)
    })
  }

  async function loadAnalytics() {
    const data = await api('/api/admin/analytics')
    const note = $('#analytics-note')
    if (note) {
      note.hidden = !data.truncated
      note.textContent = data.truncated
        ? '事件量已超过 2 万条：以下趋势与 Top 榜按最近 2 万条统计，可能偏低。'
        : ''
    }
    const today = data.today || {}
    const week = data.week || {}
    const totals = data.totals || {}

    $('#stat-opens').textContent = today.opens || 0
    $('#stat-opens-sub').textContent = '本周 ' + (week.opens || 0)
    $('#stat-checkins').textContent = today.checkins || 0
    $('#stat-checkins-sub').textContent = '本周 ' + (week.checkins || 0)
    $('#stat-manual').textContent = today.manualSleeps || 0
    $('#stat-manual-sub').textContent = '本周 ' + (week.manualSleeps || 0)
    $('#stat-plays').textContent = today.plays || 0
    // 中断次数放在播放卡副标：运营一眼看到“外部中断规模”，不新开一张卡
    $('#stat-plays-sub').textContent =
      '本周 ' + (week.plays || 0) + ' · 中断 ' + (week.interrupts || 0)
    $('#stat-users').textContent = totals.users || 0
    $('#stat-users-sub').textContent = '有效解锁 ' + (totals.activeUnlocks || 0)
    // 分享是“分享 → 打开 → 首次打卡”漏斗的分母：没有它无法判断分享动作是否有效
    $('#stat-shares').textContent = today.shares || 0
    $('#stat-shares-sub').textContent = '本周 ' + (week.shares || 0)

    const ads = data.ads || {}
    $('#stat-ad-shows').textContent = ads.todayShows || 0
    $('#stat-ad-shows-sub').textContent = '本周 ' + (ads.weekShows || 0)
    $('#stat-ad-errors').textContent = ads.todayErrors || 0
    $('#stat-ad-errors-sub').textContent = '本周 ' + (ads.weekErrors || 0)
    $('#stat-ad-fill').textContent =
      ads.fillRate === null || ads.fillRate === undefined ? '–' : ads.fillRate + '%'

    $('#stat-audio-unlocks').textContent = today.unlocks || 0
    $('#stat-audio-unlocks-sub').textContent = '本周 ' + (week.unlocks || 0)
    $('#stat-audio-fails').textContent = today.unlockFails || 0
    $('#stat-audio-fails-sub').textContent = '本周 ' + (week.unlockFails || 0)
    $('#stat-audio-fail-rate').textContent =
      data.unlockLoadFailureRate === null || data.unlockLoadFailureRate === undefined
        ? '–'
        : data.unlockLoadFailureRate + '%'

    renderTrend(data.trend)
    renderTopTracks(data.topTracks)
    renderTopSources(data.topSources)
    renderAdSlots(ads.bySlot)
    renderUnlockFailReasons(data.unlockFailReasons)
  }

  /* ---------- 环境音 ---------- */

  function buildRow(item, index, categories) {
    const fragment = $('#audio-row').content.cloneNode(true)
    const row = fragment.querySelector('.audio-row')

    row.dataset.id = item.id || ''
    row.querySelector('.index').textContent = String(index + 1).padStart(2, '0')
    row.querySelector('.title').value = item.title || ''
    row.querySelector('.subtitle').value = item.subtitle || ''
    const categoryInput = row.querySelector('.category')
    categoryInput.value = item.category || '环境音'
    row.querySelector('.url').value = item.url || ''
    row.querySelector('.icon').value = item.icon || 'noise'

    // 常用分类做成可直接点的标签：不用记名字，也不会因为输入法差异产生“环境音 ”这种脏分类
    const suggestBox = row.querySelector('.cat-suggests')
    ;(categories || []).forEach(function (name) {
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = 'cat-chip' + (categoryInput.value === name ? ' is-on' : '')
      chip.textContent = name
      chip.addEventListener('click', function () {
        categoryInput.value = name
        Array.prototype.forEach.call(suggestBox.children, function (node) {
          node.classList.toggle('is-on', node.textContent === name)
        })
        setDirty(true)
        updateJson()
      })
      suggestBox.appendChild(chip)
    })

    return row
  }

  function renumber() {
    $$('.audio-row', audioList).forEach(function (row, index) {
      row.querySelector('.index').textContent = String(index + 1).padStart(2, '0')
    })
  }

  // 常用分类：运营大多数时候只需要在这几个里选，避免每次手打、也避免同义分类分裂
  var CATEGORY_PRESETS = ['自然之声', '环境音', '白噪音', '轻音乐', '助眠音乐', '冥想']

  function refreshCategoryOptions(list) {
    const datalist = $('#category-options')
    datalist.textContent = ''
    const seen = {}

    CATEGORY_PRESETS.concat(
      (list || []).map(function (item) {
        return String((item && item.category) || '').trim()
      })
    ).forEach(function (name) {
      const category = String(name || '').trim()
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
    const categories = CATEGORY_PRESETS.slice()
    items.forEach(function (item) {
      const name = String((item && item.category) || '').trim()
      if (name && categories.indexOf(name) < 0) categories.push(name)
    })
    items.forEach(function (item, index) {
      audioList.appendChild(buildRow(item, index, categories))
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
      const option = document.createElement('option')
      option.value = item.id
      if (item.enabled === false) {
        // 停用项也保留一个 disabled option：否则 select.value 会被清空，
        // 运营只改其它字段并保存时，defaultBackgroundId 就被静默抹掉。
        option.disabled = true
        option.textContent = (item.title || item.id) + '（已停用）'
      } else {
        option.textContent = item.title || item.id
      }
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
        preload: $('#feat-preload').checked,
        feedback: $('#feat-feedback').checked
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
      },
      site: {
        mpQrCodeUrl: $('#site-qr-url').value.trim(),
        mpQrNote: $('#site-qr-note').value.trim()
      },
      web: {
        enabled: $('#web-enabled').checked,
        brand: $('#web-brand').value.trim(),
        tagline: $('#web-tagline').value.trim(),
        ctaUrl: $('#web-cta').value.trim(),
        adsenseClient: $('#web-adsense').value.trim(),
        analyticsId: $('#web-analytics').value.trim(),
        disclaimer: $('#web-disclaimer').value.trim(),
        proUrl: $('#web-pro-url').value.trim(),
        freeLimit: Number($('#web-free-limit').value)
      },
      reminder: {
        enabled: $('#reminder-enabled').checked,
        templateId: $('#reminder-template').value.trim(),
        page: $('#reminder-page').value.trim(),
        thingKey: $('#reminder-thing-key').value.trim() || 'thing1',
        timeKey: $('#reminder-time-key').value.trim() || 'time2'
      }
    }
  }

  /** 只读环境状态：AppID/Secret 是否就绪、反向代理层数、存储模式（不返回密钥值） */
  function loadEnvStatus() {
    return api('/api/admin/env').then(function (data) {
      $('#env-appid').value = data.appidConfigured ? '已配置' : '未配置'
      $('#env-secret').value = data.secretConfigured ? '已配置' : '未配置'
      $('#env-trust').value = data.trustProxy
        ? '已开启（' + data.trustProxy + ' 层）'
        : '未设置（直连）'
      $('#env-db').value = data.dbMode === 'postgres' ? 'PostgreSQL' : '内存（仅开发）'
    })
  }

  function updateJson() {
    if (jsonView.hidden || !state.config) return
    // 面板标题是“下发的 JSON”，必须展示服务端已生效的配置，
    // 而不是 collect() 里尚未保存、也未经 normalize 的表单值。
    jsonView.textContent = JSON.stringify(state.config, null, 2)
  }

  function renderSite(site) {
    const value = (site && site.mpQrCodeUrl) || ''
    $('#site-qr-url').value = value
    $('#site-qr-note').value = (site && site.mpQrNote) || ''
    const preview = $('#site-qr-preview')
    const placeholder = $('#site-qr-placeholder')
    if (value) {
      preview.src = value
      preview.hidden = false
      placeholder.hidden = true
    } else {
      preview.removeAttribute('src')
      preview.hidden = true
      placeholder.hidden = false
    }
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
    $('#feat-feedback').checked = config.features.feedback !== false

    $('#cache-max').value = (config.cache && config.cache.maxMB) || 80
    $('#cache-ttl').value = (config.cache && config.cache.ttlDays) || 7

    $('#copy-title').value = config.copy.unlockTitle || ''
    $('#copy-desc').value = config.copy.unlockDesc || ''
    $('#copy-confirm').value = config.copy.unlockConfirm || ''
    $('#copy-cancel').value = config.copy.unlockCancel || ''

    const reminder = config.reminder || {}
    $('#reminder-enabled').checked = reminder.enabled !== false
    $('#reminder-template').value = reminder.templateId || ''
    $('#reminder-page').value = reminder.page || 'pages/sleep/sleep?end=1'
    $('#reminder-thing-key').value = reminder.thingKey || 'thing1'
    $('#reminder-time-key').value = reminder.timeKey || 'time2'

    renderSite(config.site)

    const web = config.web || {}
    $('#web-enabled').checked = web.enabled !== false
    $('#web-brand').value = web.brand || 'SleepCycle'
    $('#web-tagline').value = web.tagline || ''
    $('#web-cta').value = web.ctaUrl || ''
    $('#web-adsense').value = web.adsenseClient || ''
    $('#web-analytics').value = web.analyticsId || ''
    $('#web-disclaimer').value = web.disclaimer || ''
    $('#web-pro-url').value = web.proUrl || ''
    $('#web-free-limit').value = Number.isInteger(web.freeLimit) ? web.freeLimit : 5

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
    const web = payload.web || {}
    if (web.ctaUrl && !/^https:\/\//i.test(web.ctaUrl)) {
      return '订阅入口链接必须以 https:// 开头'
    }
    if (web.adsenseClient && !/^ca-pub-\d{10,20}$/.test(web.adsenseClient)) {
      return 'AdSense 客户端 ID 形如 ca-pub-1234567890123456'
    }
    if (web.proUrl && !/^https:\/\//i.test(web.proUrl)) {
      return '订阅购买链接必须以 https:// 开头'
    }
    if (web.freeLimit !== undefined && (!Number.isInteger(web.freeLimit) || web.freeLimit < 0 || web.freeLimit > 100)) {
      return '免费保存条数需为 0–100 的整数'
    }

    const reminderTemplate = payload.reminder && payload.reminder.templateId
    if (reminderTemplate && !/^[A-Za-z0-9_-]{10,64}$/.test(reminderTemplate)) {
      return '订阅消息模板 ID 格式不正确（微信后台复制，通常 43 位）'
    }
    const reminderPage = payload.reminder && payload.reminder.page
    if (reminderPage && !/^pages\/[A-Za-z0-9_/-]+(\?[^\s]*)?$/.test(reminderPage)) {
      return '提醒跳转路径需形如 pages/sleep/sleep?end=1'
    }
    const reminderKeys = payload.reminder || {}
    const keyRe = /^[a-z]+\d{1,2}$/
    if (!keyRe.test(reminderKeys.thingKey || '') || !keyRe.test(reminderKeys.timeKey || '')) {
      return '模板字段名需形如 thing1 / time2（小写字母 + 数字）'
    }
    if (reminderKeys.thingKey === reminderKeys.timeKey) {
      return '提醒事项与提醒时间不能使用同一个字段名'
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

    const qrUrl = (payload.site && payload.site.mpQrCodeUrl) || ''
    if (qrUrl && !/^https:\/\//i.test(qrUrl)) return '小程序码地址必须是 https'
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

  /* ---------- 操作日志 ---------- */

  const AUDIT_LABELS = {
    admin_config_save: '保存配置',
    admin_delete_user_data: '删除用户云端数据',
    admin_audio_upload: '上传环境音',
    admin_background_upload: '上传背景图',
    admin_site_qrcode_upload: '上传小程序码',
    admin_password_change: '修改后台密码'
  }

  function auditDetailText(item) {
    const details = item.details || {}
    const parts = []
    if (details.version !== undefined) parts.push('版本 v' + details.version)
    if (details.audioCount !== undefined) parts.push('环境音 ' + details.audioCount + ' 条')
    if (details.backgroundCount !== undefined) parts.push('背景图 ' + details.backgroundCount + ' 张')
    if (details.deletedRecords !== undefined) parts.push('记录 ' + details.deletedRecords + ' 条')
    if (details.key) parts.push(details.key)
    if (details.title) parts.push(details.title)
    if (item.openidTag && item.openidTag !== '-') parts.push('openid ' + item.openidTag)
    return parts.join(' · ')
  }

  function renderAudit(items) {
    const box = $('#audit-list')
    if (!box) return
    box.textContent = ''

    if (!items.length) {
      const empty = document.createElement('li')
      empty.className = 'empty-line'
      empty.textContent = '还没有操作记录'
      box.appendChild(empty)
      return
    }

    items.forEach(function (item) {
      const row = document.createElement('li')
      row.className = 'audit-item'

      const time = document.createElement('span')
      time.className = 'audit-time'
      time.textContent = formatRecordTime(item.createdAt)

      const action = document.createElement('strong')
      action.className = 'audit-action'
      action.textContent = AUDIT_LABELS[item.action] || item.action

      const detail = document.createElement('span')
      detail.className = 'audit-detail'
      detail.textContent = auditDetailText(item)

      row.appendChild(time)
      row.appendChild(action)
      row.appendChild(detail)
      box.appendChild(row)
    })
  }

  async function loadAudit() {
    const box = $('#audit-list')
    if (!box) return
    box.textContent = ''
    const loading = document.createElement('li')
    loading.className = 'empty-line'
    loading.textContent = '加载中…'
    box.appendChild(loading)

    try {
      const data = await api('/api/admin/audit?limit=100')
      renderAudit(data.items || [])
    } catch (error) {
      box.textContent = ''
      const failed = document.createElement('li')
      failed.className = 'empty-line'
      failed.textContent = '加载失败：' + (error.message || '请稍后重试')
      box.appendChild(failed)
    }
  }

  /* ---------- 用户反馈 ---------- */

  const FEEDBACK_TYPES = { SUGGEST: '建议', MUSIC: '想听的音乐', ISSUE: '问题反馈' }

  function renderFeedback(data) {
    const box = $('#feedback-list')
    const badge = $('#feedback-count')
    if (!box) return
    box.textContent = ''
    if (badge) badge.textContent = String(data.unhandled || 0)

    const items = data.items || []
    if (!items.length) {
      const empty = document.createElement('div')
      empty.className = 'empty-line'
      empty.textContent = '还没有反馈'
      box.appendChild(empty)
      return
    }

    items.forEach(function (item) {
      const card = document.createElement('div')
      card.className = 'feedback-item' + (item.handledAt ? ' is-handled' : '')

      const head = document.createElement('div')
      head.className = 'feedback-head'

      const type = document.createElement('span')
      type.className = 'feedback-type'
      type.textContent = FEEDBACK_TYPES[item.type] || item.type
      head.appendChild(type)

      const time = document.createElement('span')
      time.className = 'feedback-time'
      time.textContent = formatRecordTime(item.createdAt)
      head.appendChild(time)

      if (item.handledAt) {
        const done = document.createElement('span')
        done.className = 'feedback-done'
        done.textContent = '已处理'
        head.appendChild(done)
      }

      // 正文按纯文本落 DOM（textContent）：反馈是用户输入，绝不能拼 HTML
      const body = document.createElement('p')
      body.className = 'feedback-text'
      body.textContent = item.content

      const meta = document.createElement('div')
      meta.className = 'feedback-meta'
      const openid = document.createElement('code')
      openid.textContent = item.openid
      meta.appendChild(openid)
      if (item.contact) {
        const contact = document.createElement('span')
        contact.className = 'feedback-contact'
        contact.textContent = '联系方式：' + item.contact
        meta.appendChild(contact)
      }

      const actions = document.createElement('div')
      actions.className = 'row-actions'
      if (!item.handledAt) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'ghost'
        button.textContent = '标记已处理'
        button.addEventListener('click', function () {
          markFeedbackHandled(item.id, button)
        })
        actions.appendChild(button)
      }

      card.appendChild(head)
      card.appendChild(body)
      card.appendChild(meta)
      if (actions.childNodes.length) card.appendChild(actions)
      box.appendChild(card)
    })
  }

  async function loadFeedback() {
    const box = $('#feedback-list')
    if (!box) return
    box.textContent = ''
    const loading = document.createElement('div')
    loading.className = 'empty-line'
    loading.textContent = '加载中…'
    box.appendChild(loading)

    const onlyOpen = $('#feedback-only-open') && $('#feedback-only-open').checked
    try {
      // 服务端上限 200（db.listFeedback 夹取）；面板一次性拉满，不做分页
      const data = await api('/api/admin/feedback?limit=200' + (onlyOpen ? '&onlyOpen=1' : ''))
      renderFeedback(data)
    } catch (error) {
      box.textContent = ''
      const failed = document.createElement('div')
      failed.className = 'empty-line'
      failed.textContent = '加载失败：' + (error.message || '请稍后重试')
      box.appendChild(failed)
    }
  }

  async function markFeedbackHandled(id, button) {
    if (button) button.disabled = true
    try {
      await api('/api/admin/feedback/' + id + '/handled', { method: 'POST', body: {} })
      await loadFeedback()
    } catch (error) {
      if (button) button.disabled = false
      const box = $('#feedback-list')
      if (box) {
        // 连续失败不能堆出一串同样的提示：先清掉上一条再插
        const stale = box.querySelector('.warning')
        if (stale) box.removeChild(stale)
        const failed = document.createElement('div')
        failed.className = 'warning'
        failed.textContent = '标记失败：' + (error.message || '请稍后重试')
        box.insertBefore(failed, box.firstChild)
      }
    }
  }

  /* ---------- 安全：后台密码 ---------- */

  async function loadSecurity() {
    const badge = $('#security-source')
    const note = $('#security-note')
    if (!badge || !note) return
    const data = await api('/api/admin/security')
    const fromDb = data.source === 'db'
    badge.textContent = fromDb ? '数据库' : '环境变量'
    if (!data.persistent) {
      note.textContent = '当前是内存模式：改密只在本进程内生效，重启后会回退到 .env 的密码。'
      return
    }
    note.textContent = fromDb
      ? '上次修改：' + (data.updatedAt ? new Date(data.updatedAt).toLocaleString() : '未知')
      : '当前使用 .env 的 ADMIN_PASSWORD（首次引导）。修改一次后改由数据库保存，环境变量密码不再可用。'
  }

  function setPwStatus(text, isError) {
    const status = $('#pw-status')
    if (!status) return
    status.hidden = !text
    status.textContent = text || ''
    status.classList.toggle('warning', !!isError)
  }

  async function changePassword() {
    const current = $('#pw-current').value
    const next = $('#pw-new').value
    const confirm = $('#pw-confirm').value
    const button = $('#pw-submit')

    if (!current) return setPwStatus('请输入当前密码', true)
    if (!next || next.length < 8) return setPwStatus('新密码至少 8 位', true)
    if (next.length > 64) return setPwStatus('新密码不能超过 64 位', true)
    if (next !== confirm) return setPwStatus('两次输入的新密码不一致', true)
    if (next === current) return setPwStatus('新密码不能与当前密码相同', true)

    button.disabled = true
    setPwStatus('')
    try {
      // 不走 api()：那边的 401 会直接弹登录框；这里 401 表示“当前密码不正确”，要就地提示
      const res = await fetch('/api/admin/password', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next })
      })
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
            : '修改失败（' + res.status + '）'
        setPwStatus(message, true)
        return
      }
      $('#pw-current').value = ''
      $('#pw-new').value = ''
      $('#pw-confirm').value = ''
      setPwStatus('密码已修改，所有会话已失效，正在返回登录…')
      setTimeout(function () {
        window.location.reload()
      }, 900)
    } catch (error) {
      setPwStatus('修改失败：' + (error.message || '网络异常'), true)
    } finally {
      button.disabled = false
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
      // 未配置存储时测试按钮保持禁用，避免恢复成可点后只得到 400
      button.disabled = !(state.storage && state.storage.configured)
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
              id: uniqueId('track'),
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
              id: uniqueId('bg'),
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

  /* ---------- 落地页小程序码 ---------- */

  function applyQrUrl(url) {
    $('#site-qr-url').value = url || ''
    const preview = $('#site-qr-preview')
    const placeholder = $('#site-qr-placeholder')
    if (url) {
      preview.src = url
      preview.hidden = false
      placeholder.hidden = true
    } else {
      preview.removeAttribute('src')
      preview.hidden = true
      placeholder.hidden = false
    }
  }

  function uploadQrCode(file) {
    if (!state.storage || !state.storage.configured) {
      toast('先在“存储与上传”配置 COS', true)
      return
    }

    const status = $('#qr-upload-status')
    status.hidden = false
    status.textContent = '上传中 0%'

    const data = new FormData()
    data.append('file', file, file.name || 'qrcode.png')

    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/admin/site/qrcode')
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
        applyQrUrl(body.url)
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

    loadAnalytics().catch(function (error) {
      // 不能静默留“–”：DB 异常时运营会把“加载失败”看成“今天 0 用户”。
      toast('看板加载失败：' + ((error && error.message) || '请稍后重试'), true)
    })
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
      const message = (error && error.message) || ''
      if (message === '未登录') {
        showLogin('')
      } else if (error && error.name === 'TypeError') {
        // fetch 网络层失败（Failed to fetch / 断网/端口不通）
        showLogin('无法连接后台，请确认服务已启动')
      } else {
        // 503 等业务错误直接透传（如“数据库暂时不可用”），避免误导去重启服务
        showLogin(message || '无法连接后台，请确认服务已启动')
      }
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
      id: uniqueId('track'),
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
      id: uniqueId('bg'),
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

  $('#qr-file').addEventListener('change', function (event) {
    const file = event.target.files && event.target.files[0]
    event.target.value = ''
    if (file) uploadQrCode(file)
  })

  $('#site-qr-clear').addEventListener('click', function () {
    // 与删除音频/用户同一套确认口径：清除后落地页会立刻失去扫码入口
    if (
      !window.confirm(
        '清除小程序码？\n保存后落地页与演示页都会回退为「微信搜索」，需要重新上传才能恢复。'
      )
    ) {
      return
    }
    applyQrUrl('')
    setDirty(true)
    updateJson()
    toast('已清除，保存后落地页回退为搜索提示')
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
    // 乐观并发：带上载入时的 updatedAt。服务端发现已被别人改过会返 409，
    // 而不是用这份全量表单静默覆盖对方刚保存的环境音/背景图/文案。
    payload.baseUpdatedAt = (state.meta && state.meta.updatedAt) || 0
    const problem = validatePayload(payload)
    if (problem) {
      toast(problem, true)
      return
    }

    // 背景图面板用 form 的另一个提交按钮（#bg-save）；只禁用 #save 会留下可重复点击的入口
    const buttons = [$('#save')]
    if (event.submitter && buttons.indexOf(event.submitter) === -1) {
      buttons.push(event.submitter)
    }
    buttons.forEach(function (btn) {
      btn.dataset.label = btn.textContent
      btn.disabled = true
      btn.textContent = '保存中…'
    })

    let saveFailed = false
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
      loadAnalytics().catch(function (error) {
        toast('看板加载失败：' + ((error && error.message) || '请稍后重试'), true)
      })
    } catch (e) {
      saveFailed = true
      // 409 = 别人刚保存过：继续在旧表单上重试只会连续失败，自动载入最新版本
      const conflict = e && (e.status === 409 || e.code === 'CONFLICT')
      if (conflict) {
        toast('配置已被他人修改，正在载入最新版本，请确认后重试', true)
        try {
          await loadAll()
        } catch (reloadError) {
          toast('载入最新配置失败：' + ((reloadError && reloadError.message) || '请刷新页面'), true)
        }
      } else {
        toast(e.message || '保存失败', true)
      }
    } finally {
      // 失败态留在按钮上（2.8s 的 toast 消失后用户仍能看到“失败了、可重试”）
      buttons.forEach(function (btn) {
        btn.disabled = false
        btn.textContent = saveFailed ? '保存失败 · 重试' : btn.dataset.label || '保存并生效'
        btn.classList.toggle('save-failed', saveFailed)
      })
    }
  })

  $('#audit-refresh').addEventListener('click', function () {
    loadAudit().catch(function () {})
  })
  $('#feedback-refresh').addEventListener('click', function () {
    loadFeedback().catch(function () {})
  })
  $('#feedback-only-open').addEventListener('change', function () {
    loadFeedback().catch(function () {})
  })
  $('#pw-submit').addEventListener('click', function () {
    changePassword().catch(function () {})
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
