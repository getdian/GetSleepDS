/**
 * 文档配图检查：
 * 1) 文档里**明确写出路径**的图片必须真实存在（防止删图后留下死链——曾发生过删组件导致整页空白）；
 * 2) docs/assets 下的图片必须被文档提到（防止中间态截图越积越多）。
 *
 * 引用口径：markdown 嵌入 ![](x.png)、反引号路径（`docs/assets/x.png`）、裸文件名（l4-home.png）都算。
 * 通配/枚举写法（l4-*.png、a{1,2}.png）只作文档描述，不做存在性判定。
 * 与 tools/check.mjs 一起跑：npm run check
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const ASSETS_DIR = path.join(ROOT, 'docs', 'assets')
const IMG_EXT = '(?:png|jpg|jpeg|gif|webp)'
const REF_RE = new RegExp(
  '!\\[[^\\]]*\\]\\(([^)\\s]+' + IMG_EXT + ')\\)|' +
  '`([^`]*' + IMG_EXT + ')`|' +
  '((?:docs|server|miniprogram|web)/[\\w./-]+' + IMG_EXT + ')|' +
  '(\\b[\\w-]+' + IMG_EXT + ')',
  'g'
)
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'web'])

const mdFiles = []
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name) || entry.name === 'assets') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (/\.md$/i.test(entry.name)) mdFiles.push(full)
  }
}
walk(ROOT)

const isWildcard = (ref) => /[*?{}<>,|]/.test(ref)

function resolveRef(fromFile, ref) {
  const clean = ref.split('#')[0].trim()
  if (!clean || /^https?:/.test(clean)) return null
  const candidates = [
    path.resolve(path.dirname(fromFile), clean),
    path.resolve(ROOT, clean),
    path.resolve(ASSETS_DIR, path.basename(clean))
  ]
  return candidates.find((p) => fs.existsSync(p)) || null
}

const referenced = new Set()
const dead = []
for (const file of mdFiles) {
  const text = fs.readFileSync(file, 'utf8')
  let match
  REF_RE.lastIndex = 0
  while ((match = REF_RE.exec(text))) {
    const raw = (match[1] || match[2] || match[3] || match[4] || '').trim()
    if (!raw || isWildcard(raw)) continue
    const hit = resolveRef(file, raw)
    if (hit) {
      referenced.add(path.resolve(hit))
      continue
    }
    // 只对 docs/assets 下的路径做死链判定：其余写法（assets/…、image/png、裸名）
    // 多为设计文档里的规格描述（tab-home(-active).png 这类），不判死链。
    if (
      raw.replace(/\\/g, '/').startsWith('docs/assets/') &&
      new RegExp(IMG_EXT + '$', 'i').test(raw.split('#')[0])
    ) {
      dead.push(`${path.relative(ROOT, file)} -> ${raw}`)
    }
  }
}

const orphans = []
if (fs.existsSync(ASSETS_DIR)) {
  for (const name of fs.readdirSync(ASSETS_DIR)) {
    if (!new RegExp(IMG_EXT + '$', 'i').test(name)) continue
    const abs = path.resolve(ASSETS_DIR, name)
    if (!referenced.has(abs)) orphans.push(path.relative(ROOT, abs))
  }
}

if (dead.length) {
  console.error('文档图片死链：')
  ;[...new Set(dead)].forEach((item) => console.error('  - ' + item))
}
if (orphans.length) {
  console.error('docs/assets 下有未被文档引用的图片（请引用或删除）：')
  orphans.forEach((item) => console.error('  - ' + item))
}
if (dead.length || orphans.length) {
  console.error('检查未通过：文档配图存在死链或孤儿图。')
  process.exit(1)
}
console.log(`文档配图检查通过：${mdFiles.length} 个文档，${referenced.size} 张被引用图片，无死链、无孤儿图。`)
