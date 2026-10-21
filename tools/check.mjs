import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MP = path.join(ROOT, 'miniprogram')

const errors = []
const stats = { json: 0, wxml: 0, wxss: 0, pages: 0 }

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, '/')
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      walk(full, out)
    } else {
      out.push(full)
    }
  }
  return out
}

function checkJson(file) {
  try {
    JSON.parse(fs.readFileSync(file, 'utf8'))
    stats.json += 1
  } catch (error) {
    errors.push(`${rel(file)}: JSON 解析失败 ${error.message}`)
  }
}

function checkWxml(file) {
  const source = fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
  const stack = []
  const tag = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g
  let match

  while ((match = tag.exec(source))) {
    const closing = match[1] === '/'
    const name = match[2]
    const selfClosing = match[4] === '/'

    if (closing) {
      const top = stack.pop()
      if (top !== name) {
        errors.push(`${rel(file)}: </${name}> 与 <${top}> 不匹配`)
        return
      }
    } else if (!selfClosing) {
      stack.push(name)
    }
  }

  if (stack.length) errors.push(`${rel(file)}: 标签未闭合 ${stack.join(' > ')}`)

  const open = (source.match(/\{\{/g) || []).length
  const close = (source.match(/\}\}/g) || []).length
  if (open !== close) errors.push(`${rel(file)}: {{ 与 }} 数量不一致`)

  stats.wxml += 1
}

function checkWxss(file) {
  const source = fs.readFileSync(file, 'utf8')
  const open = (source.match(/\{/g) || []).length
  const close = (source.match(/\}/g) || []).length
  if (open !== close) errors.push(`${rel(file)}: 花括号数量不一致 (${open}/${close})`)
  stats.wxss += 1
}

function exists(file) {
  return fs.existsSync(file)
}

// 1. JSON / WXML / WXSS 基础校验
for (const file of walk(MP)) {
  if (file.endsWith('.json')) checkJson(file)
  if (file.endsWith('.wxml')) checkWxml(file)
  if (file.endsWith('.wxss')) checkWxss(file)
}
checkJson(path.join(ROOT, 'project.config.json'))

// 2. 页面四件套
const appJson = JSON.parse(fs.readFileSync(path.join(MP, 'app.json'), 'utf8'))
appJson.pages.forEach((page) => {
  stats.pages += 1
  for (const ext of ['js', 'json', 'wxml', 'wxss']) {
    const file = path.join(MP, `${page}.${ext}`)
    if (!exists(file)) errors.push(`缺少页面文件 ${rel(file)}`)
  }
})

// 3. tabBar 图标
if (!appJson.tabBar || !Array.isArray(appJson.tabBar.list)) {
  errors.push('app.json 缺少 tabBar')
} else {
  appJson.tabBar.list.forEach((item) => {
    for (const key of ['iconPath', 'selectedIconPath']) {
      if (item[key] && !exists(path.join(MP, item[key]))) {
        errors.push(`tabBar 图标不存在 ${item[key]}`)
      }
    }
  })
}

// 3b. tabBar.custom=true 时，每个 tab 页必须声明并挂载 custom-tab-bar。
// 原生底栏已被关闭，漏挂载会导致整个底部导航消失（曾实际发生）。
if (appJson.tabBar && appJson.tabBar.custom === true) {
  const customBase = path.join(MP, 'custom-tab-bar', 'index')
  if (!exists(customBase + '.js') || !exists(customBase + '.wxml')) {
    errors.push('tabBar.custom=true 但缺少 custom-tab-bar/index.{js,wxml}')
  }
  const tabPages = Array.isArray(appJson.tabBar.list) ? appJson.tabBar.list : []
  tabPages.forEach((item) => {
    const pageBase = path.join(MP, item.pagePath)
    const jsonPath = pageBase + '.json'
    const wxmlPath = pageBase + '.wxml'
    if (!exists(jsonPath) || !exists(wxmlPath)) return
    // custom-tab-bar 是微信的特殊组件：由 miniprogram/custom-tab-bar 目录自动注册，
    // 不能写进 usingComponents（会按普通组件解析并报 wx://not-found）。
    // 这里只校验组件文件和页面 wxml 的挂载。
    const source = fs.readFileSync(wxmlPath, 'utf8')
    if (!/<custom-tab-bar[\s/>]/.test(source)) {
      errors.push(`${item.pagePath}.wxml 未挂载 <custom-tab-bar />`)
    }
  })
}

// 4. 自定义组件引用
for (const file of walk(MP)) {
  if (!file.endsWith('.json')) continue
  let config
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    continue
  }
  const components = config.usingComponents || {}
  for (const [name, target] of Object.entries(components)) {
    const base = target.startsWith('/')
      ? path.join(MP, target)
      : path.resolve(path.dirname(file), target)
    if (!exists(base + '.js') || !exists(base + '.wxml')) {
      errors.push(`${rel(file)}: 组件 ${name} 路径无效 (${target})`)
    }
  }
}

// 5. 静态资源引用
for (const file of walk(MP)) {
  if (!file.endsWith('.wxml')) continue
  const source = fs.readFileSync(file, 'utf8')
  const assets = source.match(/\/assets\/[\w./-]+\.(png|jpg|svg)/g) || []
  assets.forEach((asset) => {
    if (!exists(path.join(MP, asset))) errors.push(`${rel(file)}: 资源不存在 ${asset}`)
  })
}

const ICONS = ['rain', 'wave', 'fire', 'noise', 'night']
ICONS.forEach((name) => {
  if (!exists(path.join(MP, 'assets', `icon-${name}.png`))) {
    errors.push(`缺少音频图标 icon-${name}.png`)
  }
})

// 7. 后台静态资源与 CSP 约束（不允许 inline 事件）
const ADMIN_DIR = path.join(ROOT, 'server', 'public', 'admin')
for (const name of ['index.html', 'admin.css', 'admin.js']) {
  if (!exists(path.join(ADMIN_DIR, name))) errors.push(`缺少后台文件 server/public/admin/${name}`)
}
const adminHtml = fs.readFileSync(path.join(ADMIN_DIR, 'index.html'), 'utf8')
for (const ref of ['admin.css', 'admin.js']) {
  if (!adminHtml.includes(`./${ref}`)) errors.push(`后台页面未引用 ${ref}`)
}
if (/\son[a-z]+\s*=\s*["']/i.test(adminHtml)) {
  errors.push('后台页面存在 inline 事件，会被 CSP 拦截')
}

// 6. 体积粗算（主包）
let bytes = 0
for (const file of walk(MP)) bytes += fs.statSync(file).size

const kb = (bytes / 1024).toFixed(1)

if (errors.length) {
  console.error('检查未通过：')
  errors.forEach((message) => console.error(' -', message))
  process.exit(1)
}

console.log(
  `检查通过：${stats.pages} 个页面 / ${stats.json} 个 JSON / ${stats.wxml} 个 WXML / ` +
  `${stats.wxss} 个 WXSS，主包约 ${kb} KB`
)
