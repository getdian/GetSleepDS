/**
 * 通用小程序码 CTA：给任何带 [data-site-qr] 的容器填充二维码。
 * 数据源与 landing.js 相同（后台 config.site.mpQrCodeUrl），未配置时回退“微信搜索「睡点」”。
 * 落地页已有自己的绑定逻辑（landing.js），这里只服务演示页等新增入口。
 */
(function () {
  'use strict'

  var boxes = document.querySelectorAll('[data-site-qr]')
  if (!boxes.length) return

  function showPlaceholder(box) {
    var img = box.querySelector('[data-qr-img]')
    var empty = box.querySelector('[data-qr-empty]')
    var note = box.querySelector('[data-qr-note]')
    if (img) {
      img.hidden = true
      img.removeAttribute('src')
    }
    if (empty) {
      empty.hidden = false
      empty.textContent = '微信搜索「睡点」'
    }
    // 没有码时不能继续写“扫码”，否则用户会对着空框找码
    if (note) note.textContent = '微信搜索「睡点」'
  }

  fetch('/api/config')
    .then(function (res) {
      return res.ok ? res.json() : null
    })
    .catch(function () {
      return null
    })
    .then(function (config) {
      var site = (config && config.site) || {}
      var url = typeof site.mpQrCodeUrl === 'string' ? site.mpQrCodeUrl.trim() : ''
      var customNote = typeof site.mpQrNote === 'string' ? site.mpQrNote.trim() : ''

      boxes.forEach(function (box) {
        var img = box.querySelector('[data-qr-img]')
        var empty = box.querySelector('[data-qr-empty]')
        var note = box.querySelector('[data-qr-note]')

        if (customNote && note) note.textContent = customNote
        if (!url || !img) {
          showPlaceholder(box)
          return
        }
        if (note && !customNote) note.textContent = '微信扫码 · 打开「睡点」'
        img.onload = function () {
          img.hidden = false
          if (empty) empty.hidden = true
        }
        img.onerror = function () {
          showPlaceholder(box)
        }
        img.src = url
      })
    })
})()
