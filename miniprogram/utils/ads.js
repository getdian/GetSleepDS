/**
 * 页面展示位：从全局配置读取 ads 写入页面 data。
 * apply() 走 10 分钟 TTL（loadConfig(false)）：缓存有效时不发请求，过期后才刷新。
 * reload() 强制拉取，供下拉刷新等运营验证场景使用。
 * 槽位是否出现完全由后台 ads[slot].enabled + unitId 决定。
 */
const { loadConfig } = require('./config')

function empty() {
  // 必须给出完整槽位字段：ad-slot 的 unitId/type 是 String 属性，
  // 传 undefined 会被基础库归一成 null 并在 console 里刷 type-uncompatible 警告。
  const slot = () => ({ enabled: false, unitId: '', type: 'template' })
  return {
    home: slot(),
    sleep: slot(),
    stats: slot(),
    statsFooter: slot()
  }
}

function apply(page) {
  const app = getApp()
  const set = (cfg) => {
    if (app && app.globalData) app.globalData.config = cfg
    if (page && page._alive && cfg && cfg.ads) page.setData({ ads: cfg.ads })
  }

  // 先用已加载的全局配置渲染，避免首帧空窗
  const config = app && app.globalData ? app.globalData.config : null
  if (config && config.ads) set(config)

  const refresh = () => {
    loadConfig(false).then(set).catch(() => {})
  }
  const ready = app && app.globalData ? app.globalData.configReady : null
  if (ready && ready.then) ready.then(refresh).catch(() => {})
  else refresh()
}

/** 强制刷新配置（绕过 10 分钟 TTL） */
function reload(page) {
  return loadConfig(true)
    .then((cfg) => {
      const app = getApp()
      if (app && app.globalData) app.globalData.config = cfg
      if (page && page._alive && cfg && cfg.ads) page.setData({ ads: cfg.ads })
      return cfg
    })
    .catch(() => null)
}

module.exports = { empty, apply, reload }
