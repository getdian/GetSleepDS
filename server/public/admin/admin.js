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
    preview: null,
    queriedOpenid: ''
  }

  let toastTimer = null
  let confirmTimer = null

  const loginView = $('#login-view')
  const appView = $('#app-view')
  const topbar = $('#topbar')
  const form = $('#config-form')
  const audioList = $('#audio-list')
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
    unlock: { title: '广告与解锁', sub: '激励视频、有效期与失败降级', badge: '变现' },
    features: { title: '功能与缓存', sub: '开关、预加载、容量与有效期', badge: '运行' },
    copy: { title: '解锁文案', sub: '抽屉里的标题、说明与按钮', badge: '文案' },
    users: { title: '用户数据', sub: '按 openid 查询与删除云端记录', badge: '客服 / 合规' },
    storage: { title: '存储与上传', sub: 'COS 凭证、加密保存与连通性测试', badge: '安全' },
    advanced: { title: '配置 JSON', sub: '只读检查当前下发的完整配置', badge: '只读' }
  }

  function showPanel(name) {
    const meta = PANEL_META[name] || PANEL_META.overview
    $$('.admin-panel').forEach(function (panel) {
      panel.hidden = panel.dataset.panel !== name
    })
    $$('.side-item').forEach(function (item) {
      item.classList.toggle('is-active', item.dataset.panel === name)
    })
    $('#workspace-title').textContent = meta.title
    $('#workspace-sub').textContent = meta.sub
    $('#workspace-badge').textContent = meta.badge
    const configPanel = name === 'audio' || name === 'unlock' || name === 'features' || name === 'copy'
    $('#global-savebar').hidden = !configPanel
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

    renderTrend(data.trend)
    renderTopTracks(data.topTracks)
    renderTopSources(data.topSources)
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

    return {
      audio: audio,
      unlock: {
        mode: $('#unlock-mode').value,
        adUnitId: $('#ad-unit').value.trim(),
        ttlHours: Number($('#ttl').value),
        onAdError: $('#ad-error').value
      },
      features: {
        summary: $('#feat-summary').checked,
        sync: $('#feat-sync').checked,
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
    if (jsonView.hidden) return
    jsonView.textContent = JSON.stringify(collect(), null, 2)
  }

  function render() {
    const config = state.config

    $('#unlock-mode').value = config.unlock.mode
    $('#ad-unit').value = config.unlock.adUnitId || ''
    $('#ttl').value = config.unlock.ttlHours
    $('#ad-error').value = config.unlock.onAdError || 'grant'

    $('#feat-summary').checked = config.features.summary !== false
    $('#feat-sync').checked = config.features.sync !== false
    $('#feat-timer').checked = config.features.timer !== false
    $('#feat-preload').checked = config.features.preload !== false

    $('#cache-max').value = (config.cache && config.cache.maxMB) || 80
    $('#cache-ttl').value = (config.cache && config.cache.ttlDays) || 7

    $('#copy-title').value = config.copy.unlockTitle || ''
    $('#copy-desc').value = config.copy.unlockDesc || ''
    $('#copy-confirm').value = config.copy.unlockConfirm || ''
    $('#copy-cancel').value = config.copy.unlockCancel || ''

    renderAudio(config.audio)
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
    $('#user-result').hidden = false
    $('#user-count').textContent = data.count || 0
    $('#user-openid-label').textContent = data.openid || ''
    $('#user-delete').disabled = !data.count

    const box = $('#user-records')
    box.textContent = ''
    const records = data.records || []

    if (!records.length) {
      const empty = document.createElement('div')
      empty.className = 'user-empty'
      empty.textContent = '这个 openid 还没有云端睡眠记录。'
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

    if (!window.confirm('确认删除 ' + openid + ' 的全部云端记录（睡眠 / 解锁 / 事件）？此操作不可撤销。')) return

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
      button.disabled = $('#user-result').hidden || $('#user-count').textContent === '0'
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
    loadStorage().catch(function () {})
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

  form.addEventListener('input', function () {
    setDirty(true)
    updateJson()
  })

  form.addEventListener('change', function () {
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
