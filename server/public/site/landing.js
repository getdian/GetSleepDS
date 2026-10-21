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

      if (note && site.mpQrNote) {
        note.textContent = site.mpQrNote
      }

      if (!url) {
        showPlaceholder()
        return
      }

      img.onload = function () {
        img.hidden = false
        empty.hidden = true
      }
      img.onerror = showPlaceholder
      img.src = url
    })
})()
