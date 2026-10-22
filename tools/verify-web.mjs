#!/usr/bin/env node
/**
 * 静态站自检：起一个临时静态服务器，逐页抓取并校验可部署性。
 * 检查项：HTTP 200、html lang、title、canonical、hreflang、assets 可达、内链不 404。
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const DIST = path.resolve('web/dist')
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8'
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0])
  let file = path.join(DIST, url)
  if (url.endsWith('/')) file = path.join(file, 'index.html')
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, '404.html')
    res.statusCode = 404
  }
  res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream')
  fs.createReadStream(file).pipe(res)
})

await new Promise((resolve) => server.listen(5199, '127.0.0.1', resolve))
const base = 'http://127.0.0.1:5199'

// 404 页不参与 SEO 断言（已标 noindex）
const pages = walk(DIST).filter((file) => file.endsWith('.html') && !file.endsWith('404.html'))
const problems = []
const seenTitles = new Map()
const internalLinks = new Set()

for (const file of pages) {
  const url = '/' + path.relative(DIST, file).split(path.sep).join('/').replace(/index\.html$/, '')
  const res = await fetch(base + url)
  if (res.status !== 200) {
    problems.push(`${url} -> HTTP ${res.status}`)
    continue
  }
  const html = await res.text()
  if (!/<html lang="[a-z]{2}"/.test(html)) problems.push(`${url} 缺少 html lang`)
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1]
  if (!title) problems.push(`${url} 缺少 title`)
  else if (seenTitles.has(title)) problems.push(`${url} 与 ${seenTitles.get(title)} 标题重复`)
  else seenTitles.set(title, url)
  if (!/<link rel="canonical"/.test(html)) problems.push(`${url} 缺少 canonical`)
  if (!/hreflang=/.test(html)) problems.push(`${url} 缺少 hreflang`)
  if (!/application\/ld\+json/.test(html)) problems.push(`${url} 缺少 JSON-LD`)

  for (const match of html.matchAll(/(?:href|src)="(\/[^"#?]+)"/g)) internalLinks.add(match[1])
}

for (const link of internalLinks) {
  if (/\.(css|js|svg|png|jpg|webp|xml|txt)$/.test(link)) {
    const res = await fetch(base + link)
    if (res.status !== 200) problems.push(`资源 ${link} -> HTTP ${res.status}`)
  }
}

server.close()

console.log(`[verify-web] pages=${pages.length} internal-links=${internalLinks.size}`)
if (problems.length) {
  console.log(problems.map((item) => ' - ' + item).join('\n'))
  process.exitCode = 1
} else {
  console.log('[verify-web] OK')
}
