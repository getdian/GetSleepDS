/**
 * 落地页动态内容：小程序码来自后台配置（config.site）。
 * 未配置或加载失败时保留占位提示，不阻塞页面。
 */
(function () {
  'use strict'

  var img = document.getElementById('mp-qr-img')
  var empty = document.getElementById('mp-qr-empty')
  var note = document.getElementById('mp-qr-note')
  if (!img || !empty) return

  function showPlaceholder() {
    img.hidden = true
    img.removeAttribute('src')
    empty.hidden = false
    // 没有码时画面上没有二维码，继续写“微信扫一扫”会让用户对着虚线框找码；
    // 改成与页脚一致的“微信搜索”，避免两套引导打架。
    empty.textContent = '微信搜索「睡点」'
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

      if (note && customNote) {
        note.textContent = customNote
      }

      if (!url) {
        showPlaceholder()
        if (note && !customNote) note.textContent = '微信搜索「睡点」'
        return
      }
      if (note && !customNote) note.textContent = '微信扫码 · 打开「睡点」'

      img.onload = function () {
        img.hidden = false
        empty.hidden = true
      }
      img.onerror = showPlaceholder
      img.src = url
    })
})()
